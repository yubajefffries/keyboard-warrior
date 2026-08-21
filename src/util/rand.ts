/** Deterministic PRNG so runs and tests can be pinned to a seed. */
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

/**
 * Pick from `pool`, avoiding anything in `recent`, and record the choice.
 * The no-repeat window is what stops a small pool from serving the same token
 * twice in a row; every token source in the game wants exactly this, so it
 * lives once here instead of five near-copies.
 */
export function pickFresh(rand: () => number, pool: string[], recent: string[], memory = 3): string {
  const fresh = pool.filter((t) => !recent.includes(t));
  const options = fresh.length ? fresh : pool;
  const token = options[Math.floor(rand() * options.length)];
  recent.push(token);
  if (recent.length > memory) recent.shift();
  return token;
}
