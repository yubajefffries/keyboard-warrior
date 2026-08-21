/**
 * Adaptive difficulty. PRD Section 13.
 *
 * Enemy timing is derived from what the player has actually demonstrated:
 * per-key speed on the keys THIS lesson uses when there is enough evidence,
 * recent session WPM when there is not, placement as a last measurement, and
 * a deliberately forgiving default when nothing is known at all.
 *
 * Two dials come out of it, and everything else in the encounter follows:
 *
 * - spawn interval: the long-run required throughput. One enemy per allowed
 *   token time, so a player typing at their recent pace always keeps up.
 * - walk time: forgiveness. How long an enemy takes to cross the room is how
 *   far behind the player can fall and still recover.
 *
 * The Learn invariant (PRD 13): the allowed time per token is 20-40% more
 * than recent performance requires, so the spawn interval NEVER demands more
 * than the player has already shown. There is no upper clamp on the spawn
 * interval for exactly this reason: clamping it down for a slow typist would
 * quietly reintroduce the demand the buffer exists to remove.
 *
 * And the rule that overrides everything: a lesson consistently failed at
 * >=90% accuracy means the timer is wrong, not the player. Each such death
 * widens the buffer past the normal band. Deaths at low accuracy do not ease
 * anything -- that player needs practice, and slower enemies would not
 * change what the misses are telling us.
 *
 * All numbers are feel constants, flagged [REVIEW] like every other tunable
 * in this codebase, to be adjusted against real family play.
 */

import { mergedAggregate, windowAccuracy } from '../profile/mastery';
import type { Profile } from '../profile/types';
import type { Lesson } from '../curriculum/stages';

/** Learn-mode buffer over demonstrated pace. PRD 13 allows 20-40%. [REVIEW] */
export const BASE_BUFFER = 0.3;
/** Extra buffer per high-accuracy death: the timer-was-wrong rule. [REVIEW] */
export const EASE_STEP = 0.25;
/** Most easing steps that can accumulate; past this the timer is generous
 *  enough that something else is the problem. */
export const MAX_EASING_STEPS = 3;
/** Accuracy at or above which a death indicts the timer, not the player. PRD 13. */
export const EASING_MIN_ACCURACY = 0.9;
/** Reading beat added per token: prompt appears, eyes land, fingers start. [REVIEW] */
export const READ_BEAT_MS = 900;
/** Tokens of backlog an enemy's walk should forgive. [REVIEW] */
export const SLACK_TOKENS = 5;
/** Spawn floor so a fast typist still gets a shootout, not a queue. [REVIEW] */
export const MIN_SPAWN_INTERVAL_S = 2.5;
/** Walk-time clamps: below this dying feels random, above it nothing feels
 *  like a threat at all. [REVIEW] */
export const MIN_WALK_TIME_S = 18;
export const MAX_WALK_TIME_S = 75;
/** Assumed pace when a profile has no evidence at all: hunt-and-peck. [REVIEW] */
export const DEFAULT_WPM = 8;
/** Per-key evidence needed before it outranks session history. */
export const MIN_KEY_SAMPLES = 20;
/** Effective-throughput floor: accuracy below 50% stops slowing the timer
 *  further, or a rough patch would spiral the game into slow motion. */
export const MIN_ACCURACY_FACTOR = 0.5;

export type SpeedSource = 'lesson-keys' | 'sessions' | 'placement' | 'default';

export interface SpeedEstimate {
  /** Correct characters per second the player has demonstrated. */
  cps: number;
  /** Window accuracy on this lesson's keys, if known. */
  accuracy: number | null;
  source: SpeedSource;
}

export interface Pacing {
  /** Time the player is allowed per token, buffer included. */
  secondsPerToken: number;
  /** One enemy per this many seconds. Never below what the player needs. */
  spawnIntervalS: number;
  /** Seconds an enemy takes from spawn to the kill line. */
  walkTimeS: number;
  /** The buffer actually applied, easing included. */
  buffer: number;
  /** How many timer-was-wrong deaths fed into this. */
  easingSteps: number;
  speedSource: SpeedSource;
}

/**
 * What has this player demonstrated, most specific evidence first?
 * Key-specific speed beats session averages because a lesson full of
 * newly-introduced keys is typed slower than the profile's overall WPM says,
 * and pacing built on the wrong number kills people (PRD 16: literally).
 */
export function estimateSpeed(profile: Profile, lessonKeys: string[]): SpeedEstimate {
  // Per-key inter-key intervals on the exact keys this lesson uses.
  const intervals: number[] = [];
  let presses = 0;
  let errors = 0;
  for (const key of lessonKeys) {
    const agg = mergedAggregate(profile, key);
    intervals.push(...agg.recentIntervals);
    const window = agg.recentOutcomes.length || agg.presses;
    presses += window;
    errors += Math.round((1 - windowAccuracy(agg)) * window);
  }
  if (intervals.length >= MIN_KEY_SAMPLES) {
    const meanMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return {
      cps: 1000 / meanMs,
      accuracy: presses > 0 ? (presses - errors) / presses : null,
      source: 'lesson-keys',
    };
  }

  const recent = profile.sessions.slice(-3).filter((s) => s.wpm > 0);
  if (recent.length > 0) {
    const wpm = recent.reduce((a, s) => a + s.wpm, 0) / recent.length;
    return { cps: (wpm * 5) / 60, accuracy: null, source: 'sessions' };
  }

  if (profile.placement && profile.placement.wpm > 0) {
    return { cps: (profile.placement.wpm * 5) / 60, accuracy: profile.placement.accuracy, source: 'placement' };
  }

  return { cps: (DEFAULT_WPM * 5) / 60, accuracy: null, source: 'default' };
}

/**
 * The timer-was-wrong rule. Counts the CONSECUTIVE most recent deaths at
 * >=90% accuracy: one sloppy death in between resets the streak, because it
 * re-opens the question of whether the timer was really the problem.
 */
export function easingFrom(deathAccuracies: number[]): number {
  let steps = 0;
  for (let i = deathAccuracies.length - 1; i >= 0; i--) {
    if (deathAccuracies[i] < EASING_MIN_ACCURACY) break;
    steps += 1;
  }
  return Math.min(steps, MAX_EASING_STEPS);
}

export function pacingFor(profile: Profile, lesson: Lesson, easingSteps = 0): Pacing {
  const estimate = estimateSpeed(profile, lesson.keys);

  // Misses cost retries under miss-and-retry, so effective throughput on the
  // target string is demonstrated speed scaled by accuracy -- the PRD's
  // "accuracy, key-specific accuracy" factors. Floored so a rough patch
  // cannot spiral the pace into slow motion.
  const accuracyFactor = Math.max(MIN_ACCURACY_FACTOR, estimate.accuracy ?? 1);
  const effectiveCps = estimate.cps * accuracyFactor;

  const meanTokenChars = lesson.pool.reduce((a, t) => a + t.length, 0) / lesson.pool.length;
  const needSeconds = meanTokenChars / effectiveCps + READ_BEAT_MS / 1000;

  const steps = Math.min(Math.max(0, easingSteps), MAX_EASING_STEPS);
  const buffer = BASE_BUFFER + steps * EASE_STEP;
  const secondsPerToken = needSeconds * (1 + buffer);

  return {
    secondsPerToken,
    spawnIntervalS: Math.max(MIN_SPAWN_INTERVAL_S, secondsPerToken),
    walkTimeS: Math.min(MAX_WALK_TIME_S, Math.max(MIN_WALK_TIME_S, secondsPerToken * SLACK_TOKENS)),
    buffer,
    easingSteps: steps,
    speedSource: estimate.source,
  };
}
