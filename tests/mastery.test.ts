import { describe, it, expect } from 'vitest';
import {
  FINGER_OF,
  absorbSamples,
  autoKeyboardVisible,
  evaluateState,
  gateStatus,
  isLowExposure,
  keyReport,
  lowExposureKeys,
  mergedAggregate,
  perFingerMedian,
  pressesInLastDays,
  weakKeys,
  windowAccuracy,
} from '../src/profile/mastery';
import { createProfile } from '../src/profile/store';
import {
  EXPOSURE_SESSIONS,
  LOW_EXPOSURE_RATE,
  MASTERY_MIN_SAMPLES,
  MASTERY_WINDOW,
  emptyKeyAggregate,
  type KeyAggregate,
  type Profile,
} from '../src/profile/types';
import type { KeySample, StatContext } from '../src/stats/keystats';

const DAY = 86_400_000;
const NOW = new Date('2026-08-21T12:00:00.000Z');

function samples(
  key: string,
  n: number,
  opts: { correct?: boolean; interKeyMs?: number; context?: StatContext } = {},
): KeySample[] {
  return Array.from({ length: n }, () => ({
    expected: key,
    pressed: opts.correct === false ? 'x' : key,
    correct: opts.correct !== false,
    context: opts.context ?? ('combat' as StatContext),
    interKeyMs: opts.interKeyMs ?? 150,
    firstKeyLatencyMs: null,
  }));
}

/** A key that has genuinely earned mastery: fast, clean, plenty of recent reps. */
function masterKey(p: Profile, key: string, now = NOW): void {
  absorbSamples(p, samples(key, 20, { interKeyMs: 150 }), { now: new Date(now.getTime() - DAY), sessionId: 's1' });
  absorbSamples(p, samples(key, 20, { interKeyMs: 150 }), { now, sessionId: 's2' });
}

function agg(over: Partial<KeyAggregate> = {}): KeyAggregate {
  return { ...emptyKeyAggregate(), ...over };
}

/** n outcomes, `misses` of them wrong, newest last. */
function outcomes(n: number, misses = 0): string {
  return '0'.repeat(misses) + '1'.repeat(n - misses);
}

function recentDays(n: number, now = NOW): [string, number][] {
  return [[now.toISOString().slice(0, 10), n]];
}

describe('accumulation windows (PRD 12)', () => {
  it('scores accuracy over the rolling window, not over all time', () => {
    const p = createProfile('T');
    // A rough start, then a clean stretch longer than the window.
    absorbSamples(p, samples('k', 40, { correct: false }), { now: NOW, sessionId: 's1' });
    absorbSamples(p, samples('k', MASTERY_WINDOW, { correct: true }), { now: NOW, sessionId: 's1' });
    const a = mergedAggregate(p, 'k');
    expect(a.errors).toBe(40); // lifetime record is kept
    expect(windowAccuracy(a)).toBe(1); // but the verdict is about now
  });

  it('caps every stored window so a profile cannot grow without bound', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', MASTERY_WINDOW * 3), { now: NOW, sessionId: 's1' });
    const a = p.keys.combat['f'];
    expect(a.recentOutcomes).toHaveLength(MASTERY_WINDOW);
    expect(a.recentIntervals).toHaveLength(MASTERY_WINDOW);
    expect(a.presses).toBe(MASTERY_WINDOW * 3);
  });

  it('counts presses per day so the seven-day rule can be applied', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 10), { now: new Date(NOW.getTime() - 20 * DAY), sessionId: 'old' });
    absorbSamples(p, samples('f', 5), { now: NOW, sessionId: 'new' });
    expect(pressesInLastDays(mergedAggregate(p, 'f'), 7, NOW)).toBe(5);
  });

  it('counts one session once, however many lessons it contained', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 10), { now: NOW, sessionId: 's1' });
    absorbSamples(p, samples('f', 10), { now: NOW, sessionId: 's1' }); // same sitting
    absorbSamples(p, samples('f', 10), { now: NOW, sessionId: 's2' });
    expect(p.keys.combat['f'].sessionPresses).toEqual([10, 20]);
  });

  it('keeps only the last few sessions of exposure history', () => {
    const p = createProfile('T');
    for (let i = 0; i < EXPOSURE_SESSIONS + 4; i++) {
      absorbSamples(p, samples('f', 3), { now: NOW, sessionId: `s${i}` });
    }
    expect(p.keys.combat['f'].sessionPresses).toHaveLength(EXPOSURE_SESSIONS);
  });
});

describe('the state machine (PRD 12)', () => {
  it('will not judge a key without enough recent samples', () => {
    const a = agg({
      presses: MASTERY_MIN_SAMPLES - 1,
      recentOutcomes: outcomes(MASTERY_MIN_SAMPLES - 1),
      daily: recentDays(MASTERY_MIN_SAMPLES - 1),
      recentIntervals: [100],
    });
    expect(evaluateState(a, 'introduced', 200, NOW)).toBe('introduced');
  });

  it('will not judge a key whose samples are all older than the window', () => {
    const a = agg({
      presses: 100,
      recentOutcomes: outcomes(100),
      recentIntervals: Array(50).fill(120),
      baselineMs: 200,
      daily: [['2026-01-01', 100]], // months ago
      lastSeen: '2026-01-01T00:00:00.000Z',
    });
    // Not mastered off stale evidence, and not decayed either: no verdict.
    expect(evaluateState(a, 'introduced', null, NOW)).toBe('introduced');
  });

  it('masters an accurate key within 1.5x of its own baseline', () => {
    const a = agg({
      presses: 50, recentOutcomes: outcomes(50, 1), daily: recentDays(50),
      baselineMs: 200, recentIntervals: Array(50).fill(280),
    });
    expect(evaluateState(a, 'practiced', null, NOW)).toBe('mastered');
  });

  it('holds back an accurate but slow key', () => {
    const a = agg({
      presses: 50, recentOutcomes: outcomes(50, 1), daily: recentDays(50),
      baselineMs: 200, recentIntervals: Array(50).fill(500),
    });
    expect(evaluateState(a, 'practiced', null, NOW)).toBe('practiced');
  });

  it('judges a brand-new key against its finger, not a global home-row median', () => {
    const a = agg({
      presses: 50, recentOutcomes: outcomes(50), daily: recentDays(50),
      baselineMs: null, recentIntervals: Array(50).fill(300),
    });
    expect(evaluateState(a, 'practiced', 200, NOW)).toBe('mastered'); // 300 <= 200 * 1.8
    expect(evaluateState(a, 'practiced', 150, NOW)).toBe('practiced'); // 300 > 150 * 1.8
  });

  it('decays a mastered key that slipped under 85%', () => {
    const a = agg({
      presses: 100, recentOutcomes: outcomes(50, 15), daily: recentDays(50),
      baselineMs: 200, recentIntervals: Array(50).fill(200),
    });
    expect(evaluateState(a, 'mastered', null, NOW)).toBe('decayed');
  });

  it('does not decay a key that was never mastered; it is just still practising', () => {
    const a = agg({
      presses: 100, recentOutcomes: outcomes(50, 15), daily: recentDays(50),
      baselineMs: 200, recentIntervals: Array(50).fill(200),
    });
    expect(evaluateState(a, 'practiced', null, NOW)).toBe('practiced');
  });

  it('marks a mastered key unverified once it has gone unseen too long', () => {
    const a = agg({
      presses: 100, recentOutcomes: outcomes(50), daily: recentDays(50),
      baselineMs: 200, recentIntervals: Array(50).fill(200),
      lastSeen: '2026-01-01T00:00:00.000Z',
    });
    expect(evaluateState(a, 'mastered', null, NOW)).toBe('unverified');
  });

  it('lets an unverified key re-earn mastery once samples come back', () => {
    const a = agg({
      presses: 100, recentOutcomes: outcomes(50), daily: recentDays(50),
      baselineMs: 200, recentIntervals: Array(50).fill(200),
      lastSeen: NOW.toISOString(),
    });
    expect(evaluateState(a, 'unverified', null, NOW)).toBe('mastered');
  });

  it('reads a v1 save with no window as its lifetime accuracy', () => {
    const a = agg({ presses: 60, errors: 1, recentIntervals: Array(40).fill(200), baselineMs: 200 });
    expect(windowAccuracy(a)).toBeCloseTo(59 / 60, 5);
    expect(evaluateState(a, 'practiced', null, NOW)).toBe('mastered');
  });
});

describe('low-exposure keys (PRD 12)', () => {
  it('catches a key that barely appears', () => {
    const a = agg({ presses: 10, sessionPresses: [2, 3, 1, 2, 2] });
    expect(isLowExposure(a)).toBe(true);
  });

  it('does not catch J, which the old rare-key list wrongly exempted', () => {
    const a = agg({ presses: 500, sessionPresses: [120, 90, 110] });
    expect(isLowExposure(a)).toBe(false);
  });

  it('uses the rate, not the total: many sessions of a few presses is still rare', () => {
    const a = agg({ presses: 1000, sessionPresses: Array(EXPOSURE_SESSIONS).fill(LOW_EXPOSURE_RATE - 1) });
    expect(isLowExposure(a)).toBe(true);
  });

  it('says nothing about a key with no session history yet', () => {
    expect(isLowExposure(emptyKeyAggregate())).toBe(false);
  });
});

describe('stage gate (PRD 12)', () => {
  const TAUGHT = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'];

  it('stays shut while a frequent key is unmastered, and names it', () => {
    const p = createProfile('T');
    for (const k of TAUGHT) masterKey(p, k);
    absorbSamples(p, samples('k', 40, { correct: false }), { now: NOW, sessionId: 's3' });
    const gate = gateStatus(p, TAUGHT, NOW);
    expect(gate.ready).toBe(false);
    expect(gate.blocking[0].key).toBe('k');
  });

  it('opens when every frequent key is mastered', () => {
    const p = createProfile('T');
    for (const k of TAUGHT) masterKey(p, k);
    expect(gateStatus(p, TAUGHT, NOW).ready).toBe(true);
  });

  it('is not blocked by a low-exposure key, and says it waived it', () => {
    const p = createProfile('T');
    for (const k of ['a', 's', 'd', 'f', 'j', 'k', 'l']) masterKey(p, k);
    // The semicolon turns up twice a session: exactly the PRD's example.
    absorbSamples(p, samples(';', 2), { now: NOW, sessionId: 's1' });
    absorbSamples(p, samples(';', 2), { now: NOW, sessionId: 's2' });
    const gate = gateStatus(p, TAUGHT, NOW);
    expect(gate.ready).toBe(true);
    expect(gate.waived).toContain(';');
  });

  it('counts an unverified key as still passing the gate', () => {
    const p = createProfile('T');
    for (const k of TAUGHT) masterKey(p, k);
    p.keyStates['f'] = 'unverified';
    expect(gateStatus(p, TAUGHT, NOW).ready).toBe(true);
  });
});

describe('keyboard auto-hide (PRD 10)', () => {
  const TAUGHT = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'];

  it('follows the placement route until there is evidence', () => {
    const beginner = createProfile('B', 'beginner');
    const advanced = createProfile('A', 'advanced');
    expect(autoKeyboardVisible(beginner, TAUGHT)).toBe(true);
    expect(autoKeyboardVisible(advanced, TAUGHT)).toBe(false);
  });

  it('hides once every taught frequent key is mastered', () => {
    const p = createProfile('B', 'beginner');
    for (const k of TAUGHT) masterKey(p, k);
    expect(autoKeyboardVisible(p, TAUGHT)).toBe(false);
  });

  it('stays up while a key is still unmastered', () => {
    const p = createProfile('B', 'beginner');
    for (const k of TAUGHT) masterKey(p, k);
    absorbSamples(p, samples('l', 40, { correct: false }), { now: NOW, sessionId: 's3' });
    expect(autoKeyboardVisible(p, TAUGHT)).toBe(true);
  });

  it('comes back up when a mastered key decays', () => {
    const p = createProfile('B', 'beginner');
    for (const k of TAUGHT) masterKey(p, k);
    expect(autoKeyboardVisible(p, TAUGHT)).toBe(false);
    absorbSamples(p, samples('d', 40, { correct: false }), { now: NOW, sessionId: 's4' });
    expect(p.keyStates['d']).toBe('decayed');
    expect(autoKeyboardVisible(p, TAUGHT)).toBe(true);
  });
});

describe('the practice pool (PRD 12, 13)', () => {
  const TAUGHT = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'];

  it('ranks the worst key first and leaves mastered keys out', () => {
    const p = createProfile('T');
    for (const k of TAUGHT) masterKey(p, k);
    absorbSamples(p, samples('k', 40, { correct: false }), { now: NOW, sessionId: 's3' });
    absorbSamples(p, samples('l', 40, { correct: false }).map((s, i) => ({ ...s, correct: i < 20 })), {
      now: NOW, sessionId: 's3',
    });
    const weak = weakKeys(p, TAUGHT);
    expect(weak[0]).toBe('k');
    expect(weak).not.toContain('a');
  });

  it('puts a key the player has never met at the very front', () => {
    const p = createProfile('T');
    for (const k of ['a', 's']) masterKey(p, k);
    expect(weakKeys(p, ['a', 's', 'z'])[0]).toBe('z');
  });

  it('keeps decayed keys in the pool, which is what re-entry means', () => {
    const p = createProfile('T');
    for (const k of TAUGHT) masterKey(p, k);
    absorbSamples(p, samples('d', 40, { correct: false }), { now: NOW, sessionId: 's4' });
    expect(weakKeys(p, TAUGHT)).toContain('d');
  });

  it('lists low-exposure keys so content can inject them at a floor rate', () => {
    const p = createProfile('T');
    absorbSamples(p, samples(';', 2), { now: NOW, sessionId: 's1' });
    absorbSamples(p, samples(';', 2), { now: NOW, sessionId: 's2' });
    expect(lowExposureKeys(p, TAUGHT)).toEqual([';']);
  });
});

describe('context preference (PRD 12)', () => {
  it('prefers combat and speed-test evidence once there is enough of it', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 60, { correct: false, context: 'learn' }), { now: NOW, sessionId: 's1' });
    absorbSamples(p, samples('f', 40, { correct: true, context: 'combat' }), { now: NOW, sessionId: 's1' });
    // Learn-mode fumbling from a month of drills does not dilute how the key
    // actually performs under pressure.
    expect(windowAccuracy(mergedAggregate(p, 'f'))).toBe(1);
  });

  it('falls back to every context when the preferred ones are thin', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 40, { correct: true, context: 'learn' }), { now: NOW, sessionId: 's1' });
    absorbSamples(p, samples('f', 4, { correct: false, context: 'combat' }), { now: NOW, sessionId: 's1' });
    expect(windowAccuracy(mergedAggregate(p, 'f'))).toBeCloseTo(40 / 44, 5);
  });
});

describe('finger mapping (PRD 10)', () => {
  it('maps the PRD zones', () => {
    expect(FINGER_OF['q']).toBe('left-pinky');
    expect(FINGER_OF['t']).toBe('left-index');
    expect(FINGER_OF['y']).toBe('right-index');
    expect(FINGER_OF[';']).toBe('right-pinky');
    expect(FINGER_OF[' ']).toBe('thumb');
  });

  it('pools every key the same finger types for its median', () => {
    const p = createProfile('T');
    absorbSamples(p, [...samples('r', 20, { interKeyMs: 100 }), ...samples('v', 20, { interKeyMs: 300 })], {
      now: NOW, sessionId: 's1',
    });
    expect(perFingerMedian(p, 'f')).toBe(200); // r, f, v are all left index
  });
});

describe('progress reporting', () => {
  it('merges contexts and flags low exposure for the heatmap', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 40, { context: 'learn' }), { now: NOW, sessionId: 's1' });
    absorbSamples(p, samples('f', 40, { context: 'combat' }), { now: NOW, sessionId: 's1' });
    const row = keyReport(p).find((r) => r.key === 'f')!;
    expect(row.presses).toBe(40); // combat alone: preferred context has enough
    expect(row.lowExposure).toBe(false);
  });
});
