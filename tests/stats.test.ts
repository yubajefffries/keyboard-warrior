import { describe, it, expect } from 'vitest';
import { StatsTracker } from '../src/stats/keystats';
import { HomeRowSource, TAUGHT_KEYS, allPhase0Tokens } from '../src/content/sequences';

describe('StatsTracker', () => {
  it('computes standard WPM: (chars/5)/minutes', () => {
    expect(StatsTracker.wpm(250, 60_000)).toBe(50);
    expect(StatsTracker.wpm(0, 60_000)).toBe(0);
    expect(StatsTracker.wpm(100, 0)).toBe(0);
  });

  it('splits accuracy by context', () => {
    const s = new StatsTracker();
    s.recordPress('a', 'a', true, 'combat', null, null);
    s.recordPress('a', 's', false, 'combat', null, null);
    s.recordPress('a', 'a', true, 'speed_test', null, null);
    expect(s.totalAccuracy('combat')).toBe(0.5);
    expect(s.totalAccuracy('speed_test')).toBe(1);
    expect(s.totalAccuracy()).toBeCloseTo(2 / 3);
  });

  it('filters implausible intervals out of means', () => {
    const s = new StatsTracker();
    s.recordPress('a', 'a', true, 'combat', 200, null);
    s.recordPress('a', 'a', true, 'combat', 99_999, null); // pause artifact
    const a = s.perKey().find((r) => r.key === 'a')!;
    expect(a.meanInterKeyMs).toBe(200);
  });

  it('exports versioned JSON with a confusion matrix', () => {
    const s = new StatsTracker();
    s.recordPress('r', 't', false, 'learn', null, null);
    const parsed = JSON.parse(s.exportJSON());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.confusion.r.t).toBe(1);
  });
});

describe('Phase 0 content', () => {
  it('every token uses only taught home-row keys', () => {
    for (const token of allPhase0Tokens()) {
      for (const ch of token) expect(TAUGHT_KEYS.has(ch), `char ${ch} in ${token}`).toBe(true);
    }
  });

  it('is deterministic per seed and never repeats within the last 3 tokens', () => {
    const a = new HomeRowSource(42);
    const b = new HomeRowSource(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (let i = 1; i < seqA.length; i++) {
      const window = seqA.slice(Math.max(0, i - 3), i);
      expect(window.includes(seqA[i])).toBe(false);
    }
  });
});
