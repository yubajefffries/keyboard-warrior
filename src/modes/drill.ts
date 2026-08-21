/**
 * Timed typing drill. PRD Sections 3.3, 18.
 *
 * Placement and Speed Test are the same machine: a clock, a token source, and
 * a scorer. Combat is deliberately absent — both of these measure typing, and
 * an enemy closing in is a confound, not a feature.
 *
 * Blur aborts rather than pauses (PRD 18): a paused-and-resumed timer produces
 * garbage WPM, so a discarded attempt is the honest outcome.
 */

import { TypingEngine } from '../game/engine';
import { StatsTracker, type StatContext } from '../stats/keystats';
import { TokenQueue, type TokenSource } from '../content/sequences';
import type { InputPipeline } from '../input/pipeline';
import type { PromptView } from '../ui/prompt';
import type { KeyboardViz } from '../ui/keyboard';
import type { WeaponAudio } from '../audio/sfx';

export interface DrillDeps {
  prompt: PromptView;
  keyboard: KeyboardViz | null;
  pipeline: InputPipeline;
  audio: WeaponAudio | null;
  lookahead: () => number;
}

export interface DrillHooks {
  /** Every accepted press, before hit/miss handling. */
  onPress?: (pressed: string, expected: string, correct: boolean) => void;
  /** A whole token finished. */
  onToken?: (token: string, completed: number) => void;
  /** ~10x a second while running, for the clock. */
  onTick?: (remainingMs: number, elapsedMs: number) => void;
  onFinish?: (elapsedMs: number) => void;
  /** Focus was lost: the attempt is discarded, not paused. */
  onAbort?: (reason: string) => void;
}

export class TimedDrill {
  private deps: DrillDeps;
  private hooks: DrillHooks = {};
  private typing: TypingEngine;
  private queue: TokenQueue | null = null;
  private completed: string[] = [];
  private tokensCompleted = 0;
  private startedAt = 0;
  private durationMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Drill samples stay in their own tracker so the caller decides what, if
   *  anything, gets folded into the profile's long-term baselines. Fresh per
   *  run: a discarded attempt must not colour the next one. */
  private tracker: StatsTracker;

  constructor(deps: DrillDeps, context: StatContext = 'speed_test') {
    this.deps = deps;
    this.tracker = new StatsTracker();
    this.typing = new TypingEngine(
      this.tracker,
      {
        onPress: (pressed, expected, correct) => this.hooks.onPress?.(pressed, expected, correct),
        onHit: (char) => {
          this.deps.audio?.tick();
          this.deps.keyboard?.flash(char, 'hit');
          this.redrawActive();
        },
        onMiss: (_expected, pressed) => {
          this.deps.audio?.dryFire();
          this.deps.prompt.flashError(performance.now());
          this.deps.keyboard?.flash(pressed, 'miss');
          this.redrawActive();
        },
        onComplete: (token) => {
          this.completed.unshift(token);
          if (this.completed.length > 4) this.completed.pop();
          this.tokensCompleted += 1;
          this.hooks.onToken?.(token, this.tokensCompleted);
          this.advance();
        },
      },
      context,
    );

    deps.pipeline.subscribe((record) => {
      if (!this.running) return;
      this.typing.handle(record);
    });
  }

  get stats(): StatsTracker {
    return this.tracker;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get tokens(): number {
    return this.tokensCompleted;
  }

  get elapsedMs(): number {
    return this.running ? performance.now() - this.startedAt : 0;
  }

  start(source: TokenSource, durationMs: number, hooks: DrillHooks): void {
    this.hooks = hooks;
    this.tracker = new StatsTracker();
    this.typing.setStats(this.tracker);
    this.queue = new TokenQueue(source, 4);
    this.completed = [];
    this.tokensCompleted = 0;
    this.durationMs = durationMs;
    this.startedAt = performance.now();
    this.running = true;
    this.typing.setEnabled(true);
    this.setToken(this.queue.current);

    this.timer = setInterval(() => {
      const elapsed = performance.now() - this.startedAt;
      const remaining = Math.max(0, this.durationMs - elapsed);
      this.hooks.onTick?.(remaining, elapsed);
      if (remaining <= 0) this.finish();
    }, 100);
  }

  /** Ends the drill and reports the score. */
  finish(): void {
    if (!this.running) return;
    const elapsed = performance.now() - this.startedAt;
    this.teardown();
    this.hooks.onFinish?.(elapsed);
  }

  /** Ends the drill and discards it. */
  abort(reason: string): void {
    if (!this.running) return;
    this.teardown();
    this.hooks.onAbort?.(reason);
  }

  private teardown(): void {
    this.running = false;
    this.typing.setEnabled(false);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.deps.keyboard?.setTarget(null);
  }

  /** The source may want to change what it serves as the drill progresses. */
  get currentQueue(): TokenQueue | null {
    return this.queue;
  }

  private advance(): void {
    if (!this.queue) return;
    this.queue.advance();
    this.setToken(this.queue.current);
  }

  private setToken(token: string): void {
    this.typing.setToken(token);
    this.typing.markTokenShown(performance.now());
    this.redrawActive();
    this.deps.prompt.setUpcoming(this.queue?.upcoming(this.deps.lookahead()) ?? []);
    this.deps.prompt.setCompleted(this.completed);
  }

  private redrawActive(): void {
    const token = this.typing.currentToken;
    this.deps.prompt.render(token, this.typing.typedCount);
    this.deps.prompt.tick(performance.now());
    this.deps.keyboard?.setTarget(
      token[this.typing.typedCount] ?? null,
      token[this.typing.typedCount + 1] ?? this.queue?.upcoming(1)[0]?.[0] ?? null,
    );
  }
}
