import { describe, it, expect } from 'vitest';
import {
  MAX_HEALTH,
  MISS_DRAIN,
  PEAK_SHARE,
  QUOTA_CAP,
  SurvivalSource,
  THREAT_DRAIN_PER_S,
  WALK_FLOOR_S,
  capitalDensity,
  demonstratedPeakCps,
  isNewBest,
  punctDensity,
  rareShare,
  threatDrainPerS,
  wavePlan,
} from '../src/modes/survival';
import { createProfile } from '../src/profile/store';
import { keysTaughtThrough } from '../src/curriculum/stages';
import { isShiftedChar } from '../src/content/shift';
import type { Profile } from '../src/profile/types';

function fastProfile(peakWpm: number): Profile {
  const p = createProfile('T', 'advanced');
  p.speedTests.push({
    at: '2026-08-22T00:00:00.000Z', durationS: 60, wpm: peakWpm * 0.9, rawWpm: peakWpm,
    accuracy: 0.97, correctChars: 500, incorrectChars: 10, consistency: 8, peakWpm,
  });
  return p;
}

describe('the scaling law (PRD 18): complexity climbs, speed does not', () => {
  it('never implies a rate above the demonstrated peak', () => {
    for (const peak of [30, 60, 100]) {
      const p = fastProfile(peak);
      const peakCps = demonstratedPeakCps(p);
      for (let wave = 1; wave <= 20; wave++) {
        const plan = wavePlan(p, wave, 6);
        const impliedCps = 6 / plan.spawnIntervalS;
        expect(impliedCps).toBeLessThanOrEqual(peakCps * PEAK_SHARE + 1e-9);
      }
    }
  });

  it('scales the crowd, not the clock: quota grows, spawn interval bottoms out', () => {
    const p = fastProfile(60);
    const w1 = wavePlan(p, 1, 6);
    const w10 = wavePlan(p, 10, 6);
    const w30 = wavePlan(p, 30, 6);
    expect(w10.quota).toBeGreaterThan(w1.quota);
    expect(w30.quota).toBe(QUOTA_CAP);
    expect(w10.spawnIntervalS).toBeLessThanOrEqual(w1.spawnIntervalS);
    // and the floor holds forever after
    expect(w30.spawnIntervalS).toBeCloseTo(w10.spawnIntervalS, 5);
  });

  it('shrinks walk time to a floor, never below it', () => {
    const p = fastProfile(60);
    expect(wavePlan(p, 1, 6).walkTimeS).toBeGreaterThan(wavePlan(p, 5, 6).walkTimeS);
    expect(wavePlan(p, 50, 6).walkTimeS).toBe(WALK_FLOOR_S);
  });

  it('ramps the enemy mix and caps it', () => {
    const p = fastProfile(60);
    expect(wavePlan(p, 1, 6).bruteChance).toBe(0);
    expect(wavePlan(p, 5, 6).bruteChance).toBeGreaterThan(0);
    expect(wavePlan(p, 50, 6).crawlerChance).toBeLessThanOrEqual(0.3);
    expect(wavePlan(p, 50, 6).bruteChance).toBeLessThanOrEqual(0.2);
  });

  it('reads peak from speed tests first, then sessions, then placement', () => {
    expect(demonstratedPeakCps(fastProfile(72))).toBeCloseTo(6, 5);
    const sessions = createProfile('T');
    sessions.sessions.push({
      startedAt: 'x', endedAt: 'x', correctChars: 100, activeMs: 60_000, accuracy: 1, wpm: 48,
    });
    expect(demonstratedPeakCps(sessions)).toBeCloseTo(4, 5);
    expect(demonstratedPeakCps(createProfile('T'))).toBeGreaterThan(0);
  });
});

describe('health (PRD 16)', () => {
  it('drains faster the closer they are, and not at all in an empty room', () => {
    expect(threatDrainPerS(1)).toBeCloseTo(THREAT_DRAIN_PER_S, 5);
    expect(threatDrainPerS(0)).toBeLessThan(threatDrainPerS(1));
    expect(threatDrainPerS(0)).toBeGreaterThan(0); // spawned = under threat
  });

  it('prices a miss well below a death', () => {
    expect(MISS_DRAIN * 10).toBeLessThan(MAX_HEALTH); // ten misses is a bad patch, not a run end
  });
});

describe('content levers respect the curriculum (PRD 20)', () => {
  it('gives a Stage 5 profile no capitals, punctuation, numbers, or sentences at any wave', () => {
    const source = new SurvivalSource(keysTaughtThrough(5), 7);
    source.setWave(12);
    for (let i = 0; i < 200; i++) {
      const token = source.next();
      for (const ch of token) {
        expect(isShiftedChar(ch)).toBe(false);
        expect('.,!?:0123456789 '.includes(ch)).toBe(false);
      }
    }
  });

  it('gives a Stage 10 profile the full stack by the later waves', () => {
    const source = new SurvivalSource(keysTaughtThrough(10), 7);
    source.setWave(10);
    const tokens = Array.from({ length: 400 }, () => source.next());
    expect(tokens.some((t) => /^[A-Z]/.test(t))).toBe(true);
    expect(tokens.some((t) => /[.,!?]$/.test(t))).toBe(true);
    expect(tokens.some((t) => /^\d+$/.test(t))).toBe(true);
    expect(tokens.some((t) => t.includes(' '))).toBe(true);
  });

  it('stays plain on wave 1 and thickens with the waves', () => {
    expect(capitalDensity(1)).toBe(0);
    expect(punctDensity(2)).toBe(0);
    expect(rareShare(1)).toBe(0);
    expect(capitalDensity(8)).toBeGreaterThan(capitalDensity(3));
    expect(rareShare(6)).toBeGreaterThan(rareShare(2));
  });

  it('serves every token inside the taught key set, decorations included', () => {
    for (const stage of [5, 7, 8, 10]) {
      const taught = keysTaughtThrough(stage);
      const source = new SurvivalSource(taught, 11);
      source.setWave(9);
      for (let i = 0; i < 150; i++) {
        for (const kind of ['standard', 'crawler', 'brute'] as const) {
          for (const token of source.tokensFor(kind)) {
            for (const ch of token) expect(taught.has(ch)).toBe(true);
          }
        }
      }
    }
  });

  it('keeps crawlers short and brutes heavy', () => {
    const source = new SurvivalSource(keysTaughtThrough(10), 13);
    source.setWave(6);
    for (let i = 0; i < 40; i++) {
      const [crawler] = source.tokensFor('crawler');
      expect(crawler.length).toBeLessThanOrEqual(4);
      const brute = source.tokensFor('brute');
      expect(brute).toHaveLength(3);
    }
  });
});

describe('records (PRD 21)', () => {
  it('a deeper wave always beats a higher score on an earlier wave', () => {
    const shallow = { wave: 3, kills: 40, score: 90_000, at: 'x' };
    const deep = { wave: 4, kills: 20, score: 10_000, at: 'y' };
    expect(isNewBest(shallow, deep)).toBe(true);
    expect(isNewBest(deep, shallow)).toBe(false);
  });

  it('same wave: score decides; first run is always a best', () => {
    expect(isNewBest(null, { wave: 1, kills: 1, score: 10, at: 'x' })).toBe(true);
    expect(isNewBest({ wave: 2, kills: 5, score: 500, at: 'x' }, { wave: 2, kills: 9, score: 600, at: 'y' })).toBe(true);
    expect(isNewBest({ wave: 2, kills: 5, score: 500, at: 'x' }, { wave: 2, kills: 9, score: 400, at: 'y' })).toBe(false);
  });
});
