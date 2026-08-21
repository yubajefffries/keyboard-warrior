/**
 * First-run placement. PRD Section 3.3.
 *
 * 60 seconds: home-row letters, then common words if accuracy holds. The
 * result routes the profile to Beginner / Intermediate / Advanced.
 *
 * The PRD describes the three buckets in words ("hunt-and-peck", "shaky
 * speed or accuracy", "clean common-word typing") and gives no numbers, so
 * every threshold below is a named constant and flagged [REVIEW]. They are
 * first guesses to be tuned against real family runs, and getting one wrong
 * costs a player a few minutes in the wrong stage, never their progress: the
 * route is always overridable and Stage 1 is never taken away.
 */

import { mulberry32, pickFresh } from '../util/rand';
import type { TokenSource } from '../content/sequences';
import type { Route } from '../profile/types';

export const PLACEMENT_DURATION_MS = 60_000;
/** Accuracy needed on the letter phase before words are offered. [REVIEW] */
export const WORD_UNLOCK_ACCURACY = 0.9;
/** Letter tokens to complete before words can unlock. [REVIEW] */
export const WORD_UNLOCK_MIN_TOKENS = 8;
/** Clean common-word typing. [REVIEW] */
export const ADVANCED_MIN_WPM = 45;
export const ADVANCED_MIN_ACCURACY = 0.95;
/** Knows home row, shaky speed or accuracy. [REVIEW] */
export const INTERMEDIATE_MIN_WPM = 20;
export const INTERMEDIATE_MIN_ACCURACY = 0.9;
/** Non-home-row accuracy that justifies skipping the upper/lower row stages. [REVIEW] */
export const STAGE5_MIN_OTHER_ACCURACY = 0.95;

const LETTERS = ['fj', 'jf', 'asdf', 'jkl;', 'ff', 'jj', 'dk', 'sl', 'a;', 'fjfj', 'dkdk'];
/** Common words that reach beyond the home row, so key coverage is measurable. */
const WORDS = [
  'the', 'and', 'you', 'that', 'with', 'have', 'this', 'from', 'they', 'were',
  'when', 'your', 'said', 'each', 'which', 'their', 'time', 'will', 'about', 'there',
];

export const HOME_ROW_KEYS = new Set(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';']);

export interface PlacementScore {
  correctChars: number;
  totalPresses: number;
  errors: number;
  elapsedMs: number;
  accuracy: number;
  wpm: number;
  /** Accuracy on home-row keys only: "can they hold home row". */
  homeRowAccuracy: number;
  /** Accuracy on everything else: whether upper/lower row can be skipped. */
  otherAccuracy: number;
  otherPresses: number;
  reachedWords: boolean;
}

export interface PlacementRoute {
  route: Route;
  stage: number;
  /** One line the player sees. Never a verdict on them, only on what to do next. */
  reason: string;
}

/**
 * Token source for the drill. Starts on home-row letters and promotes itself
 * to words once accuracy shows the player can hold the row, exactly as the
 * PRD describes: "then a few common words if accuracy stays high".
 */
export class PlacementSource implements TokenSource {
  private rand: () => number;
  private tokensServed = 0;
  private promoted = false;
  private recent: string[] = [];

  constructor(seed: number) {
    this.rand = mulberry32(seed);
  }

  get phase(): 'letters' | 'words' {
    return this.promoted ? 'words' : 'letters';
  }

  get reachedWords(): boolean {
    return this.promoted;
  }

  /** Called by the runner after each token, with accuracy so far. */
  considerPromotion(accuracy: number): void {
    if (this.promoted) return;
    if (this.tokensServed >= WORD_UNLOCK_MIN_TOKENS && accuracy >= WORD_UNLOCK_ACCURACY) {
      this.promoted = true;
    }
  }

  next(): string {
    this.tokensServed += 1;
    return pickFresh(this.rand, this.promoted ? WORDS : LETTERS, this.recent);
  }
}

/** Accumulates presses during the drill and scores them at the end. */
export class PlacementScorer {
  private correctChars = 0;
  private presses = 0;
  private errors = 0;
  private homeRowPresses = 0;
  private homeRowErrors = 0;
  private otherPresses = 0;
  private otherErrors = 0;

  record(expected: string, correct: boolean): void {
    this.presses += 1;
    if (correct) this.correctChars += 1;
    else this.errors += 1;
    if (HOME_ROW_KEYS.has(expected)) {
      this.homeRowPresses += 1;
      if (!correct) this.homeRowErrors += 1;
    } else {
      this.otherPresses += 1;
      if (!correct) this.otherErrors += 1;
    }
  }

  get accuracy(): number {
    return this.presses === 0 ? 1 : (this.presses - this.errors) / this.presses;
  }

  score(elapsedMs: number, reachedWords: boolean): PlacementScore {
    return {
      correctChars: this.correctChars,
      totalPresses: this.presses,
      errors: this.errors,
      elapsedMs,
      accuracy: this.accuracy,
      // Standard definition, PRD 18: (characters / 5) / minutes.
      wpm: elapsedMs > 0 ? this.correctChars / 5 / (elapsedMs / 60_000) : 0,
      homeRowAccuracy:
        this.homeRowPresses === 0 ? 1 : (this.homeRowPresses - this.homeRowErrors) / this.homeRowPresses,
      otherAccuracy:
        this.otherPresses === 0 ? 0 : (this.otherPresses - this.otherErrors) / this.otherPresses,
      otherPresses: this.otherPresses,
      reachedWords,
    };
  }
}

/**
 * PRD 3.3 routing table. Read top down: the first bucket that fits wins.
 */
export function routeFor(score: PlacementScore): PlacementRoute {
  // Barely typed anything: a 60-second drill with almost no presses tells us
  // nothing, and guessing high would strand a beginner in Stage 5.
  if (score.totalPresses < 20) {
    return {
      route: 'beginner',
      stage: 1,
      reason: 'Not enough typed to place you. Starting at the beginning, where nothing is assumed.',
    };
  }

  if (
    score.reachedWords &&
    score.wpm >= ADVANCED_MIN_WPM &&
    score.accuracy >= ADVANCED_MIN_ACCURACY
  ) {
    return {
      route: 'advanced',
      stage: 5,
      reason: `${Math.round(score.wpm)} WPM at ${Math.round(score.accuracy * 100)}%: you can already type. Skipping the primer.`,
    };
  }

  if (
    score.homeRowAccuracy >= INTERMEDIATE_MIN_ACCURACY &&
    score.wpm >= INTERMEDIATE_MIN_WPM
  ) {
    // Stage 3 or 5 depending on key coverage (PRD 3.3). The word phase is what
    // makes coverage measurable: it uses keys off the home row.
    const coversOtherRows =
      score.otherPresses >= 20 && score.otherAccuracy >= STAGE5_MIN_OTHER_ACCURACY;
    return {
      route: 'intermediate',
      stage: coversOtherRows ? 5 : 3,
      reason: coversOtherRows
        ? `You have the whole keyboard at ${Math.round(score.accuracy * 100)}%. Starting at common words.`
        : `Home row is solid at ${Math.round(score.homeRowAccuracy * 100)}%. Starting where the rest of the keyboard begins.`,
    };
  }

  return {
    route: 'beginner',
    stage: 1,
    reason:
      score.homeRowAccuracy < INTERMEDIATE_MIN_ACCURACY
        ? `Home row came in at ${Math.round(score.homeRowAccuracy * 100)}%. Starting with finger placement.`
        : `${Math.round(score.wpm)} WPM. Starting with finger placement to build speed on a foundation.`,
  };
}
