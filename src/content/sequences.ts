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

export { mulberry32 } from '../util/rand';
import { mulberry32 } from '../util/rand';

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

/**
 * A source plus a look-ahead buffer. PRD Section 6: the player must be able to
 * read the next prompt before the current one is finished. Waiting to see the
 * next word costs a full reading beat, which caps speed harder than fingers do.
 *
 * The queue is authoritative: whatever is drawn as "coming up" is exactly what
 * `advance()` will hand out next, so the display can never lie.
 */
export class TokenQueue {
  private source: TokenSource;
  private buffer: string[] = [];
  private depth: number;

  /** @param depth how many tokens beyond the active one to keep resolved. */
  constructor(source: TokenSource, depth = 4) {
    this.source = source;
    this.depth = Math.max(1, depth);
    this.fill();
  }

  private fill(): void {
    while (this.buffer.length < this.depth + 1) this.buffer.push(this.source.next());
  }

  /** The token being typed right now. */
  get current(): string {
    return this.buffer[0];
  }

  /** The next `count` tokens, in the order they will arrive. */
  upcoming(count: number): string[] {
    if (count <= 0) return [];
    if (count > this.depth) {
      this.depth = count;
      this.fill();
    }
    return this.buffer.slice(1, 1 + count);
  }

  /** Retire the active token and return the new one. */
  advance(): string {
    this.buffer.shift();
    this.fill();
    return this.buffer[0];
  }

  /** Rebuild from a fresh source (new encounter, retry). */
  reset(source?: TokenSource): void {
    if (source) this.source = source;
    this.buffer = [];
    this.fill();
  }
}

/** Every character the Phase 0 source can emit (for validation/tests). */
export const TAUGHT_KEYS = new Set(['a', 's', 'd', 'f', 'j', 'k', 'l', ';']);

export function allPhase0Tokens(): string[] {
  return [...DRILLS, ...HOME_ROW_WORDS];
}
