/**
 * Speed Test. PRD Section 18.
 *
 * Standard definition: WPM = (characters / 5) / minutes, characters include
 * spaces. Raw WPM counts everything typed; net WPM counts only correct
 * characters. Consistency is the spread of per-token speed, because a player
 * who alternates sprinting and stalling has a different problem from one who
 * is evenly slow.
 *
 * Phase 1a ships 30s and 60s (PRD 3, Phase 1a). The other durations are in the
 * type already so adding them later is a menu change, not a rewrite.
 */

import { mulberry32 } from '../util/rand';
import type { TokenSource } from '../content/sequences';
import type { SpeedTestResult } from '../profile/types';

export const PHASE_1A_DURATIONS = [30, 60] as const;

/** Common English words, filtered per profile to keys the player has met. */
const COMMON_WORDS = [
  'the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but',
  'his', 'from', 'they', 'say', 'her', 'she', 'will', 'one', 'all', 'would',
  'there', 'their', 'what', 'out', 'about', 'who', 'get', 'which', 'when', 'make',
  'can', 'like', 'time', 'just', 'him', 'know', 'take', 'people', 'into', 'year',
  'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now',
  'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
  'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want',
  'because', 'any', 'these', 'give', 'day', 'most', 'us', 'is', 'was', 'are',
];

/** Home-row-only words, for a profile that has not been taught the rest yet. */
const HOME_ROW_WORDS = [
  'as', 'ad', 'add', 'ask', 'all', 'fall', 'lad', 'lads', 'lass', 'dad',
  'sad', 'salad', 'flask', 'falls', 'alas', 'dads', 'flak', 'salads',
];

/**
 * PRD 11: content is filtered to the keys the profile has been taught. A speed
 * test full of letters a beginner has never seen measures nothing but surprise.
 */
export function wordsFor(taught: Set<string>): string[] {
  const pool = COMMON_WORDS.filter((w) => [...w].every((ch) => taught.has(ch)));
  // Below this a "random" test would loop the same handful of words and
  // measure memorisation instead of typing.
  return pool.length >= 12 ? pool : HOME_ROW_WORDS.filter((w) => [...w].every((ch) => taught.has(ch)));
}

export class WordSource implements TokenSource {
  private rand: () => number;
  private pool: string[];
  private recent: string[] = [];

  constructor(pool: string[], seed: number) {
    this.pool = pool.length ? pool : HOME_ROW_WORDS;
    this.rand = mulberry32(seed);
  }

  next(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const token = this.pool[Math.floor(this.rand() * this.pool.length)];
      if (!this.recent.includes(token)) {
        this.recent.push(token);
        if (this.recent.length > 3) this.recent.shift();
        return token;
      }
    }
    return this.pool[Math.floor(this.rand() * this.pool.length)];
  }
}

/**
 * Peak is measured over a sliding five seconds of wall clock, not over a
 * number of tokens. A single short word finished quickly is arithmetic, not
 * speed: three characters in 20 ms reads as 2400 WPM, and averaging it with
 * four neighbours still leaves it dominating. Time is the only window that
 * makes a burst prove it was sustained.
 */
export const PEAK_WINDOW_MS = 5_000;

export class SpeedTestScorer {
  private correct = 0;
  private incorrect = 0;
  private perKey = new Map<string, { presses: number; errors: number; totalMs: number; samples: number }>();
  /** WPM of each completed token, for consistency. */
  private tokenWpm: number[] = [];
  /** When each token landed and how many characters it was worth, for peak. */
  private marks: { at: number; chars: number }[] = [];
  private lastTokenAt: number | null = null;

  record(expected: string, correct: boolean, interKeyMs: number | null): void {
    if (correct) this.correct += 1;
    else this.incorrect += 1;
    const row = this.perKey.get(expected) ?? { presses: 0, errors: 0, totalMs: 0, samples: 0 };
    row.presses += 1;
    if (!correct) row.errors += 1;
    if (interKeyMs !== null && interKeyMs > 0 && interKeyMs < 5_000) {
      row.totalMs += interKeyMs;
      row.samples += 1;
    }
    this.perKey.set(expected, row);
  }

  completeToken(token: string, now: number): void {
    // +1 for the space a typist would hit between words in prose.
    const chars = token.length + 1;
    if (this.lastTokenAt !== null) {
      const ms = now - this.lastTokenAt;
      if (ms > 0) this.tokenWpm.push(chars / 5 / (ms / 60_000));
    }
    this.marks.push({ at: now, chars });
    this.lastTokenAt = now;
  }

  result(durationS: SpeedTestResult['durationS'], elapsedMs: number, at = new Date()): SpeedTestResult {
    const minutes = elapsedMs / 60_000;
    const total = this.correct + this.incorrect;
    return {
      at: at.toISOString(),
      durationS,
      wpm: minutes > 0 ? this.correct / 5 / minutes : 0,
      rawWpm: minutes > 0 ? total / 5 / minutes : 0,
      accuracy: total === 0 ? 1 : this.correct / total,
      correctChars: this.correct,
      incorrectChars: this.incorrect,
      consistency: stdev(this.tokenWpm),
      peakWpm: peakWpm(
        this.marks,
        PEAK_WINDOW_MS,
        minutes > 0 ? this.correct / 5 / minutes : 0,
      ),
    };
  }

  /** PRD 18: slowest keys and least accurate keys. */
  weakest(limit = 5): { slowest: string[]; leastAccurate: string[] } {
    const rows = [...this.perKey.entries()].filter(([, r]) => r.presses >= 3);
    const slowest = rows
      .filter(([, r]) => r.samples > 0)
      .sort((a, b) => b[1].totalMs / b[1].samples - a[1].totalMs / a[1].samples)
      .slice(0, limit)
      .map(([k]) => k);
    const leastAccurate = rows
      .filter(([, r]) => r.errors > 0)
      .sort((a, b) => a[1].errors / a[1].presses - b[1].errors / b[1].presses)
      .reverse()
      .slice(0, limit)
      .map(([k]) => k);
    return { slowest, leastAccurate };
  }
}

/**
 * Best sustained rate: the most characters landed inside any `windowMs` of the
 * run. If the whole run is shorter than one window there is no sustained rate
 * to find, so the overall net WPM is reported instead of a lucky fragment.
 */
export function peakWpm(
  marks: { at: number; chars: number }[],
  windowMs: number,
  fallbackWpm: number,
): number {
  if (marks.length < 2 || marks[marks.length - 1].at - marks[0].at < windowMs) return fallbackWpm;
  let best = 0;
  let chars = 0;
  let i = 0;
  for (let j = 0; j < marks.length; j++) {
    chars += marks[j].chars;
    // Half-open window: a token that landed exactly windowMs ago was finished
    // before this window opened, so its characters are not inside it.
    while (marks[j].at - marks[i].at >= windowMs) {
      chars -= marks[i].chars;
      i += 1;
    }
    if (marks[j].at - marks[0].at >= windowMs) {
      best = Math.max(best, chars / 5 / (windowMs / 60_000));
    }
  }
  return best;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
