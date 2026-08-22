import { describe, it, expect } from 'vitest';
import {
  FATIGUE_DROP,
  FATIGUE_MIN_TOKENS,
  FATIGUE_WINDOW_TOKENS,
  newFatigueState,
  recordToken,
} from '../src/game/fatigue';
import { absorbSamples } from '../src/profile/mastery';
import { createProfile } from '../src/profile/store';
import type { KeySample } from '../src/stats/keystats';

function feed(state: ReturnType<typeof newFatigueState>, accuracies: number[]) {
  let fired = false;
  for (const a of accuracies) {
    if (recordToken(state, a).suggestBreak) fired = true;
  }
  return fired;
}

describe('break suggestion (PRD 11)', () => {
  it('fires when the last 20 tokens collapse 10+ points below the session mean', () => {
    const state = newFatigueState();
    // 40 clean tokens establish the mean, then 20 rough ones.
    const fired = feed(state, [...Array(40).fill(1), ...Array(20).fill(0.75)]);
    expect(fired).toBe(true);
  });

  it('never fires early: a rough patch in the first tokens is warming up, not fatigue', () => {
    const state = newFatigueState();
    expect(feed(state, Array(FATIGUE_MIN_TOKENS - 1).fill(0.5))).toBe(false);
  });

  it('does not fire on someone who is consistently rough: that is a level, not a collapse', () => {
    const state = newFatigueState();
    expect(feed(state, Array(80).fill(0.8))).toBe(false);
  });

  it('does not fire on a dip smaller than the threshold', () => {
    const state = newFatigueState();
    const fired = feed(state, [...Array(60).fill(1), ...Array(FATIGUE_WINDOW_TOKENS).fill(1 - FATIGUE_DROP + 0.03)]);
    expect(fired).toBe(false);
  });

  it('fires at most once per session, however bad it gets', () => {
    const state = newFatigueState();
    let count = 0;
    for (const a of [...Array(40).fill(1), ...Array(60).fill(0.5)]) {
      if (recordToken(state, a).suggestBreak) count += 1;
    }
    expect(count).toBe(1);
  });

  it('reports the means so the message can quantify the slip', () => {
    const state = newFatigueState();
    for (const a of Array(40).fill(1)) recordToken(state, a);
    const r = recordToken(state, 0);
    expect(r.sessionMean).toBeGreaterThan(r.recentMean);
  });
});

describe('warm-up latency exclusion (PRD 11)', () => {
  const samples: KeySample[] = Array.from({ length: 20 }, () => ({
    expected: 'f', pressed: 'f', correct: true, context: 'learn',
    interKeyMs: 700, // post-break slow
    firstKeyLatencyMs: null,
  }));

  it('counts warm-up presses and outcomes but never the slow intervals', () => {
    const p = createProfile('T');
    absorbSamples(p, samples, { excludeLatency: true, sessionId: 'w1' });
    const agg = p.keys.learn['f'];
    expect(agg.presses).toBe(20);
    expect(agg.recentOutcomes).toHaveLength(20);
    expect(agg.sessionPresses).toEqual([20]); // exposure still counts
    expect(agg.recentIntervals).toHaveLength(0); // slowness never recorded
    expect(agg.baselineMs).toBeNull(); // and the EMA never fed
  });

  it('a normal lesson after the warm-up sets the baseline from lesson speed alone', () => {
    const p = createProfile('T');
    absorbSamples(p, samples, { excludeLatency: true, sessionId: 'w1' });
    absorbSamples(
      p,
      samples.map((s) => ({ ...s, interKeyMs: 200 })),
      { sessionId: 'w1' },
    );
    expect(p.keys.learn['f'].baselineMs).toBe(200); // not dragged toward 700
  });
});
