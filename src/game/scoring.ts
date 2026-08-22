/**
 * Scoring and combo. PRD Section 17.
 *
 * The one design law in that section: scoring MUST NOT reward reckless speed
 * over accuracy. In Learn, accuracy outweighs WPM. So the accuracy bonus is
 * quadratic (97% is worth visibly more than 90%), the WPM bonus is linear and
 * capped below what the accuracy bonus can reach, and every miss breaks the
 * combo that everything else multiplies. Racing ahead sloppily scores worse
 * than typing slightly slower and clean, at every point in the curve.
 *
 * All constants [REVIEW]: they are game feel, to be tuned against family play.
 */

export type EnemyKind = 'standard' | 'crawler' | 'brute';

/** PRD 17: 10 correct = 2x, 25 = 3x, 50 = 4x, 100 = 5x, capped. [REVIEW] */
export const COMBO_THRESHOLDS: { streak: number; multiplier: number }[] = [
  { streak: 10, multiplier: 2 },
  { streak: 25, multiplier: 3 },
  { streak: 50, multiplier: 4 },
  { streak: 100, multiplier: 5 },
];

export const KEY_POINTS = 10;
/** Word completion: flat + per-character, so long words feel worth typing. */
export const WORD_POINTS_FLAT = 20;
export const WORD_POINTS_PER_CHAR = 5;
export const ELIMINATION_POINTS: Record<EnemyKind, number> = {
  standard: 100,
  crawler: 150, // faster, scarier, shorter window
  brute: 300, // three words of work
};
/** One-time bonus for reaching each combo tier, once per encounter. */
export const STREAK_BONUS: Record<number, number> = { 10: 100, 25: 250, 50: 500, 100: 1000 };
/** End-of-encounter: accuracy quadratic, WPM linear and capped beneath it. */
export const ACCURACY_BONUS_MAX = 600;
export const WPM_BONUS_PER_WPM = 3;
export const WPM_BONUS_CAP = 300;
export const PERFECT_BONUS = 500;

export interface ScoreBreakdown {
  keys: number;
  words: number;
  eliminations: number;
  streakBonuses: number;
  accuracyBonus: number;
  wpmBonus: number;
  perfectBonus: number;
  total: number;
}

export interface ComboState {
  streak: number;
  multiplier: number;
  /** Set on the exact key that crossed a tier, for the HUD pulse. */
  tierUp: boolean;
}

export function multiplierFor(streak: number): number {
  let m = 1;
  for (const t of COMBO_THRESHOLDS) if (streak >= t.streak) m = t.multiplier;
  return m;
}

/**
 * One encounter's running score. Feed it every hit, miss, completion, and
 * kill; finalize once with the encounter's accuracy and WPM.
 */
export class Scorer {
  private keyPoints = 0;
  private wordPoints = 0;
  private eliminationPoints = 0;
  private streakBonusPoints = 0;
  private tiersAwarded = new Set<number>();
  private streak = 0;
  private best = 0;
  private missed = false;

  /** A correct keypress. Returns combo state so the HUD can react. */
  hit(): ComboState {
    this.streak += 1;
    if (this.streak > this.best) this.best = this.streak;
    const before = multiplierFor(this.streak - 1);
    const multiplier = multiplierFor(this.streak);
    this.keyPoints += KEY_POINTS * multiplier;
    let tierUp = false;
    if (multiplier > before && !this.tiersAwarded.has(this.streak)) {
      this.tiersAwarded.add(this.streak);
      this.streakBonusPoints += STREAK_BONUS[this.streak] ?? 0;
      tierUp = true;
    }
    return { streak: this.streak, multiplier, tierUp };
  }

  /** A miss. PRD 17: errors break combo. Nothing is subtracted: the lost
   *  multiplier IS the cost, and negative score teaches nothing. */
  miss(): ComboState {
    this.streak = 0;
    this.missed = true;
    return { streak: 0, multiplier: 1, tierUp: false };
  }

  word(token: string): void {
    this.wordPoints += (WORD_POINTS_FLAT + WORD_POINTS_PER_CHAR * token.length) * multiplierFor(this.streak);
  }

  elimination(kind: EnemyKind): void {
    this.eliminationPoints += ELIMINATION_POINTS[kind] * multiplierFor(this.streak);
  }

  get combo(): ComboState {
    return { streak: this.streak, multiplier: multiplierFor(this.streak), tierUp: false };
  }

  get bestStreak(): number {
    return this.best;
  }

  /** Running total, for the HUD. */
  get runningTotal(): number {
    return this.keyPoints + this.wordPoints + this.eliminationPoints + this.streakBonusPoints;
  }

  /** End of encounter. Accuracy is worth up to twice the WPM cap, on purpose. */
  finalize(accuracy: number, wpm: number): ScoreBreakdown {
    const accuracyBonus = Math.round(Math.max(0, Math.min(1, accuracy)) ** 2 * ACCURACY_BONUS_MAX);
    const wpmBonus = Math.min(WPM_BONUS_CAP, Math.round(Math.max(0, wpm) * WPM_BONUS_PER_WPM));
    const perfectBonus = this.missed ? 0 : PERFECT_BONUS;
    return {
      keys: this.keyPoints,
      words: this.wordPoints,
      eliminations: this.eliminationPoints,
      streakBonuses: this.streakBonusPoints,
      accuracyBonus,
      wpmBonus,
      perfectBonus,
      total: this.runningTotal + accuracyBonus + wpmBonus + perfectBonus,
    };
  }
}

/**
 * PRD 17 visibility: hidden in Beginner Learn through Stage 2, so early
 * players are not staring at a meter they cannot fill. The score still
 * accumulates invisibly -- hiding the meter is presentation, not bookkeeping.
 */
export function comboVisible(route: 'beginner' | 'intermediate' | 'advanced', stage: number): boolean {
  return stage >= 3 || route !== 'beginner';
}
