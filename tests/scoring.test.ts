import { describe, it, expect } from 'vitest';
import {
  ACCURACY_BONUS_MAX,
  PERFECT_BONUS,
  Scorer,
  STREAK_BONUS,
  WPM_BONUS_CAP,
  comboVisible,
  multiplierFor,
} from '../src/game/scoring';

describe('combo ladder (PRD 17)', () => {
  it('climbs 10/25/50/100 to a 5x cap', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(9)).toBe(1);
    expect(multiplierFor(10)).toBe(2);
    expect(multiplierFor(25)).toBe(3);
    expect(multiplierFor(50)).toBe(4);
    expect(multiplierFor(100)).toBe(5);
    expect(multiplierFor(5000)).toBe(5); // the cap is the cap
  });

  it('a miss breaks the combo back to 1x', () => {
    const s = new Scorer();
    for (let i = 0; i < 30; i++) s.hit();
    expect(s.combo.multiplier).toBe(3);
    expect(s.miss().multiplier).toBe(1);
    expect(s.hit().streak).toBe(1);
  });

  it('flags the exact key that crosses a tier, once', () => {
    const s = new Scorer();
    let tierUps = 0;
    for (let i = 0; i < 12; i++) if (s.hit().tierUp) tierUps += 1;
    expect(tierUps).toBe(1); // the 10th key, only
  });

  it('awards each streak bonus once per encounter, even after a rebuild', () => {
    const s = new Scorer();
    for (let i = 0; i < 10; i++) s.hit();
    s.miss();
    for (let i = 0; i < 10; i++) s.hit(); // back to 10 again
    const b = s.finalize(1, 0);
    expect(b.streakBonuses).toBe(STREAK_BONUS[10]); // not doubled
  });

  it('remembers the best streak for the result screen', () => {
    const s = new Scorer();
    for (let i = 0; i < 30; i++) s.hit();
    s.miss();
    s.hit();
    expect(s.bestStreak).toBe(30);
  });
});

describe('accuracy outweighs speed (PRD 17)', () => {
  it('caps the WPM bonus below what accuracy can earn', () => {
    expect(WPM_BONUS_CAP).toBeLessThan(ACCURACY_BONUS_MAX);
    const s = new Scorer();
    expect(s.finalize(1, 10_000).wpmBonus).toBe(WPM_BONUS_CAP);
  });

  it('a clean slower run outscores a sloppy faster one', () => {
    // Sloppy: 100 keys with a miss every 10th press, high WPM.
    const sloppy = new Scorer();
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 9) sloppy.miss();
      else sloppy.hit();
    }
    // Clean: the same 90 correct keys, uninterrupted, slower.
    const clean = new Scorer();
    for (let i = 0; i < 90; i++) clean.hit();
    const sloppyTotal = sloppy.finalize(0.9, 80).total;
    const cleanTotal = clean.finalize(1.0, 55).total;
    expect(cleanTotal).toBeGreaterThan(sloppyTotal);
  });

  it('accuracy bonus is quadratic: 97% is visibly better than 90%', () => {
    const at = (a: number) => new Scorer().finalize(a, 0).accuracyBonus;
    expect(at(0.97) - at(0.9)).toBeGreaterThan(at(0.9) - at(0.83));
  });

  it('perfect bonus only for a run with zero misses', () => {
    const clean = new Scorer();
    clean.hit();
    expect(clean.finalize(1, 10).perfectBonus).toBe(PERFECT_BONUS);
    const one = new Scorer();
    one.hit();
    one.miss();
    expect(one.finalize(0.5, 10).perfectBonus).toBe(0);
  });

  it('a miss subtracts nothing: the lost multiplier is the cost', () => {
    const s = new Scorer();
    for (let i = 0; i < 20; i++) s.hit();
    const before = s.runningTotal;
    s.miss();
    expect(s.runningTotal).toBe(before);
  });
});

describe('kills and words scale with the live multiplier', () => {
  it('pays more for the same kill at higher combo', () => {
    const cold = new Scorer();
    cold.elimination('standard');
    const hot = new Scorer();
    for (let i = 0; i < 50; i++) hot.hit();
    const hotBefore = hot.runningTotal;
    hot.elimination('standard');
    expect(hot.runningTotal - hotBefore).toBe(cold.runningTotal * 4);
  });

  it('prices kills by the work they take: mech above hound above spider', () => {
    // The mech soaks three words, the hound two, the spider one -- the
    // spider's price stays close behind the hound's because its threat is
    // speed, not staying power.
    const s = (kind: 'standard' | 'crawler' | 'brute') => {
      const x = new Scorer();
      x.elimination(kind);
      return x.runningTotal;
    };
    expect(s('brute')).toBeGreaterThan(s('standard'));
    expect(s('standard')).toBeGreaterThan(s('crawler'));
  });
});

describe('visibility (PRD 17)', () => {
  it('hides through Stage 2 for beginners, shows from Stage 3 and for Intermediate+', () => {
    expect(comboVisible('beginner', 1)).toBe(false);
    expect(comboVisible('beginner', 2)).toBe(false);
    expect(comboVisible('beginner', 3)).toBe(true);
    expect(comboVisible('intermediate', 1)).toBe(true);
    expect(comboVisible('advanced', 1)).toBe(true);
  });
});
