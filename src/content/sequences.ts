/**
 * Phase 0 content: home-row sequences and a curated mini-lexicon.
 * PRD Sections 11, 20. Content is filtered to taught keys and varies
 * between runs; memorizing a script is not viable.
 */

const DRILLS = ['fj', 'jf', 'ff', 'jj', 'fjf', 'jfj', 'asdf', 'jkl;', 'aa', 'ss', 'dd', 'kk', 'll'];

// Hand-curated words spellable on the home row (a s d f j k l ;).
const HOME_ROW_WORDS = [
  'as', 'ad', 'add', 'ask', 'all', 'fall', 'lad', 'lads', 'lass', 'dad',
  'sad', 'salad', 'flask', 'falls', 'skald', 'alas', 'dads', 'flak',
];

export interface TokenSource {
  next(): string;
}

/** Deterministic PRNG so tests can pin sequences; seeded from time in game. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class HomeRowSource implements TokenSource {
  private rand: () => number;
  private recent: string[] = [];

  constructor(seed: number) {
    this.rand = mulberry32(seed);
  }

  next(): string {
    // 40% drills, 60% words; never repeat any of the last 3 tokens.
    for (let attempt = 0; attempt < 20; attempt++) {
      const pool = this.rand() < 0.4 ? DRILLS : HOME_ROW_WORDS;
      const token = pool[Math.floor(this.rand() * pool.length)];
      if (!this.recent.includes(token)) {
        this.recent.push(token);
        if (this.recent.length > 3) this.recent.shift();
        return token;
      }
    }
    return HOME_ROW_WORDS[Math.floor(this.rand() * HOME_ROW_WORDS.length)];
  }
}

/** Every character the Phase 0 source can emit (for validation/tests). */
export const TAUGHT_KEYS = new Set(['a', 's', 'd', 'f', 'j', 'k', 'l', ';']);

export function allPhase0Tokens(): string[] {
  return [...DRILLS, ...HOME_ROW_WORDS];
}
