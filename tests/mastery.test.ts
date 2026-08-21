import { describe, it, expect } from 'vitest';
import { absorbSamples, evaluateState, keyReport, perFingerMedian, FINGER_OF } from '../src/profile/mastery';
import { createProfile } from '../src/profile/store';
import { MASTERY_MIN_SAMPLES, MASTERY_WINDOW, emptyKeyAggregate } from '../src/profile/types';
import type { KeySample } from '../src/stats/keystats';

function samples(key: string, n: number, opts: { correct?: boolean; interKeyMs?: number } = {}): KeySample[] {
  return Array.from({ length: n }, () => ({
    expected: key,
    pressed: opts.correct === false ? 'x' : key,
    correct: opts.correct !== false,
    context: 'learn' as const,
    interKeyMs: opts.interKeyMs ?? 150,
    firstKeyLatencyMs: null,
  }));
}

describe('absorbing samples into a profile (PRD 12)', () => {
  it('aggregates presses, errors, and the confusion matrix', () => {
    const p = createProfile('T');
    absorbSamples(p, [...samples('f', 10), ...samples('f', 2, { correct: false })]);
    const agg = p.keys.learn['f'];
    expect(agg.presses).toBe(12);
    expect(agg.errors).toBe(2);
    expect(agg.confusedWith).toEqual({ x: 2 });
  });

  it('caps the interval window so a family profile cannot grow forever', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', MASTERY_WINDOW * 3));
    expect(p.keys.learn['f'].recentIntervals).toHaveLength(MASTERY_WINDOW);
    expect(p.keys.learn['f'].presses).toBe(MASTERY_WINDOW * 3); // counts are not capped
  });

  it('updates the improving baseline only on sessions with enough samples', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 5, { interKeyMs: 400 }));
    expect(p.keys.learn['f'].baselineMs).toBeNull(); // 5 presses says nothing

    absorbSamples(p, samples('f', 20, { interKeyMs: 200 }));
    expect(p.keys.learn['f'].baselineMs).toBe(200);

    // EMA, alpha 0.3: the baseline improves toward a faster session, not to it.
    absorbSamples(p, samples('f', 20, { interKeyMs: 100 }));
    expect(p.keys.learn['f'].baselineMs).toBeCloseTo(170, 5);
  });

  it('ignores implausible intervals so a pause does not poison the baseline', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 20, { interKeyMs: 30_000 }));
    expect(p.keys.learn['f'].recentIntervals).toHaveLength(0);
    expect(p.keys.learn['f'].presses).toBe(20);
  });
});

describe('key state rules (PRD 12)', () => {
  it('will not judge a key before it has enough samples', () => {
    const agg = { ...emptyKeyAggregate(), presses: MASTERY_MIN_SAMPLES - 1, recentIntervals: [100] };
    expect(evaluateState(agg, 200)).toBe('introduced');
  });

  it('masters an accurate key that is within 1.5x of its own baseline', () => {
    const agg = {
      ...emptyKeyAggregate(),
      presses: 50, errors: 1, baselineMs: 200,
      recentIntervals: Array(50).fill(280), state: 'practiced' as const,
    };
    expect(evaluateState(agg, null)).toBe('mastered');
  });

  it('holds back an accurate but slow key', () => {
    const agg = {
      ...emptyKeyAggregate(),
      presses: 50, errors: 1, baselineMs: 200,
      recentIntervals: Array(50).fill(500), state: 'practiced' as const,
    };
    expect(evaluateState(agg, null)).toBe('practiced');
  });

  it('judges a brand-new key against the per-finger median, not a home-row median', () => {
    const agg = {
      ...emptyKeyAggregate(),
      presses: 50, errors: 0, baselineMs: null,
      recentIntervals: Array(50).fill(300), state: 'practiced' as const,
    };
    expect(evaluateState(agg, 200)).toBe('mastered'); // 300 <= 200 * 1.8
    expect(evaluateState(agg, 150)).toBe('practiced'); // 300 > 150 * 1.8
  });

  it('decays a mastered key that slipped under 85%, silently', () => {
    const agg = {
      ...emptyKeyAggregate(),
      presses: 100, errors: 20, baselineMs: 200,
      recentIntervals: Array(50).fill(200), state: 'mastered' as const,
    };
    expect(evaluateState(agg, null)).toBe('decayed');
  });

  it('marks a mastered key unverified once it has gone unseen too long', () => {
    const agg = {
      ...emptyKeyAggregate(),
      presses: 100, errors: 1, baselineMs: 200,
      recentIntervals: Array(50).fill(200), state: 'mastered' as const,
      lastSeen: '2026-01-01T00:00:00.000Z',
    };
    expect(evaluateState(agg, null, new Date('2026-08-21T00:00:00.000Z'))).toBe('unverified');
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
    absorbSamples(p, [...samples('r', 20, { interKeyMs: 100 }), ...samples('v', 20, { interKeyMs: 300 })]);
    expect(perFingerMedian(p, 'learn', 'f')).toBe(200); // r, f, v are all left index
  });
});

describe('progress reporting', () => {
  it('merges contexts for the heatmap', () => {
    const p = createProfile('T');
    absorbSamples(p, samples('f', 10));
    absorbSamples(p, samples('f', 10).map((s) => ({ ...s, context: 'combat' as const })));
    const row = keyReport(p).find((r) => r.key === 'f')!;
    expect(row.presses).toBe(20);
  });
});
