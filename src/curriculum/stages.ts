/**
 * Curriculum: all ten stages. PRD Sections 11, 12.
 *
 * Progression is intentional, never random text. Each lesson names the keys it
 * introduces, and its content is filtered to keys the profile has been taught.
 * From finding the F and J bumps to typing full transmissions under fire.
 */

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
const HOME = [...HOME_LEFT, ...HOME_RIGHT];

/*
 * Cumulative key sets for Stages 3-4. Each lesson's `keys` is everything
 * taught so far, so pools can always mix new keys with mastered ones -- the
 * PRD's "keys added in small groups, mixed with mastered keys". The
 * validateStages() test holds every pool word to its lesson's set.
 */
const K_GH = [...HOME, 'g', 'h'];
const K_EI = [...K_GH, 'e', 'i'];
const K_RU = [...K_EI, 'r', 'u'];
const K_TY = [...K_RU, 't', 'y'];
const K_WO = [...K_TY, 'w', 'o'];
const K_QP = [...K_WO, 'q', 'p']; // the full Stage 3 set
const K_NM = [...K_QP, 'n', 'm'];
const K_CV = [...K_NM, 'c', 'v'];
const K_ALL = [...K_CV, 'b', 'x', 'z']; // the full letter set

/*
 * Stage 6+: shifted characters, punctuation, digits, and finally the space.
 * Capitals are chords, not keys -- they are tracked per-character but never
 * gate a stage (see mastery.ts). LEFT_CAPS take the right Shift and
 * RIGHT_CAPS the left, which is why Stage 6 splits along the hands.
 */
const LEFT_CAPS = [...'QWERTASDFGZXCVB'];
const RIGHT_CAPS = [...'YUIOPHJKLNM'];
const ALL_CAPS = [...LEFT_CAPS, ...RIGHT_CAPS];
const K_CAPS = [...K_ALL, ...ALL_CAPS];
const K_P1 = [...K_CAPS, ',', '.'];
const K_P2 = [...K_P1, "'", '"'];
const K_PUNCT = [...K_P2, '?', '!', ':'];
const K_D1 = [...K_PUNCT, '4', '5', '6', '7'];
const K_D2 = [...K_D1, '3', '8', '2', '9'];
const K_DIGITS = [...K_D2, '1', '0'];
const K_SPACE = [...K_DIGITS, ' '];

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
  {
    number: 3,
    title: 'Upper row',
    lessons: [
      {
        id: '3-1',
        title: 'G and H',
        objective: 'Index fingers stretch inward without leaving the bumps.',
        introduces: ['g', 'h'],
        keys: K_GH,
        targetTokens: 28,
        pool: [
          'fgf', 'jhj', 'gg', 'hh', 'gas', 'has', 'had', 'hall', 'half', 'glad',
          'flag', 'dash', 'gash', 'flash', 'shall', 'glass', 'slash',
        ],
      },
      {
        id: '3-2',
        title: 'E and I',
        objective: 'Middle fingers reach up. The two most common letters in English.',
        introduces: ['e', 'i'],
        keys: K_EI,
        targetTokens: 28,
        pool: [
          'ded', 'kik', 'die', 'lie', 'aid', 'said', 'side', 'idea', 'fail', 'jail',
          'seal', 'deal', 'idle', 'hide', 'edge', 'slide', 'field', 'ladies',
        ],
      },
      {
        id: '3-3',
        title: 'R and U',
        objective: 'Index fingers reach up, then straight back to the bumps.',
        introduces: ['r', 'u'],
        keys: K_RU,
        targetTokens: 28,
        pool: [
          'frf', 'juj', 'rule', 'sure', 'user', 'rise', 'fire', 'ride', 'urge', 'huge',
          'raid', 'fuel', 'usher', 'surge', 'ruler', 'desire', 'failure', 'hurried',
        ],
      },
      {
        id: '3-4',
        title: 'T and Y',
        objective: 'The long index stretches. This unlocks the most common word there is.',
        introduces: ['t', 'y'],
        keys: K_TY,
        targetTokens: 30,
        pool: [
          'ftf', 'jyj', 'the', 'try', 'yet', 'day', 'they', 'that', 'this', 'test',
          'tell', 'salt', 'last', 'late', 'style', 'daily', 'eight', 'thirty', 'turtle', 'reality',
        ],
      },
      {
        id: '3-5',
        title: 'W and O',
        objective: 'Ring fingers reach up. Whole sentences become possible.',
        introduces: ['w', 'o'],
        keys: K_WO,
        targetTokens: 30,
        pool: [
          'sws', 'lol', 'who', 'how', 'two', 'low', 'row', 'word', 'work', 'world',
          'would', 'house', 'water', 'other', 'wrote', 'yellow', 'follow', 'hollow', 'shadow', 'weather',
        ],
      },
      {
        id: '3-6',
        title: 'Q and P',
        objective: 'The little fingers earn their keep.',
        introduces: ['q', 'p'],
        keys: K_QP,
        targetTokens: 30,
        pool: [
          'aqa', ';p;', 'up', 'put', 'pay', 'play', 'stop', 'pull', 'push', 'quit',
          'quiet', 'quite', 'equal', 'paper', 'people', 'purple', 'quote', 'square', 'request', 'popular',
        ],
      },
      {
        id: '3-7',
        title: 'The whole upper row',
        objective: 'Everything above the bumps, together, at speed.',
        introduces: [],
        keys: K_QP,
        targetTokens: 34,
        pool: [
          'typewriter', 'together', 'yesterday', 'whisper', 'perhaps', 'thought',
          'quality', 'require', 'property', 'authority', 'weight', 'youth',
          'appropriate', 'territory', 'query', 'pilot',
        ],
      },
    ],
  },
  {
    number: 4,
    title: 'Lower row',
    lessons: [
      {
        id: '4-1',
        title: 'N and M',
        objective: 'Index fingers reach down. The bottom row begins.',
        introduces: ['n', 'm'],
        keys: K_NM,
        targetTokens: 30,
        pool: [
          'jnj', 'jmj', 'man', 'men', 'name', 'mean', 'main', 'many', 'nine', 'mine',
          'human', 'night', 'money', 'moment', 'women', 'morning', 'nothing', 'mountain',
        ],
      },
      {
        id: '4-2',
        title: 'C and V',
        objective: 'Middle and index reach down without dragging the hand.',
        introduces: ['c', 'v'],
        keys: K_CV,
        targetTokens: 30,
        pool: [
          'dcd', 'fvf', 'can', 'cave', 'over', 'have', 'give', 'love', 'move', 'once',
          'come', 'very', 'voice', 'never', 'every', 'cover', 'chance', 'service', 'receive', 'discover',
        ],
      },
      {
        id: '4-3',
        title: 'B, X and Z',
        objective: 'The rare corners. Low mileage, but they have to be there.',
        introduces: ['b', 'x', 'z'],
        keys: K_ALL,
        targetTokens: 30,
        pool: [
          'fbf', 'sxs', 'aza', 'box', 'six', 'mix', 'zero', 'size', 'zone', 'lazy',
          'buzz', 'maybe', 'about', 'extra', 'exact', 'crazy', 'zebra', 'dozen', 'number', 'because',
        ],
      },
      {
        id: '4-4',
        title: 'The whole alphabet',
        objective: 'Every letter on the board, no favourites.',
        introduces: [],
        keys: K_ALL,
        targetTokens: 34,
        pool: [
          'quickly', 'example', 'subject', 'amazing', 'freezing', 'complex', 'organize',
          'jacket', 'objective', 'maximize', 'vibrant', 'squeeze', 'oxygen', 'wizard', 'combine', 'puzzled',
        ],
      },
    ],
  },
  {
    number: 5,
    title: 'Common words',
    lessons: [
      {
        id: '5-1',
        title: 'The words you type most',
        objective: 'The short words that make up half of everything ever written.',
        introduces: [],
        keys: K_ALL,
        targetTokens: 36,
        pool: [
          'the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but',
          'from', 'they', 'say', 'her', 'she', 'will', 'one', 'all', 'would', 'there',
          'their', 'what',
        ],
      },
      {
        id: '5-2',
        title: 'Longer common words',
        objective: 'Words with shape. Rhythm over hunting.',
        introduces: [],
        keys: K_ALL,
        targetTokens: 32,
        pool: [
          'people', 'because', 'through', 'thought', 'between', 'important', 'different',
          'together', 'question', 'another', 'sentence', 'example', 'government',
          'interest', 'remember', 'children',
        ],
      },
      {
        id: '5-3',
        title: 'Sprint',
        objective: 'Everything so far, and the clock is not your friend.',
        introduces: [],
        keys: K_ALL,
        targetTokens: 44,
        pool: [
          'world', 'should', 'against', 'himself', 'country', 'problem', 'however',
          'without', 'national', 'business', 'the', 'and', 'that', 'people', 'because',
          'through', 'between', 'question', 'different', 'important',
        ],
      },
    ],
  },
  {
    number: 6,
    title: 'Capitals',
    lessons: [
      {
        id: '6-1',
        title: 'Right Shift',
        objective: 'A left-hand capital takes the RIGHT Shift. The other hand always carries it.',
        introduces: LEFT_CAPS,
        keys: [...K_ALL, ...LEFT_CAPS],
        targetTokens: 26,
        pool: [
          'The', 'That', 'This', 'Stop', 'Dark', 'Fast', 'Gate', 'Water', 'Cave',
          'Best', 'Red', 'Green', 'Take', 'Give', 'Salt', 'Every', 'Winter', 'Someone',
        ],
      },
      {
        id: '6-2',
        title: 'Left Shift',
        objective: 'A right-hand capital takes the LEFT Shift. Mirror of the last lesson.',
        introduces: RIGHT_CAPS,
        keys: K_CAPS,
        targetTokens: 26,
        pool: [
          'Yes', 'You', 'Under', 'Ice', 'Open', 'Post', 'Hold', 'Jump', 'Keep',
          'Lock', 'Note', 'Move', 'Iron', 'Old', 'Hunt', 'Maybe', 'Puzzle', 'Kansas',
        ],
      },
      {
        id: '6-3',
        title: 'Proper names',
        objective: 'Both Shifts, decided per word, without looking down.',
        introduces: [],
        keys: K_CAPS,
        targetTokens: 28,
        pool: [
          'Jeff', 'Monday', 'Friday', 'June', 'March', 'Kansas', 'Idaho', 'London',
          'Paris', 'Utah', 'Nevada', 'Oregon', 'August', 'Sunday', 'Dakota', 'Texas',
        ],
      },
    ],
  },
  {
    number: 7,
    title: 'Punctuation',
    lessons: [
      {
        id: '7-1',
        title: 'Period and comma',
        objective: 'Right ring and middle reach down. Sentences get their endings.',
        introduces: [',', '.'],
        keys: K_P1,
        targetTokens: 28,
        pool: [
          'end.', 'yes,', 'no,', 'stop.', 'wait,', 'done.', 'one,', 'two.', 'okay.',
          'fine,', 'later.', 'first,', 'last.', 'Note.', 'Now,', 'Here.',
        ],
      },
      {
        id: '7-2',
        title: 'Apostrophe and quotes',
        objective: 'Right little finger, home row. The quote is the same key, shifted.',
        introduces: ["'", '"'],
        keys: K_P2,
        targetTokens: 28,
        pool: [
          "don't", "it's", "can't", "won't", "isn't", "I'm", "they're", "we're",
          '"go"', '"run"', '"stay"', '"hello"', "you're", "didn't", "That's", "wasn't",
        ],
      },
      {
        id: '7-3',
        title: 'Question, exclamation, colon',
        objective: 'All three are shifted keys you already know.',
        introduces: ['?', '!', ':'],
        keys: K_PUNCT,
        targetTokens: 28,
        pool: [
          'why?', 'how?', 'now!', 'run!', 'no!', 'wait!', 'note:', 'time:', 'who?',
          'really?', 'listen!', 'warning:', 'What?', 'Go!', 'Where?', 'Danger:',
        ],
      },
    ],
  },
  {
    number: 8,
    title: 'Numbers',
    lessons: [
      {
        id: '8-1',
        title: '4 5 6 7',
        objective: 'Index fingers reach for the number row first. Eyes stay on the text.',
        introduces: ['4', '5', '6', '7'],
        keys: K_D1,
        targetTokens: 26,
        pool: ['f4f', 'j7j', '45', '67', '474', '567', '4567', '7654', '44', '77', '56', '65', '4747', '5665'],
      },
      {
        id: '8-2',
        title: '3 8 2 9',
        objective: 'Middle and ring fingers up. The stretch is longer than it feels.',
        introduces: ['3', '8', '2', '9'],
        keys: K_D2,
        targetTokens: 26,
        pool: ['d3d', 'k8k', 's2s', 'l9l', '38', '29', '2938', '3829', '223', '889', '392', '823', '2389', '9832'],
      },
      {
        id: '8-3',
        title: '1, 0, and years',
        objective: 'Little fingers take the corners. Competence under pressure, not blind speed.',
        introduces: ['1', '0'],
        keys: K_DIGITS,
        targetTokens: 26,
        pool: ['a1a', ';0;', '10', '100', '2026', '1999', '1010', '8675', '404', '1024', '7000', '365', '2001', '90210'],
      },
    ],
  },
  {
    number: 9,
    title: 'Sentences',
    lessons: [
      {
        id: '9-1',
        title: 'Short sentences',
        objective: 'The space bar joins. A thumb press between every word, without breaking rhythm.',
        introduces: [' '],
        keys: K_SPACE,
        targetTokens: 16,
        pool: [
          'The lab is dark.', 'They are close.', 'Hold the line.', 'Run to the door.',
          'It is quiet now.', 'Do not look back.', 'The lights are out.', 'Stay with me.',
          'We move at dawn.', 'Keep your hands up.',
        ],
      },
      {
        id: '9-2',
        title: 'Longer sentences',
        objective: 'Whole thoughts under pressure. Accuracy first, always.',
        introduces: [],
        keys: K_SPACE,
        targetTokens: 12,
        pool: [
          'Something is moving in the fog.', 'The door will not hold for long.',
          'Type like your life depends on it.', 'Nobody has heard from the lab.',
          'The generator hums behind the wall.', 'Her name was on the last report.',
          "Don't stop until the room is clear.", 'Is anyone still out there?',
        ],
      },
    ],
  },
  {
    number: 10,
    title: 'Paragraphs',
    lessons: [
      {
        id: '10-1',
        title: 'Transmissions',
        objective: 'Long messages, typed clean, while they close the distance.',
        introduces: [],
        keys: K_SPACE,
        targetTokens: 8,
        pool: [
          'We found the source of the signal. It was never human.',
          'Do not open the inner door. Nothing in here is asleep.',
          'If you can read this, the vaccine failed. Run.',
          'The last team went quiet after the second floor.',
          'Power is failing. The dark is full of small sounds.',
          'Leave the samples. Take the notes. Seal everything.',
          'Something answered the radio check. We never broadcast.',
          'The cold room is warm. I do not want to know why.',
        ],
      },
      {
        id: '10-2',
        title: 'The last door',
        objective: 'Everything the game ever taught, in one long breath.',
        introduces: [],
        keys: K_SPACE,
        targetTokens: 8,
        pool: [
          'Access code 4471 accepted. Door seals in 10 seconds.',
          'Specimen 8 is awake. Repeat: Specimen 8 is awake.',
          'Level 3 lockdown begins now. Luck to whoever reads this.',
          "Don't stop typing. It can hear the silence.",
          'Protocol 9: burn everything. Sign it with your name.',
          'This is the last door. After this, the morning.',
          'Whoever taught you to type like that saved your life.',
          'Clearance granted. Welcome back to the surface, survivor.',
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
  // Capitals are chords: taught and tracked per character, never gate-blocking
  // (mastery.ts waives shifted characters from every gate).
  6: ALL_CAPS,
  7: [',', '.', "'", '"', '?', '!', ':'],
  8: ['4', '5', '6', '7', '3', '8', '2', '9', '1', '0'],
  9: [' '],
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
