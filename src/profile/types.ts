/**
 * Profile data model. PRD Sections 12, 21.
 *
 * Pure types and tunable constants. No DOM, no storage, no renderer: this is
 * the shape that gets persisted, exported, and migrated, so it is the one
 * thing in the codebase that must stay boring and explicit.
 *
 * Every numeric threshold the PRD names lives here as a constant, because the
 * PRD says they are tunable and several are flagged [REVIEW] for Phase 1b.
 */

import type { StatContext } from '../stats/keystats';

/**
 * Bumped whenever the persisted shape changes. Import migrates forward.
 *
 * v2 (mastery gates): per-key aggregates gained a rolling outcome window, a
 * per-day tally, and per-session press counts, because v1 could only answer
 * "accuracy over all time", and every rule in PRD 12 is about a window. Key
 * state moved off the per-context aggregate to one table on the profile:
 * a key is mastered or not, and having three per-context answers to that was
 * three chances to disagree.
 */
export const PROFILE_SCHEMA_VERSION = 2;

// ---------- Tunable constants (PRD 12, 21) ----------
/** Presses a key is judged over. PRD 12. */
export const MASTERY_WINDOW = 75;
/** No mastery evaluation below this many samples in the last 7 days. PRD 12. */
export const MASTERY_MIN_SAMPLES = 30;
/** EMA weight for a key's improving baseline. PRD 12 [REVIEW]. */
export const BASELINE_ALPHA = 0.3;
/** A session must have this many samples for a key to update its baseline. */
export const BASELINE_MIN_SESSION_SAMPLES = 10;
/** Presses/session below which a taught key counts as low-exposure. PRD 12 [REVIEW]. */
export const LOW_EXPOSURE_RATE = 10;
/** Days without a sample before a mastered key becomes unverified. PRD 12 [REVIEW]. */
export const STALENESS_DAYS = 30;
/** The window MASTERY_MIN_SAMPLES must fall inside. PRD 12. */
export const MASTERY_RECENT_DAYS = 7;
/** Sessions the low-exposure rate rolls over. PRD 12. */
export const EXPOSURE_SESSIONS = 5;
/** Rolling accuracy under which a mastered key silently decays. PRD 12. */
export const DECAY_ACCURACY = 0.85;
/** Accuracy a key needs across its window to be mastered. PRD 12. */
export const MASTERY_ACCURACY = 0.95;
/** Speed allowance against a key's own improving baseline. PRD 12. */
export const MASTERY_BASELINE_FACTOR = 1.5;
/** Speed allowance for a key too new to have a baseline, vs its finger. PRD 12. */
export const MASTERY_FINGER_FACTOR = 1.8;
/** PRD 21 [REVIEW]. */
export const MAX_PROFILES = 10;
/** Idle gap that separates one session from the next. PRD 21. */
export const SESSION_IDLE_MINUTES = 30;
/** Lesson pass floor. PRD 12. */
export const LESSON_MIN_ACCURACY = 0.9;
/** Stage 1 WPM floor. Later stages tuned in Phase 1b. PRD 12. */
export const STAGE_WPM_FLOOR: Record<number, number> = { 1: 10, 2: 12 };
/** Session history kept per profile, so a family profile cannot grow forever. */
export const MAX_SESSION_HISTORY = 250;
/** Speed test results kept per profile. */
export const MAX_SPEED_TEST_HISTORY = 100;

// ---------- Model ----------
export type Route = 'beginner' | 'intermediate' | 'advanced';
export type KeyboardVizPref = 'auto' | 'on' | 'off';
export type Intensity = 'low' | 'full';
export type KeyState = 'unseen' | 'introduced' | 'practiced' | 'mastered' | 'decayed' | 'unverified';

/**
 * Rolled-up stats for one key in one context. Deliberately aggregate: raw
 * samples would grow without bound (PRD 21), and everything mastery needs is
 * derivable from a capped window.
 */
export interface KeyAggregate {
  /** Lifetime, for the progress screen. Every rule uses the window instead. */
  presses: number;
  errors: number;
  /** Last MASTERY_WINDOW inter-key intervals, ms, rounded. Oldest first. */
  recentIntervals: number[];
  /**
   * Last MASTERY_WINDOW outcomes as '1' hit / '0' miss, oldest first. Packed
   * into a string because 75 booleans per key per context, times a household
   * of profiles, is the difference between a save that fits in localStorage
   * and one that does not.
   */
  recentOutcomes: string;
  /** Presses per day, newest first, capped just past the evaluation window. */
  daily: [string, number][];
  /** Presses in each of the last EXPOSURE_SESSIONS sessions, newest first. */
  sessionPresses: number[];
  /** Which session last touched this key, so one session counts once. */
  lastSessionId: string | null;
  /** EMA of per-session median inter-key interval. Null until it qualifies. */
  baselineMs: number | null;
  /** ISO timestamp of the most recent press, for staleness. */
  lastSeen: string | null;
  /** Wrong keys pressed when this key was expected. */
  confusedWith: Record<string, number>;
}

export function emptyKeyAggregate(): KeyAggregate {
  return {
    presses: 0,
    errors: 0,
    recentIntervals: [],
    recentOutcomes: '',
    daily: [],
    sessionPresses: [],
    lastSessionId: null,
    baselineMs: null,
    lastSeen: null,
    confusedWith: {},
  };
}

export interface SessionSummary {
  startedAt: string;
  endedAt: string;
  /** Correct characters typed, for WPM. */
  correctChars: number;
  /** Active ms, pauses excluded. */
  activeMs: number;
  accuracy: number;
  wpm: number;
}

export interface SpeedTestResult {
  at: string;
  durationS: 15 | 30 | 60 | 120 | 300;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  /** Standard deviation of per-token WPM: lower is steadier. */
  consistency: number;
  peakWpm: number;
}

export interface PlacementResult {
  at: string;
  route: Route;
  wpm: number;
  accuracy: number;
  /** True when the drill got far enough to judge word typing, not just letters. */
  reachedWords: boolean;
  /** Set when the player overrode the recommended route. PRD 3.3. */
  overriddenFrom: Route | null;
}

export interface ProfileSettings {
  keyboardViz: KeyboardVizPref;
  textSize: 'normal' | 'large';
  highContrast: boolean;
  intensity: Intensity;
  motionReduction: boolean;
  /** 0..1, weapon/UI vs atmosphere. PRD 19. */
  audioMix: number;
  pauseOnBlur: boolean;
  /** Words visible ahead of the active prompt. PRD 6. */
  lookahead: number;
}

export function defaultSettings(route: Route): ProfileSettings {
  return {
    // PRD 3.3: Beginner on, Intermediate auto, Advanced off.
    keyboardViz: route === 'beginner' ? 'on' : route === 'intermediate' ? 'auto' : 'off',
    textSize: 'normal',
    highContrast: false,
    intensity: 'full',
    motionReduction: false,
    audioMix: 0.5,
    pauseOnBlur: true,
    lookahead: 3,
  };
}

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  lastPlayedAt: string;
  route: Route;
  /** Current position in the curriculum. PRD 11. */
  stage: number;
  lesson: number;
  /** Stage numbers whose gate has been passed. */
  stagesCleared: number[];
  settings: ProfileSettings;
  /** Per-key aggregates, split by context. PRD 12. */
  keys: Record<StatContext, Record<string, KeyAggregate>>;
  /**
   * The state of each key, once per key rather than once per context. PRD 12
   * says samples are stored by context and that adaptive content should prefer
   * combat and speed-test samples; the verdict those samples produce is still
   * a single fact about the player's finger.
   */
  keyStates: Record<string, KeyState>;
  sessions: SessionSummary[];
  speedTests: SpeedTestResult[];
  placement: PlacementResult | null;
}

export function emptyKeyTable(): Record<StatContext, Record<string, KeyAggregate>> {
  return { learn: {}, combat: {}, speed_test: {} };
}
