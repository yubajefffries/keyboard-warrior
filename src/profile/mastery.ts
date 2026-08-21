/**
 * Mastery engine. PRD Sections 10, 12.
 *
 * Gates progression and keyboard auto-hide. Every rule here is about a
 * WINDOW, never about all time: a player who was 60% on K for a month and is
 * 98% today has mastered K, and a lifetime average would say otherwise for
 * weeks. So each key carries the last MASTERY_WINDOW outcomes and intervals,
 * a per-day tally for the seven-day evaluation rule, and per-session press
 * counts for the low-exposure rule.
 *
 * Two rules exist to stop mastery from being a badge that sticks forever:
 * decay catches a key that got worse, staleness catches a key that stopped
 * appearing. Without the second, a key that falls out of the content holds its
 * badge indefinitely, because decay needs samples to fire.
 *
 * Nothing here announces itself. PRD 12 is explicit: do not toast "you forgot
 * R". A decayed key quietly rejoins the practice pool and the player finds it
 * turning up more often.
 */

import {
  BASELINE_ALPHA,
  BASELINE_MIN_SESSION_SAMPLES,
  DECAY_ACCURACY,
  EXPOSURE_SESSIONS,
  LOW_EXPOSURE_RATE,
  MASTERY_ACCURACY,
  MASTERY_BASELINE_FACTOR,
  MASTERY_FINGER_FACTOR,
  MASTERY_MIN_SAMPLES,
  MASTERY_RECENT_DAYS,
  MASTERY_WINDOW,
  STALENESS_DAYS,
  emptyKeyAggregate,
  type KeyAggregate,
  type KeyState,
  type Profile,
} from './types';
import type { KeySample, StatContext } from '../stats/keystats';

const ALL_CONTEXTS: StatContext[] = ['learn', 'combat', 'speed_test'];
/** PRD 12: adaptive content should prefer combat and speed-test samples. */
const PREFERRED_CONTEXTS: StatContext[] = ['combat', 'speed_test'];

// ---------- Accumulation ----------

export interface AbsorbOptions {
  now?: Date;
  /**
   * Which session these samples belong to. PRD 21 defines a session as
   * continuous play separated by 30+ minutes of idle, so two lessons back to
   * back share an id and count once toward the low-exposure rate. Without it,
   * "presses per session" would really mean "presses per lesson".
   */
  sessionId?: string;
}

/** Fold one run's raw samples into the profile's aggregates. */
export function absorbSamples(profile: Profile, samples: KeySample[], options: AbsorbOptions = {}): void {
  const now = options.now ?? new Date();
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const sessionId = options.sessionId ?? iso;
  /** Per-key intervals from THIS run, for the baseline EMA. */
  const runIntervals = new Map<string, number[]>();
  const touched = new Set<string>();

  for (const s of samples) {
    const bucket = profile.keys[s.context] ?? (profile.keys[s.context] = {});
    const agg = bucket[s.expected] ?? (bucket[s.expected] = emptyKeyAggregate());
    touched.add(s.expected);

    agg.presses += 1;
    agg.lastSeen = iso;
    if (!s.correct) {
      agg.errors += 1;
      agg.confusedWith[s.pressed] = (agg.confusedWith[s.pressed] ?? 0) + 1;
    }

    agg.recentOutcomes += s.correct ? '1' : '0';
    if (agg.recentOutcomes.length > MASTERY_WINDOW) {
      agg.recentOutcomes = agg.recentOutcomes.slice(-MASTERY_WINDOW);
    }

    bumpDay(agg, day);
    bumpSession(agg, sessionId);

    // Mastery uses inter-key interval only. First-key latency includes reading
    // the prompt, which is a different skill and is reported separately.
    if (s.interKeyMs !== null && s.interKeyMs > 0 && s.interKeyMs < 5_000) {
      agg.recentIntervals.push(Math.round(s.interKeyMs));
      if (agg.recentIntervals.length > MASTERY_WINDOW) {
        agg.recentIntervals.splice(0, agg.recentIntervals.length - MASTERY_WINDOW);
      }
      const composite = `${s.context}:${s.expected}`;
      const list = runIntervals.get(composite) ?? [];
      list.push(s.interKeyMs);
      runIntervals.set(composite, list);
    }
  }

  // Improving baseline: EMA of the per-session MEDIAN, updated only on runs
  // with enough samples. A three-press run says nothing about whether a key
  // got faster.
  for (const [composite, intervals] of runIntervals) {
    if (intervals.length < BASELINE_MIN_SESSION_SAMPLES) continue;
    const sep = composite.indexOf(':');
    const agg = profile.keys[composite.slice(0, sep) as StatContext]?.[composite.slice(sep + 1)];
    if (!agg) continue;
    const med = median(intervals);
    agg.baselineMs = agg.baselineMs === null ? med : agg.baselineMs * (1 - BASELINE_ALPHA) + med * BASELINE_ALPHA;
  }

  refreshStates(profile, now, touched);
}

function bumpDay(agg: KeyAggregate, day: string): void {
  const row = agg.daily.find(([d]) => d === day);
  if (row) row[1] += 1;
  else agg.daily.unshift([day, 1]);
  agg.daily.sort((a, b) => b[0].localeCompare(a[0]));
  // One past the evaluation window, so the boundary day is never half-counted.
  if (agg.daily.length > MASTERY_RECENT_DAYS + 1) agg.daily.length = MASTERY_RECENT_DAYS + 1;
}

function bumpSession(agg: KeyAggregate, sessionId: string): void {
  if (agg.lastSessionId !== sessionId) {
    agg.lastSessionId = sessionId;
    agg.sessionPresses.unshift(0);
    if (agg.sessionPresses.length > EXPOSURE_SESSIONS) agg.sessionPresses.length = EXPOSURE_SESSIONS;
  }
  agg.sessionPresses[0] += 1;
}

/**
 * Recompute key states. Staleness has to sweep every key, not just the ones
 * just typed: the whole point is to catch keys that have stopped appearing.
 */
export function refreshStates(profile: Profile, now = new Date(), _touched?: Set<string>): void {
  if (!profile.keyStates) profile.keyStates = {};
  const keys = new Set<string>();
  for (const context of ALL_CONTEXTS) {
    for (const key of Object.keys(profile.keys[context] ?? {})) keys.add(key);
  }
  for (const key of keys) {
    const merged = mergedAggregate(profile, key);
    profile.keyStates[key] = evaluateState(
      merged,
      profile.keyStates[key] ?? 'unseen',
      perFingerMedian(profile, key),
      now,
    );
  }
}

// ---------- Window readings ----------

/**
 * One key's evidence, merged across contexts. Prefers combat and speed-test
 * samples when there are enough of them (PRD 12): how fast someone types a key
 * while being charged at is the reading that matters, and learn-mode drills
 * would otherwise dilute it.
 */
export function mergedAggregate(profile: Profile, key: string): KeyAggregate {
  const preferred = PREFERRED_CONTEXTS.map((c) => profile.keys[c]?.[key]).filter(Boolean) as KeyAggregate[];
  const preferredPresses = preferred.reduce((n, a) => n + a.recentOutcomes.length, 0);
  const use =
    preferredPresses >= MASTERY_MIN_SAMPLES
      ? preferred
      : (ALL_CONTEXTS.map((c) => profile.keys[c]?.[key]).filter(Boolean) as KeyAggregate[]);
  return mergeAggregates(use);
}

export function mergeAggregates(parts: KeyAggregate[]): KeyAggregate {
  const out = emptyKeyAggregate();
  if (parts.length === 0) return out;
  if (parts.length === 1) return parts[0];

  const dayTotals = new Map<string, number>();
  let baselineSum = 0;
  let baselineCount = 0;
  for (const p of parts) {
    out.presses += p.presses;
    out.errors += p.errors;
    out.recentIntervals.push(...p.recentIntervals);
    out.recentOutcomes += p.recentOutcomes;
    for (const [day, n] of p.daily) dayTotals.set(day, (dayTotals.get(day) ?? 0) + n);
    for (let i = 0; i < p.sessionPresses.length; i++) {
      out.sessionPresses[i] = (out.sessionPresses[i] ?? 0) + p.sessionPresses[i];
    }
    if (p.lastSeen && (!out.lastSeen || p.lastSeen > out.lastSeen)) out.lastSeen = p.lastSeen;
    if (p.baselineMs !== null) {
      baselineSum += p.baselineMs;
      baselineCount += 1;
    }
    for (const [k, n] of Object.entries(p.confusedWith)) {
      out.confusedWith[k] = (out.confusedWith[k] ?? 0) + n;
    }
  }
  // The merged window can overrun after concatenation; keep the newest.
  if (out.recentOutcomes.length > MASTERY_WINDOW) out.recentOutcomes = out.recentOutcomes.slice(-MASTERY_WINDOW);
  if (out.recentIntervals.length > MASTERY_WINDOW) {
    out.recentIntervals = out.recentIntervals.slice(-MASTERY_WINDOW);
  }
  out.daily = [...dayTotals.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, MASTERY_RECENT_DAYS + 1);
  out.baselineMs = baselineCount ? baselineSum / baselineCount : null;
  return out;
}

/** Accuracy across the rolling window, not across all time. */
export function windowAccuracy(agg: KeyAggregate): number {
  if (agg.recentOutcomes.length === 0) {
    // A v1 save carries no window. Lifetime is the only reading it has, and
    // falling back to it beats demoting every key the player already earned.
    return agg.presses === 0 ? 1 : (agg.presses - agg.errors) / agg.presses;
  }
  let hits = 0;
  for (const ch of agg.recentOutcomes) if (ch === '1') hits += 1;
  return hits / agg.recentOutcomes.length;
}

export function windowPresses(agg: KeyAggregate): number {
  return agg.recentOutcomes.length || agg.presses;
}

/** Presses inside the evaluation window. PRD 12: 30 samples in the last 7 days. */
export function pressesInLastDays(agg: KeyAggregate, days: number, now = new Date()): number {
  if (agg.daily.length === 0) return agg.presses; // v1 save: no per-day record
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  let total = 0;
  for (const [day, n] of agg.daily) if (day >= cutoff) total += n;
  return total;
}

/**
 * PRD 12: a taught key is low-exposure when its observed rate falls below
 * LOW_EXPOSURE_RATE presses per session, rolling over the last five. This
 * catches Q, Z, X, the semicolon and most punctuation, and deliberately does
 * NOT catch J, a home-row anchor with heavy drill exposure that never belonged
 * on a frequency-based exemption list.
 */
export function isLowExposure(agg: KeyAggregate): boolean {
  if (agg.sessionPresses.length === 0) return false; // no evidence either way
  const rate = agg.sessionPresses.reduce((a, b) => a + b, 0) / agg.sessionPresses.length;
  return rate < LOW_EXPOSURE_RATE;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function meanInterval(agg: KeyAggregate): number | null {
  if (agg.recentIntervals.length === 0) return null;
  return agg.recentIntervals.reduce((a, b) => a + b, 0) / agg.recentIntervals.length;
}

export function isStale(agg: KeyAggregate, now = new Date()): boolean {
  if (!agg.lastSeen) return false;
  return (now.getTime() - Date.parse(agg.lastSeen)) / 86_400_000 >= STALENESS_DAYS;
}

// ---------- The state machine ----------

/**
 * unseen -> introduced -> practiced -> mastered -> (decayed | unverified)
 *
 * `previous` matters: decay and staleness only apply to a key that WAS
 * mastered, and a key that has never been judged cannot decay.
 */
export function evaluateState(
  agg: KeyAggregate,
  previous: KeyState,
  fingerMedianMs: number | null,
  now = new Date(),
): KeyState {
  if (agg.presses === 0) return 'unseen';

  const wasMastered = previous === 'mastered' || previous === 'unverified';

  // Staleness first: a mastered key with no samples for a month keeps its
  // badge on the heatmap but silently rejoins the practice pool. Checked
  // before the sample floor, because the whole problem is the missing samples.
  if (wasMastered && isStale(agg, now)) return 'unverified';

  const accuracy = windowAccuracy(agg);

  // Decay: a mastered key that slipped under 85% over its window drops out.
  // Needs the full sample floor, so one bad afternoon does not undo a month.
  if (wasMastered && windowPresses(agg) >= MASTERY_MIN_SAMPLES && accuracy < DECAY_ACCURACY) {
    return 'decayed';
  }

  // PRD 12: no evaluation at all until the key has enough recent samples.
  if (pressesInLastDays(agg, MASTERY_RECENT_DAYS, now) < MASTERY_MIN_SAMPLES) {
    return wasMastered ? previous : previous === 'decayed' ? 'decayed' : 'introduced';
  }

  if (accuracy < MASTERY_ACCURACY) return 'practiced';

  const mean = meanInterval(agg);
  if (mean === null) return 'practiced';

  // Against the key's own improving baseline where one exists, otherwise
  // against what this finger manages elsewhere. A brand-new key is supposed to
  // be slower, so it is never held to a global home-row median.
  const limit =
    agg.baselineMs !== null
      ? agg.baselineMs * MASTERY_BASELINE_FACTOR
      : fingerMedianMs !== null
        ? fingerMedianMs * MASTERY_FINGER_FACTOR
        : null;
  if (limit === null) return 'practiced';
  return mean <= limit ? 'mastered' : 'practiced';
}

// ---------- Finger mapping (PRD 10) ----------

export const FINGER_OF: Record<string, string> = {};
const FINGER_ZONES: Record<string, string> = {
  'q a z': 'left-pinky',
  'w s x': 'left-ring',
  'e d c': 'left-middle',
  'r f v t g b': 'left-index',
  'y h n u j m': 'right-index',
  'i k ,': 'right-middle',
  'o l .': 'right-ring',
  "p ; / [ ] \\ ' -": 'right-pinky',
  ' ': 'thumb',
};
for (const [keys, finger] of Object.entries(FINGER_ZONES)) {
  if (keys === ' ') {
    FINGER_OF[' '] = finger;
    continue;
  }
  for (const k of keys.split(' ')) FINGER_OF[k] = finger;
}

export const FINGER_LABEL: Record<string, string> = {
  'left-pinky': 'left little finger',
  'left-ring': 'left ring finger',
  'left-middle': 'left middle finger',
  'left-index': 'left index finger',
  'right-index': 'right index finger',
  'right-middle': 'right middle finger',
  'right-ring': 'right ring finger',
  'right-pinky': 'right little finger',
  thumb: 'thumb',
};

/** Median inter-key interval across every key the same finger types. */
export function perFingerMedian(profile: Profile, key: string): number | null {
  const finger = FINGER_OF[key];
  if (!finger) return null;
  const pool: number[] = [];
  for (const context of ALL_CONTEXTS) {
    for (const [other, agg] of Object.entries(profile.keys[context] ?? {})) {
      if (FINGER_OF[other] !== finger) continue;
      pool.push(...agg.recentIntervals);
    }
  }
  return pool.length ? median(pool) : null;
}

// ---------- Gates ----------

export function keyState(profile: Profile, key: string): KeyState {
  return profile.keyStates?.[key] ?? 'unseen';
}

/**
 * Keys that must be mastered for a gate to open: taught, and not low-exposure.
 * PRD 12 is explicit that low-exposure keys require mastery to complete their
 * introducing stage but MUST NOT block auto-hide or Stage 5 completion.
 */
export function frequentKeys(profile: Profile, taught: Iterable<string>): string[] {
  const out: string[] = [];
  for (const key of taught) {
    const agg = mergedAggregate(profile, key);
    if (agg.presses > 0 && isLowExposure(agg)) continue;
    out.push(key);
  }
  return out;
}

export interface GateStatus {
  ready: boolean;
  /** Keys still short of mastery, worst first. */
  blocking: { key: string; state: KeyState; accuracy: number; presses: number; needed: number }[];
  /** Low-exposure keys that are unmastered but explicitly do not block. */
  waived: string[];
}

/**
 * PRD 12 stage gate: a stage completes when its taught FREQUENT keys are
 * mastered. Passing the final lesson is the caller's half of the test.
 */
export function gateStatus(profile: Profile, taught: Iterable<string>, now = new Date()): GateStatus {
  const blocking: GateStatus['blocking'] = [];
  const waived: string[] = [];
  for (const key of taught) {
    const state = keyState(profile, key);
    if (state === 'mastered' || state === 'unverified') continue;
    const agg = mergedAggregate(profile, key);
    if (agg.presses > 0 && isLowExposure(agg)) {
      waived.push(key);
      continue;
    }
    blocking.push({
      key,
      state,
      accuracy: windowAccuracy(agg),
      presses: windowPresses(agg),
      // What the player would have to do next: more reps, or cleaner reps.
      needed: Math.max(0, MASTERY_MIN_SAMPLES - pressesInLastDays(agg, MASTERY_RECENT_DAYS, now)),
    });
  }
  blocking.sort((a, b) => a.accuracy - b.accuracy);
  return { ready: blocking.length === 0, blocking, waived };
}

/**
 * PRD 10: auto-hide once every taught, frequent key is mastered. Until there
 * is enough evidence to say that, fall back to the placement route, which is
 * the same signal that set the default in the first place.
 */
export function autoKeyboardVisible(profile: Profile, taught: Iterable<string>): boolean {
  const keys = [...taught];
  const judged = keys.filter((k) => windowPresses(mergedAggregate(profile, k)) >= MASTERY_MIN_SAMPLES);
  if (judged.length === 0 || judged.length < keys.length / 2) {
    return profile.route === 'beginner';
  }
  return !gateStatus(profile, keys).ready;
}

/**
 * Keys the practice pool should over-represent, worst first. Decayed and
 * unverified keys are in here by definition: that is what "silently re-enters
 * the practice pool" means.
 */
export function weakKeys(profile: Profile, taught: Iterable<string>): string[] {
  const scored: { key: string; score: number }[] = [];
  for (const key of taught) {
    const state = keyState(profile, key);
    if (state === 'mastered') continue;
    const agg = mergedAggregate(profile, key);
    // Lower is weaker. Unseen keys score 0 so a key the player has never met
    // is the most important thing to put in front of them.
    const score = agg.presses === 0 ? 0 : windowAccuracy(agg) + (state === 'unverified' ? 0.5 : 0);
    scored.push({ key, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.key);
}

/** Taught keys that need reps to keep accruing samples at all. PRD 12. */
export function lowExposureKeys(profile: Profile, taught: Iterable<string>): string[] {
  const out: string[] = [];
  for (const key of taught) {
    const agg = mergedAggregate(profile, key);
    if (agg.presses > 0 && isLowExposure(agg)) out.push(key);
  }
  return out;
}

// ---------- Reporting ----------

export interface KeyReport {
  key: string;
  state: KeyState;
  accuracy: number;
  presses: number;
  meanIntervalMs: number | null;
  lowExposure: boolean;
}

/** Everything the Progress screen heatmap needs. */
export function keyReport(profile: Profile): KeyReport[] {
  const keys = new Set<string>();
  for (const context of ALL_CONTEXTS) {
    for (const key of Object.keys(profile.keys[context] ?? {})) keys.add(key);
  }
  return [...keys]
    .map((key) => {
      const agg = mergedAggregate(profile, key);
      return {
        key,
        state: keyState(profile, key),
        accuracy: windowAccuracy(agg),
        presses: agg.presses,
        meanIntervalMs: meanInterval(agg),
        lowExposure: agg.presses > 0 && isLowExposure(agg),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
