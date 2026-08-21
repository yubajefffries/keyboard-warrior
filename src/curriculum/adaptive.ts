/**
 * Adaptive content selection. PRD Sections 12, 13.
 *
 * This is what "silently re-enters the practice pool" actually means. A key
 * that decayed, went unverified, or never got mastered turns up more often,
 * and the player is never told why — PRD 12 is explicit that the game does not
 * toast "you forgot R".
 *
 * The constraint that shapes everything here is PRD 13: weak keys are
 * over-represented, but the run MUST still feel like a shootout. At most
 * 25-40% of tokens may be picked to hit a weak key, they are surrounded by
 * keys the player owns so kills still happen, and a wave is never built out of
 * only the player's failures. A drill made entirely of what you are bad at is
 * how people stop playing.
 */

import { mulberry32 } from '../util/rand';
import type { TokenSource } from '../content/sequences';
import { lowExposureKeys, weakKeys, keyState } from '../profile/mastery';
import type { Profile } from '../profile/types';
import type { Lesson } from './stages';

/** Target share of tokens picked to hit a weak key. PRD 13 allows 25-40%. */
export const WEAK_INJECTION_RATE = 0.33;
/** Hard ceiling, never crossed regardless of how weak the profile looks. */
export const WEAK_INJECTION_MAX = 0.4;
/** Consecutive weak-targeted tokens allowed before one must be a normal one. */
export const MAX_CONSECUTIVE_WEAK = 2;
/**
 * Floor share for low-exposure keys. PRD 12: the pool MUST inject them at a
 * floor rate so they keep accruing samples, otherwise a key like the semicolon
 * can never gather the 30 presses its own evaluation needs and sits unjudged
 * forever.
 */
export const LOW_EXPOSURE_FLOOR_RATE = 0.12;
/**
 * Above this share of weak keys, injection is pointless: the whole lesson is
 * already the practice pool. Stage 1 lesson 1 teaches F and J, both unmastered
 * on the first run, and "over-represent the weak keys" there would just mean
 * "serve the lesson".
 */
export const INJECTION_OFF_ABOVE = 0.6;

interface Candidate {
  token: string;
  hitsWeak: boolean;
  hitsLowExposure: boolean;
  /** Contains at least one key the player is solid on. PRD 13. */
  hasAnchor: boolean;
}

export interface AdaptivePlan {
  weak: Set<string>;
  lowExposure: Set<string>;
  /** True when every token is just served normally. */
  passthrough: boolean;
}

export function planFor(profile: Profile, lesson: Lesson): AdaptivePlan {
  const taught = lesson.keys;
  const weak = new Set(weakKeys(profile, taught));
  const low = new Set(lowExposureKeys(profile, taught));
  return {
    weak,
    lowExposure: low,
    passthrough: taught.length === 0 || weak.size / taught.length > INJECTION_OFF_ABOVE,
  };
}

/**
 * Serves a lesson's tokens, over-representing weak keys within the PRD's
 * limits. Deterministic for a given seed so a run can be reproduced.
 */
export class AdaptiveSource implements TokenSource {
  private rand: () => number;
  private candidates: Candidate[];
  private plan: AdaptivePlan;
  private recent: string[] = [];
  private served = 0;
  private weakServed = 0;
  private lowServed = 0;
  private consecutiveWeak = 0;

  constructor(lesson: Lesson, plan: AdaptivePlan, seed: number) {
    this.plan = plan;
    this.rand = mulberry32(seed);
    this.candidates = lesson.pool.map((token) => {
      const chars = new Set(token);
      return {
        token,
        hitsWeak: [...chars].some((c) => plan.weak.has(c)),
        hitsLowExposure: [...chars].some((c) => plan.lowExposure.has(c)),
        hasAnchor: [...chars].some((c) => !plan.weak.has(c)),
      };
    });
  }

  /** Exposed for tests and for tuning the rates against real runs. */
  get mix(): { served: number; weak: number; lowExposure: number } {
    return { served: this.served, weak: this.weakServed, lowExposure: this.lowServed };
  }

  next(): string {
    const token = this.choose();
    this.served += 1;
    const candidate = this.candidates.find((c) => c.token === token);
    if (candidate?.hitsWeak && !this.plan.passthrough) {
      this.weakServed += 1;
      this.consecutiveWeak += 1;
    } else {
      this.consecutiveWeak = 0;
    }
    if (candidate?.hitsLowExposure) this.lowServed += 1;
    this.remember(token);
    return token;
  }

  private choose(): string {
    if (this.plan.passthrough) return this.pick(this.candidates);

    // Low-exposure floor comes first: these keys cannot earn their own
    // evaluation without appearing, so their share is a floor, not a target.
    if (
      this.plan.lowExposure.size > 0 &&
      this.lowServed < (this.served + 1) * LOW_EXPOSURE_FLOOR_RATE
    ) {
      const wanted = this.candidates.filter((c) => c.hitsLowExposure);
      if (wanted.length) return this.pick(wanted);
    }

    const weakShare = this.served === 0 ? 0 : this.weakServed / this.served;
    const wantWeak =
      this.plan.weak.size > 0 &&
      weakShare < WEAK_INJECTION_RATE &&
      (this.weakServed + 1) / (this.served + 1) <= WEAK_INJECTION_MAX &&
      this.consecutiveWeak < MAX_CONSECUTIVE_WEAK;

    if (wantWeak) {
      // Prefer a weak token that also carries a key the player owns, so the
      // sequence still completes and the gun still fires.
      const anchored = this.candidates.filter((c) => c.hitsWeak && c.hasAnchor);
      if (anchored.length) return this.pick(anchored);
      const any = this.candidates.filter((c) => c.hitsWeak);
      if (any.length) return this.pick(any);
    }

    // Otherwise something the player can land cleanly.
    const easy = this.candidates.filter((c) => !c.hitsWeak);
    return this.pick(easy.length ? easy : this.candidates);
  }

  private pick(from: Candidate[]): string {
    const fresh = from.filter((c) => !this.recent.includes(c.token));
    const options = fresh.length ? fresh : from;
    return options[Math.floor(this.rand() * options.length)].token;
  }

  private remember(token: string): void {
    this.recent.push(token);
    if (this.recent.length > 3) this.recent.shift();
  }
}

/**
 * One line for the lesson intro when the pool is skewed toward a weak key.
 * Names what is being practised without naming it as a failure: "more K" reads
 * differently from "you are bad at K".
 */
export function practiceNote(profile: Profile, plan: AdaptivePlan): string | null {
  if (plan.passthrough || plan.weak.size === 0) return null;
  const rejoined = [...plan.weak].filter((k) => {
    const state = keyState(profile, k);
    return state === 'decayed' || state === 'unverified';
  });
  if (rejoined.length === 0) return null;
  const keys = rejoined.slice(0, 3).map((k) => k.toUpperCase()).join(', ');
  return `Expect a little more ${keys} in this one.`;
}
