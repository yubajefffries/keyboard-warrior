import { describe, it, expect } from 'vitest';
import { TokenQueue, HomeRowSource, TAUGHT_KEYS, type TokenSource } from '../src/content/sequences';

/** Counts up so the order is obvious in assertions. */
class CountingSource implements TokenSource {
  private n = 0;
  next(): string {
    return `t${this.n++}`;
  }
}

describe('TokenQueue (look-ahead, PRD 6)', () => {
  it('shows exactly the tokens that will arrive, in order', () => {
    const q = new TokenQueue(new CountingSource(), 4);
    expect(q.current).toBe('t0');
    expect(q.upcoming(3)).toEqual(['t1', 't2', 't3']);
    expect(q.advance()).toBe('t1');
    expect(q.current).toBe('t1');
    expect(q.upcoming(3)).toEqual(['t2', 't3', 't4']);
  });

  it('never re-reads: what was shown as next becomes current unchanged', () => {
    const q = new TokenQueue(new HomeRowSource(7), 4);
    for (let i = 0; i < 50; i++) {
      const promised = q.upcoming(1)[0];
      expect(q.advance()).toBe(promised);
    }
  });

  it('grows the buffer when the player asks for more look-ahead', () => {
    const q = new TokenQueue(new CountingSource(), 1);
    expect(q.upcoming(1)).toEqual(['t1']);
    expect(q.upcoming(4)).toEqual(['t1', 't2', 't3', 't4']);
    expect(q.advance()).toBe('t1'); // the extra depth did not skip anything
  });

  it('returns nothing for zero look-ahead (one-word-at-a-time mode)', () => {
    const q = new TokenQueue(new CountingSource(), 4);
    expect(q.upcoming(0)).toEqual([]);
    expect(q.current).toBe('t0');
  });

  it('only ever emits taught keys', () => {
    const q = new TokenQueue(new HomeRowSource(99), 4);
    for (let i = 0; i < 200; i++) {
      for (const ch of q.current) expect(TAUGHT_KEYS.has(ch)).toBe(true);
      q.advance();
    }
  });
});
