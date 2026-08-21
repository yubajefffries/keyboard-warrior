import { describe, it, expect } from 'vitest';
import {
  BASE_BUFFER,
  DEFAULT_WPM,
  EASING_MIN_ACCURACY,
  MAX_EASING_STEPS,
  MAX_WALK_TIME_S,
  MIN_SPAWN_INTERVAL_S,
  MIN_WALK_TIME_S,
  easingFrom,
  estimateSpeed,
  pacingFor,
} from '../src/game/pacing';
import { STAGES } from '../src/curriculum/stages';
import { createProfile } from '../src/profile/store';
import { absorbSamples } from '../src/profile/mastery';
import type { KeySample, StatContext } from '../src/stats/keystats';
import type { Profile } from '../src/profile/types';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const LESSON = STAGES[0].lessons[3]; // Both hands: full home row
const SHORT_LESSON = STAGES[0].lessons[0]; // F and J

function samples(key: string, n: number, interKeyMs: number, correct = true): KeySample[] {
  return Array.from({ length: n }, () => ({
    expected: key,
    pressed: correct ? key : 'x',
    correct,
    context: 'combat' as StatContext,
    interKeyMs,
    firstKeyLatencyMs: null,
  }));
}

/** A profile whose lesson keys have all been typed at the given interval. */
function typedProfile(intervalMs: number, keys = LESSON.keys): Profile {
  const p = createProfile('T');
  for (const k of keys) absorbSamples(p, samples(k, 30, intervalMs), { now: NOW, sessionId: 's1' });
  return p;
}

function sessionProfile(wpm: number): Profile {
  const p = createProfile('T');
  p.sessions.push({
    startedAt: NOW.toISOString(), endedAt: NOW.toISOString(),
    correctChars: 100, activeMs: 60_000, accuracy: 1, wpm,
  });
  return p;
}

describe('speed estimation (PRD 13: most specific evidence first)', () => {
  it('uses per-key speed on the lesson keys when there is enough of it', () => {
    const est = estimateSpeed(typedProfile(200), LESSON.keys);
    expect(est.source).toBe('lesson-keys');
    expect(est.cps).toBeCloseTo(5, 1); // 200ms per key
  });

  it('falls back to recent sessions when the lesson keys are unmeasured', () => {
    const est = estimateSpeed(sessionProfile(60), LESSON.keys);
    expect(est.source).toBe('sessions');
    expect(est.cps).toBeCloseTo(5, 5); // 60 wpm = 5 chars/s
  });

  it('falls back to placement, then to the hunt-and-peck default', () => {
    const placed = createProfile('T');
    placed.placement = {
      at: NOW.toISOString(), route: 'beginner', wpm: 24, accuracy: 0.9,
      reachedWords: false, overriddenFrom: null,
    };
    expect(estimateSpeed(placed, LESSON.keys).source).toBe('placement');
    expect(estimateSpeed(placed, LESSON.keys).cps).toBeCloseTo(2, 5);

    const blank = createProfile('T');
    const est = estimateSpeed(blank, LESSON.keys);
    expect(est.source).toBe('default');
    expect(est.cps).toBeCloseTo((DEFAULT_WPM * 5) / 60, 5);
  });

  it('key evidence outranks a session average that would misjudge new keys', () => {
    // Fast overall, but the lesson's keys were just introduced and are slow.
    const p = sessionProfile(90);
    for (const k of LESSON.keys) absorbSamples(p, samples(k, 30, 500), { now: NOW, sessionId: 's2' });
    const est = estimateSpeed(p, LESSON.keys);
    expect(est.source).toBe('lesson-keys');
    expect(est.cps).toBeCloseTo(2, 1); // the slow truth, not the fast average
  });
});

describe('pacing (PRD 13: 20-40% more time than recent performance requires)', () => {
  it('never demands more than the player has demonstrated', () => {
    for (const intervalMs of [120, 250, 500, 900]) {
      const pacing = pacingFor(typedProfile(intervalMs), LESSON);
      const meanChars = LESSON.pool.reduce((a, t) => a + t.length, 0) / LESSON.pool.length;
      const needSeconds = (meanChars * intervalMs) / 1000 + 0.9;
      // The spawn interval is the long-run demand: always >= what they need.
      expect(pacing.spawnIntervalS).toBeGreaterThanOrEqual(needSeconds);
    }
  });

  it('applies the base buffer inside the PRD band at zero easing', () => {
    expect(BASE_BUFFER).toBeGreaterThanOrEqual(0.2);
    expect(BASE_BUFFER).toBeLessThanOrEqual(0.4);
    expect(pacingFor(typedProfile(400), LESSON).buffer).toBe(BASE_BUFFER);
  });

  it('gives a faster typist a faster game', () => {
    const fast = pacingFor(typedProfile(120), LESSON);
    const slow = pacingFor(typedProfile(700), LESSON);
    expect(fast.spawnIntervalS).toBeLessThan(slow.spawnIntervalS);
    expect(fast.walkTimeS).toBeLessThanOrEqual(slow.walkTimeS);
  });

  it('keeps a shootout floor for the fast and a mercy clamp on walks', () => {
    const fast = pacingFor(typedProfile(80), SHORT_LESSON);
    expect(fast.spawnIntervalS).toBeGreaterThanOrEqual(MIN_SPAWN_INTERVAL_S);
    expect(fast.walkTimeS).toBeGreaterThanOrEqual(MIN_WALK_TIME_S);

    const glacial = pacingFor(createProfile('T'), LESSON); // default 8 wpm
    expect(glacial.walkTimeS).toBeLessThanOrEqual(MAX_WALK_TIME_S);
    // The spawn interval has NO upper clamp: capping it for a slow typist
    // would demand more than they have shown, breaking the Learn invariant.
    expect(glacial.spawnIntervalS).toBeGreaterThan(glacial.secondsPerToken - 0.001);
  });

  it('slows the game for a player whose lesson keys are inaccurate', () => {
    const clean = typedProfile(300);
    const sloppy = typedProfile(300);
    for (const k of LESSON.keys) {
      absorbSamples(sloppy, samples(k, 15, 300, false), { now: NOW, sessionId: 's2' });
    }
    // Misses cost retries, so effective throughput is lower: more time given.
    expect(pacingFor(sloppy, LESSON).spawnIntervalS).toBeGreaterThan(pacingFor(clean, LESSON).spawnIntervalS);
  });

  it('accounts for the lesson itself: longer tokens mean more time per token', () => {
    const p = typedProfile(300, [...new Set([...SHORT_LESSON.keys, ...LESSON.keys])]);
    const shortTokens = pacingFor(p, SHORT_LESSON); // fj, ff...
    const longTokens = pacingFor(p, STAGES[1].lessons[1]); // salad, flask...
    expect(longTokens.secondsPerToken).toBeGreaterThan(shortTokens.secondsPerToken);
  });
});

describe('the timer-was-wrong rule (PRD 13)', () => {
  it('counts consecutive high-accuracy deaths', () => {
    expect(easingFrom([])).toBe(0);
    expect(easingFrom([0.95])).toBe(1);
    expect(easingFrom([0.95, 0.93])).toBe(2);
  });

  it('a sloppy death resets the streak: the timer is no longer the suspect', () => {
    expect(easingFrom([0.95, 0.6])).toBe(0);
    expect(easingFrom([0.95, 0.6, 0.94])).toBe(1);
  });

  it('does not ease for a player who is missing: they need practice, not time', () => {
    expect(easingFrom([0.7, 0.8, 0.85])).toBe(0);
    expect(easingFrom([EASING_MIN_ACCURACY - 0.01])).toBe(0);
  });

  it('each eased death buys meaningfully more time, up to the cap', () => {
    const p = typedProfile(400);
    const normal = pacingFor(p, LESSON, 0);
    const eased1 = pacingFor(p, LESSON, 1);
    const eased3 = pacingFor(p, LESSON, MAX_EASING_STEPS);
    const beyond = pacingFor(p, LESSON, MAX_EASING_STEPS + 5);
    expect(eased1.spawnIntervalS).toBeGreaterThan(normal.spawnIntervalS);
    expect(eased3.spawnIntervalS).toBeGreaterThan(eased1.spawnIntervalS);
    expect(beyond.spawnIntervalS).toBe(eased3.spawnIntervalS); // capped
    expect(easingFrom([1, 1, 1, 1, 1])).toBe(MAX_EASING_STEPS);
  });
});
