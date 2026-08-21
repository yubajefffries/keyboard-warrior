/**
 * Folding live keystrokes into a profile, and reading mastery back out.
 * PRD Section 12.
 *
 * The full mastery engine (decay, staleness, auto-hide) ships in Phase 1b.
 * What lives here now is what Phase 1a needs and what 1b will build on: the
 * aggregation, the improving baseline, and the key-state rules. Getting the
 * accumulation right now matters more than the gates, because samples not
 * recorded today cannot be recovered later.
 */

import {
  BASELINE_ALPHA,
  BASELINE_MIN_SESSION_SAMPLES,
  MASTERY_MIN_SAMPLES,
  MASTERY_WINDOW,
  STALENESS_DAYS,
  emptyKeyAggregate,
  type KeyAggregate,
  type KeyState,
  type Profile,
} from './types';
import type { KeySample, StatContext } from '../stats/keystats';

/** Fold one session's raw samples into the profile's aggregates. */
export function absorbSamples(profile: Profile, samples: KeySample[], now = new Date()): void {
  const iso = now.toISOString();
  /** Per-key intervals from THIS session, for the baseline EMA. */
  const sessionIntervals = new Map<string, number[]>();

  for (const s of samples) {
    const bucket = profile.keys[s.context] ?? (profile.keys[s.context] = {});
    const agg = bucket[s.expected] ?? (bucket[s.expected] = emptyKeyAggregate());
    agg.presses += 1;
    agg.lastSeen = iso;
    if (agg.state === 'unseen') agg.state = 'introduced';
    if (!s.correct) {
      agg.errors += 1;
      agg.confusedWith[s.pressed] = (agg.confusedWith[s.pressed] ?? 0) + 1;
    }
    // Mastery uses inter-key interval only. First-key latency includes reading
    // the prompt, which is a different skill and is reported separately.
    if (s.interKeyMs !== null && s.interKeyMs > 0 && s.interKeyMs < 5_000) {
      agg.recentIntervals.push(s.interKeyMs);
      if (agg.recentIntervals.length > MASTERY_WINDOW) {
        agg.recentIntervals.splice(0, agg.recentIntervals.length - MASTERY_WINDOW);
      }
      const key = `${s.context}:${s.expected}`;
      const list = sessionIntervals.get(key) ?? [];
      list.push(s.interKeyMs);
      sessionIntervals.set(key, list);
    }
  }

  // Improving baseline: EMA of the per-session MEDIAN, updated only on
  // sessions with enough samples. A three-press session says nothing about
  // whether a key got faster.
  for (const [composite, intervals] of sessionIntervals) {
    if (intervals.length < BASELINE_MIN_SESSION_SAMPLES) continue;
    const sep = composite.indexOf(':');
    const context = composite.slice(0, sep) as StatContext;
    const key = composite.slice(sep + 1);
    const agg = profile.keys[context]?.[key];
    if (!agg) continue;
    const med = median(intervals);
    agg.baselineMs = agg.baselineMs === null ? med : agg.baselineMs * (1 - BASELINE_ALPHA) + med * BASELINE_ALPHA;
  }

  for (const context of Object.keys(profile.keys) as StatContext[]) {
    for (const [key, agg] of Object.entries(profile.keys[context])) {
      agg.state = evaluateState(agg, perFingerMedian(profile, context, key), now);
    }
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function accuracyOf(agg: KeyAggregate): number {
  return agg.presses === 0 ? 1 : (agg.presses - agg.errors) / agg.presses;
}

export function meanInterval(agg: KeyAggregate): number | null {
  if (agg.recentIntervals.length === 0) return null;
  return agg.recentIntervals.reduce((a, b) => a + b, 0) / agg.recentIntervals.length;
}

/**
 * PRD 12: mastered needs >= 95% accuracy over the window AND speed within
 * 1.5x of the key's own improving baseline, or 1.8x of the per-finger median
 * for a key that has no baseline yet. A new key is supposed to be slower;
 * comparing it to a global home-row median would fail it forever.
 */
export function evaluateState(agg: KeyAggregate, fingerMedianMs: number | null, now = new Date()): KeyState {
  if (agg.presses === 0) return 'unseen';
  if (agg.presses < MASTERY_MIN_SAMPLES) return agg.presses > 0 ? 'introduced' : 'unseen';

  const accuracy = accuracyOf(agg);
  const mean = meanInterval(agg);

  // Decay: a mastered key that slipped under 85% quietly rejoins the pool.
  if (agg.state === 'mastered' && accuracy < 0.85) return 'decayed';

  if (agg.state === 'mastered' && isStale(agg, now)) return 'unverified';

  if (accuracy < 0.95 || mean === null) return 'practiced';

  const limit = agg.baselineMs !== null ? agg.baselineMs * 1.5 : fingerMedianMs !== null ? fingerMedianMs * 1.8 : null;
  if (limit === null) return 'practiced';
  return mean <= limit ? 'mastered' : 'practiced';
}

export function isStale(agg: KeyAggregate, now = new Date()): boolean {
  if (!agg.lastSeen) return false;
  const days = (now.getTime() - Date.parse(agg.lastSeen)) / 86_400_000;
  return days >= STALENESS_DAYS;
}

/** Left pinky QAZ, left ring WSX, ... PRD 10. */
export const FINGER_OF: Record<string, string> = {};
const FINGER_ZONES: Record<string, string> = {
  'q a z': 'left-pinky',
  'w s x': 'left-ring',
  'e d c': 'left-middle',
  'r f v t g b': 'left-index',
  'y h n u j m': 'right-index',
  'i k ,': 'right-middle',
  'o l .': 'right-ring',
  'p ; / [ ] \\ \' -': 'right-pinky',
  ' ': 'thumb',
};
for (const [keys, finger] of Object.entries(FINGER_ZONES)) {
  if (keys === ' ') {
    FINGER_OF[' '] = finger;
    continue;
  }
  for (const k of keys.split(' ')) FINGER_OF[k] = finger;
}

/** Median inter-key interval across every key the same finger types. */
export function perFingerMedian(profile: Profile, context: StatContext, key: string): number | null {
  const finger = FINGER_OF[key];
  if (!finger) return null;
  const pool: number[] = [];
  for (const [other, agg] of Object.entries(profile.keys[context] ?? {})) {
    if (FINGER_OF[other] !== finger) continue;
    pool.push(...agg.recentIntervals);
  }
  return pool.length ? median(pool) : null;
}

export interface KeyReport {
  key: string;
  state: KeyState;
  accuracy: number;
  presses: number;
  meanIntervalMs: number | null;
}

/** Everything the Progress screen heatmap needs, merged across contexts. */
export function keyReport(profile: Profile, contexts: StatContext[] = ['learn', 'combat', 'speed_test']): KeyReport[] {
  const merged = new Map<string, { presses: number; errors: number; intervals: number[]; state: KeyState }>();
  for (const context of contexts) {
    for (const [key, agg] of Object.entries(profile.keys[context] ?? {})) {
      const row = merged.get(key) ?? { presses: 0, errors: 0, intervals: [], state: 'unseen' as KeyState };
      row.presses += agg.presses;
      row.errors += agg.errors;
      row.intervals.push(...agg.recentIntervals);
      if (STATE_RANK[agg.state] > STATE_RANK[row.state]) row.state = agg.state;
      merged.set(key, row);
    }
  }
  return [...merged.entries()]
    .map(([key, row]) => ({
      key,
      state: row.state,
      accuracy: row.presses ? (row.presses - row.errors) / row.presses : 1,
      presses: row.presses,
      meanIntervalMs: row.intervals.length
        ? row.intervals.reduce((a, b) => a + b, 0) / row.intervals.length
        : null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const STATE_RANK: Record<KeyState, number> = {
  unseen: 0,
  introduced: 1,
  decayed: 2,
  practiced: 3,
  unverified: 4,
  mastered: 5,
};
