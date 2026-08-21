/**
 * Robot typist: synthetic keystrokes at an exact WPM. PRD Section 3.1 gate.
 *
 * A human cannot reliably type 100+ WPM on demand, and cannot tell a dropped
 * event from their own mistake while doing it. The robot removes the human:
 * it dispatches keydown/keyup pairs on a drift-corrected schedule and records
 * what the app did with each one.
 *
 * HONEST LIMIT: these are synthetic DOM events. They enter at `dispatchEvent`,
 * so they prove the APP keeps up (handler cost, ordering, no drops, no frame
 * hitches) but they cannot prove the OS -> browser path never drops a real
 * hardware key. That half of the gate still needs fingers, or a CDP-level
 * driver. See docs/BURST_TESTING.md.
 */

import { mulberry32 } from '../util/rand';

export interface RobotConfig {
  /** Words per minute, 5 chars per word. 100 wpm = 8.33 chars/s = 120 ms/char. */
  wpm: number;
  /** Stop after this many characters. */
  chars: number;
  /** +/- percentage of random variation per interval (0 = metronome). */
  jitterPct?: number;
  /** Fraction of keystrokes deliberately sent as a wrong neighbouring key. */
  errorRate?: number;
  /** Seed for jitter/error decisions so a run can be repeated exactly. */
  seed?: number;
}

export interface RobotSample {
  /** Index of this keystroke in the run. */
  n: number;
  /** Character the robot was asked to produce. */
  wanted: string;
  /** Character actually dispatched (differs from wanted on injected errors). */
  sent: string;
  /** Scheduled fire time (ms, performance.now clock). */
  idealAt: number;
  /** Actual fire time. */
  firedAt: number;
  /** Wall time spent inside dispatchEvent: the app's whole synchronous cost. */
  handlerMs: number;
}

export interface RobotReport {
  wpm: number;
  intervalMs: number;
  jitterPct: number;
  errorRate: number;
  /** Keystrokes dispatched. */
  sent: number;
  /** Keystrokes deliberately wrong. */
  injectedErrors: number;
  /** Slots where the app had nothing for the robot to type (paused, dead). */
  starvedSlots: number;
  /**
   * Times the main thread was so busy the robot could not fire on schedule and
   * gave up on that slot. Non-zero means the machine could not sustain the
   * requested rate: read `achievedWpm`, not `wpm`.
   */
  lateSlots: number;
  durationMs: number;
  /** Effective rate achieved, from first to last dispatch. */
  achievedWpm: number;
  /** Timer accuracy: |firedAt - idealAt|. */
  drift: Stat;
  /** App cost per keystroke, measured around dispatchEvent. */
  handler: Stat;
  frames: {
    count: number;
    meanFps: number;
    /** Longest single frame during the burst. */
    worstMs: number;
    /** Frames over one 60 Hz budget. */
    over16: number;
    /** Frames over two 60 Hz budgets: a visible hitch. */
    over33: number;
  };
}

export interface Stat {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function stat(values: number[]): Stat {
  if (values.length === 0) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  };
}

/** ms between characters for a given WPM (standard 5 chars per word). */
export function msPerChar(wpm: number): number {
  return 60_000 / (wpm * 5);
}

const PUNCT_CODES: Record<string, string> = {
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '`': 'Backquote',
  ' ': 'Space',
};

/** US QWERTY key -> KeyboardEvent.code, so synthetic events look real. */
export function keyToCode(key: string): string {
  if (/^[a-zA-Z]$/.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  return PUNCT_CODES[key] ?? '';
}

/** Physically adjacent keys, for realistic injected errors. */
const NEIGHBOURS: Record<string, string> = {
  a: 's', s: 'd', d: 'f', f: 'g', g: 'f', h: 'j', j: 'k', k: 'l', l: ';', ';': 'l',
  q: 'w', w: 'e', e: 'r', r: 't', t: 'y', y: 'u', u: 'i', i: 'o', o: 'p', p: 'o',
  z: 'x', x: 'c', c: 'v', v: 'b', b: 'n', n: 'm', m: 'n',
};

export function neighbourOf(key: string): string {
  return NEIGHBOURS[key] ?? (key === 'f' ? 'd' : 'f');
}

export interface RobotHooks {
  /**
   * The character the app currently wants. Return null when there is nothing
   * to type (paused, dead, between encounters); the robot keeps its cadence
   * and counts the slot as starved.
   */
  nextChar: () => string | null;
  /** Called after every dispatch, for live UI. */
  onSample?: (s: RobotSample) => void;
  /** Called once when the run ends (or is stopped). */
  onFinish?: (r: RobotReport) => void;
}

export class RobotTypist {
  private hooks: RobotHooks;
  private target: Window;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private active = false;

  private cfg: Required<RobotConfig> = {
    wpm: 100, chars: 200, jitterPct: 0, errorRate: 0, seed: 1,
  };
  private rand: () => number = mulberry32(1);
  private samples: RobotSample[] = [];
  private frameDeltas: number[] = [];
  private lastFrame = 0;
  private startedAt = 0;
  /** When this tick was meant to fire, jitter included. */
  private idealAt = 0;
  private n = 0;
  private injectedErrors = 0;
  private starved = 0;
  private lateSlots = 0;

  constructor(hooks: RobotHooks, target: Window = window) {
    this.hooks = hooks;
    this.target = target;
  }

  get running(): boolean {
    return this.active;
  }

  get config(): Required<RobotConfig> {
    return this.cfg;
  }

  start(config: RobotConfig): void {
    if (this.active) this.stop();
    this.cfg = {
      wpm: config.wpm,
      chars: config.chars,
      jitterPct: config.jitterPct ?? 0,
      errorRate: config.errorRate ?? 0,
      seed: config.seed ?? 1,
    };
    this.rand = mulberry32(this.cfg.seed);
    this.samples = [];
    this.frameDeltas = [];
    this.injectedErrors = 0;
    this.starved = 0;
    this.lateSlots = 0;
    this.n = 0;
    this.active = true;
    this.startedAt = performance.now();
    this.idealAt = this.startedAt;
    this.lastFrame = this.startedAt;

    const sampleFrames = (t: number): void => {
      if (!this.active) return;
      this.frameDeltas.push(t - this.lastFrame);
      this.lastFrame = t;
      this.raf = this.target.requestAnimationFrame(sampleFrames);
    };
    this.raf = this.target.requestAnimationFrame(sampleFrames);

    this.timer = setTimeout(this.tick, 0);
  }

  stop(): RobotReport {
    this.active = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.target.cancelAnimationFrame(this.raf);
    const report = this.report();
    this.hooks.onFinish?.(report);
    return report;
  }

  private tick = (): void => {
    if (!this.active) return;

    const interval = msPerChar(this.cfg.wpm);
    // Drift is measured against the schedule the robot actually intended,
    // jitter included; otherwise deliberate jitter reads as timer error.
    const idealAt = this.idealAt;
    const firedAt = performance.now();
    const wanted = this.hooks.nextChar();

    if (wanted === null || wanted === '') {
      this.starved += 1;
    } else {
      let sent = wanted;
      if (this.cfg.errorRate > 0 && this.rand() < this.cfg.errorRate) {
        sent = neighbourOf(wanted);
        this.injectedErrors += 1;
      }
      const t0 = performance.now();
      this.dispatch(sent);
      const handlerMs = performance.now() - t0;
      const sample: RobotSample = { n: this.n, wanted, sent, idealAt, firedAt, handlerMs };
      this.samples.push(sample);
      this.hooks.onSample?.(sample);
    }

    this.n += 1;
    if (this.samples.length >= this.cfg.chars) {
      this.stop();
      return;
    }

    // Schedule the next keystroke from the ideal time, not from now, so a slow
    // tick does not push every later keystroke late.
    const jitter =
      this.cfg.jitterPct > 0 ? (this.rand() * 2 - 1) * interval * (this.cfg.jitterPct / 100) : 0;
    this.idealAt += interval + jitter;

    // If the machine has fallen a whole interval behind, re-anchor instead of
    // firing back-to-back to catch up: a flood is a different test than a
    // steady 100 wpm, and it would hide the real finding. Late slots are
    // counted and reported.
    const now = performance.now();
    if (this.idealAt < now - interval) {
      this.lateSlots += 1;
      this.idealAt = now;
    }
    this.timer = setTimeout(this.tick, Math.max(0, this.idealAt - now));
  };

  private dispatch(key: string): void {
    const code = keyToCode(key);
    const init: KeyboardEventInit = {
      key,
      code,
      bubbles: true,
      cancelable: true,
      composed: true,
      repeat: false,
    };
    // keydown then keyup: the pipeline tracks held state off the pair, so a
    // robot that only sends keydown would leave every key looking stuck.
    this.target.dispatchEvent(new KeyboardEvent('keydown', init));
    this.target.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  private report(): RobotReport {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const durationMs = first && last ? last.firedAt - first.firedAt : 0;
    const frames = this.frameDeltas.filter((d) => d > 0);
    return {
      wpm: this.cfg.wpm,
      intervalMs: msPerChar(this.cfg.wpm),
      jitterPct: this.cfg.jitterPct,
      errorRate: this.cfg.errorRate,
      sent: this.samples.length,
      injectedErrors: this.injectedErrors,
      starvedSlots: this.starved,
      lateSlots: this.lateSlots,
      durationMs,
      achievedWpm:
        durationMs > 0 ? (this.samples.length - 1) / 5 / (durationMs / 60_000) : 0,
      drift: stat(this.samples.map((s) => Math.abs(s.firedAt - s.idealAt))),
      handler: stat(this.samples.map((s) => s.handlerMs)),
      frames: {
        count: frames.length,
        meanFps: frames.length
          ? 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)
          : 0,
        worstMs: frames.length ? Math.max(...frames) : 0,
        over16: frames.filter((d) => d > 16.7).length,
        over33: frames.filter((d) => d > 33.4).length,
      },
    };
  }
}

export interface BurstVerdict {
  pass: boolean;
  lines: { label: string; value: string; pass: boolean; detail: string }[];
}

/**
 * Phase 0 burst gate. Thresholds are deliberately explicit so a failing run
 * says which number moved, not just "it felt bad".
 */
export function judgeBurst(
  report: RobotReport,
  capture: { expected: string; observed: string },
): BurstVerdict {
  const lossless = capture.expected === capture.observed;
  const firstDiff = (() => {
    for (let i = 0; i < Math.max(capture.expected.length, capture.observed.length); i++) {
      if (capture.expected[i] !== capture.observed[i]) return i;
    }
    return -1;
  })();

  const lines = [
    {
      label: 'Lossless + in order',
      value: lossless
        ? `${capture.observed.length}/${capture.expected.length} chars`
        : `diverges at char ${firstDiff}`,
      pass: lossless,
      detail: lossless
        ? 'Every dispatched key arrived exactly once, in order.'
        : `Expected ${JSON.stringify(capture.expected.slice(firstDiff, firstDiff + 12))}, ` +
          `got ${JSON.stringify(capture.observed.slice(firstDiff, firstDiff + 12))}. ` +
          'A drop or reorder in the app layer.',
    },
    {
      label: 'Rate actually achieved',
      value: `${report.achievedWpm.toFixed(1)} wpm`,
      pass: report.achievedWpm >= report.wpm * 0.95,
      detail: `Asked for ${report.wpm}. Timer drift p95 ${report.drift.p95.toFixed(1)} ms, ` +
        `max ${report.drift.max.toFixed(1)} ms.` +
        (report.lateSlots > 0
          ? ` ${report.lateSlots} slots missed their turn: the machine could not sustain this rate.`
          : ''),
    },
    {
      label: 'Per-key app cost',
      value: `p99 ${report.handler.p99.toFixed(2)} ms`,
      pass: report.handler.p99 < 4,
      detail: `Max ${report.handler.max.toFixed(2)} ms. Budget is 4 ms: at ${report.wpm} wpm ` +
        `that is ${((report.handler.mean / report.intervalMs) * 100).toFixed(1)}% of the main thread.`,
    },
    {
      label: 'No visible hitch',
      value: `worst frame ${report.frames.worstMs.toFixed(1)} ms`,
      pass: report.frames.over33 === 0,
      detail: `${report.frames.over16} frames over 16.7 ms, ${report.frames.over33} over 33.4 ms. ` +
        `Mean ${report.frames.meanFps.toFixed(0)} fps during the burst.`,
    },
  ];

  return { pass: lines.every((l) => l.pass), lines };
}
