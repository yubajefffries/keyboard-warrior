/**
 * Curriculum: Stages 1 and 2. PRD Sections 11, 12.
 *
 * Progression is intentional, never random text. Each lesson names the keys it
 * introduces, and its content is filtered to keys the profile has been taught.
 * Stages 3-10 arrive in later phases; the shape here is what they plug into.
 */

import { mulberry32 } from '../util/rand';
import type { TokenSource } from '../content/sequences';
import { LESSON_MIN_ACCURACY, STAGE_WPM_FLOOR } from '../profile/types';

export interface Lesson {
  id: string;
  title: string;
  /** One objective, stated the way it is shown to the player. */
  objective: string;
  /** Keys this lesson introduces for the first time. */
  introduces: string[];
  /** Every key the lesson may ask for, introduced or prior. */
  keys: string[];
  /** Tokens to complete for a pass. Keeps a lesson in the PRD's 3-6 minutes. */
  targetTokens: number;
  /** Drill fragments and words, already filtered to `keys`. */
  pool: string[];
}

export interface Stage {
  number: number;
  title: string;
  lessons: Lesson[];
}

const HOME_LEFT = ['a', 's', 'd', 'f'];
const HOME_RIGHT = ['j', 'k', 'l', ';'];

export const STAGES: Stage[] = [
  {
    number: 1,
    title: 'Finger placement',
    lessons: [
      {
        id: '1-1',
        title: 'F and J',
        objective: 'Find the two bumps without looking. Index fingers only.',
        introduces: ['f', 'j'],
        keys: ['f', 'j'],
        targetTokens: 24,
        pool: ['fj', 'jf', 'ff', 'jj', 'fjf', 'jfj', 'ffjj', 'jjff', 'fjfj', 'jfjf'],
      },
      {
        id: '1-2',
        title: 'The left hand',
        objective: 'A S D F, one finger each, without leaving the bumps.',
        introduces: ['a', 's', 'd'],
        keys: [...HOME_LEFT, 'j'],
        targetTokens: 28,
        pool: ['asdf', 'fdsa', 'aa', 'ss', 'dd', 'ad', 'as', 'sad', 'fad', 'dad', 'adds', 'fads'],
      },
      {
        id: '1-3',
        title: 'The right hand',
        objective: 'J K L and the semicolon, mirroring the left.',
        introduces: ['k', 'l', ';'],
        keys: [...HOME_LEFT, ...HOME_RIGHT],
        targetTokens: 28,
        pool: ['jkl;', ';lkj', 'kk', 'll', 'jk', 'kl', 'l;', 'jkjk', 'klkl', 'lkj'],
      },
      {
        id: '1-4',
        title: 'Both hands',
        objective: 'The whole home row, alternating hands.',
        introduces: [],
        keys: [...HOME_LEFT, ...HOME_RIGHT],
        targetTokens: 32,
        pool: [
          'asdf', 'jkl;', 'fjfj', 'dkdk', 'slsl', 'a;a;', 'fj', 'dk', 'sl', 'a;',
          'sad', 'lad', 'ask', 'all', 'fall', 'dads',
        ],
      },
    ],
  },
  {
    number: 2,
    title: 'Home row words',
    lessons: [
      {
        id: '2-1',
        title: 'Short words',
        objective: 'Real words, all on the home row. Muscle memory over meaning.',
        introduces: [],
        keys: [...HOME_LEFT, ...HOME_RIGHT],
        targetTokens: 32,
        pool: ['as', 'ad', 'all', 'ask', 'add', 'sad', 'lad', 'fad', 'dad', 'alas', 'lass', 'fall'],
      },
      {
        id: '2-2',
        title: 'Longer words',
        objective: 'Four and five letters without looking down.',
        introduces: [],
        keys: [...HOME_LEFT, ...HOME_RIGHT],
        targetTokens: 32,
        pool: ['fall', 'flak', 'lads', 'lass', 'salad', 'flask', 'falls', 'skald', 'alas', 'dads', 'salads'],
      },
      {
        id: '2-3',
        title: 'Mixed drill',
        objective: 'Words and drills together, at speed.',
        introduces: [],
        keys: [...HOME_LEFT, ...HOME_RIGHT],
        targetTokens: 40,
        pool: [
          'salad', 'flask', 'asdf', 'jkl;', 'falls', 'dads', 'ask', 'all', 'fall',
          'lass', 'skald', 'fjfj', 'dkdk', 'alas', 'flak', 'lads',
        ],
      },
    ],
  },
];

export function stage(number: number): Stage | null {
  return STAGES.find((s) => s.number === number) ?? null;
}

export function lessonAt(stageNumber: number, index: number): Lesson | null {
  return stage(stageNumber)?.lessons[index] ?? null;
}

/**
 * What each stage teaches, as data, independent of whether its lessons have
 * been authored yet. PRD 11 defines all ten stages; only 1 and 2 have lesson
 * content so far, but a profile placed into Stage 5 has demonstrably met the
 * upper and lower rows, and content filtered to "the lessons we happen to
 * have written" would hand an advanced typist home-row words.
 */
export const STAGE_KEYS: Record<number, string[]> = {
  1: [...HOME_LEFT, ...HOME_RIGHT],
  2: [], // words, no new keys
  3: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'g', 'h'],
  4: ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  5: [], // common words, no new keys
  6: [], // capitalisation: Shift, not new letters
  7: [',', '.', '?', '!', "'", '"', ':'],
  8: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  9: [],
  10: [],
};

/** Every key taught at or before the given stage. */
export function keysTaughtThrough(stageNumber: number): Set<string> {
  const keys = new Set<string>();
  for (let n = 1; n <= stageNumber; n++) {
    for (const k of STAGE_KEYS[n] ?? []) keys.add(k);
  }
  return keys;
}

/** Guards against a lesson pool that reaches for a key the lesson never taught. */
export function validateStages(): string[] {
  const problems: string[] = [];
  for (const s of STAGES) {
    for (const l of s.lessons) {
      const allowed = new Set(l.keys);
      for (const token of l.pool) {
        for (const ch of token) {
          if (!allowed.has(ch)) {
            problems.push(`${l.id} "${token}" uses ${JSON.stringify(ch)}, which the lesson does not teach`);
          }
        }
      }
      if (l.pool.length === 0) problems.push(`${l.id} has an empty pool`);
    }
  }
  return problems;
}

/** Serves a lesson's tokens without repeating any of the last three. */
export class LessonSource implements TokenSource {
  private rand: () => number;
  private recent: string[] = [];
  private pool: string[];

  constructor(lesson: Lesson, seed: number) {
    this.pool = lesson.pool;
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

export interface LessonOutcome {
  passed: boolean;
  accuracy: number;
  wpm: number;
  tokensCompleted: number;
  /** One line, PRD 11: on fail, show one diagnosis line and no extra punishment. */
  diagnosis: string;
}

/**
 * PRD 12 pass criteria: 90% accuracy and the stage's WPM floor. Nothing else.
 * A lesson is not failed for dying; death is a checkpoint retry (PRD 16).
 */
export function judgeLesson(
  stageNumber: number,
  accuracy: number,
  wpm: number,
  tokensCompleted: number,
  worstKey: { key: string; accuracy: number } | null,
): LessonOutcome {
  const floor = STAGE_WPM_FLOOR[stageNumber] ?? 10;
  const accuracyOk = accuracy >= LESSON_MIN_ACCURACY;
  const speedOk = wpm >= floor;
  let diagnosis: string;
  if (accuracyOk && speedOk) {
    diagnosis = `${Math.round(accuracy * 100)}% at ${Math.round(wpm)} WPM.`;
  } else if (!accuracyOk && worstKey) {
    diagnosis = `${Math.round(accuracy * 100)}% accuracy, ${Math.round(LESSON_MIN_ACCURACY * 100)}% needed. ${worstKey.key.toUpperCase()} was your slipperiest key at ${Math.round(worstKey.accuracy * 100)}%.`;
  } else if (!accuracyOk) {
    diagnosis = `${Math.round(accuracy * 100)}% accuracy, ${Math.round(LESSON_MIN_ACCURACY * 100)}% needed. Slow down; speed follows accuracy.`;
  } else {
    diagnosis = `${Math.round(wpm)} WPM, ${floor} needed. Accuracy is there, so this is just reps.`;
  }
  return { passed: accuracyOk && speedOk, accuracy, wpm, tokensCompleted, diagnosis };
}
