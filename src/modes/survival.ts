/**
 * Survival mode. PRD Sections 16, 17, 18.
 *
 * Continuous waves, and the one law of the scaling rule: complexity climbs,
 * raw speed does not. Typing speed has a physical ceiling, so waves get
 * harder by queueing more enemies, drawing longer and rarer vocabulary, and
 * thickening capitalization, punctuation, and number density -- never by
 * demanding a rate the player has not already demonstrated. The spawn
 * interval is floored against the profile's demonstrated PEAK (PRD 18:
 * "required completion speed never exceeds roughly the profile's
 * demonstrated peak WPM").
 *
 * The complexity levers also respect the curriculum (PRD 20: content is
 * filtered to taught keys). A Stage 5 profile ramps through crowd size and
 * vocabulary; capitals only join once Stage 6 taught them, numbers after
 * Stage 8, sentences after Stage 9. Survival never asks for a key no lesson
 * has introduced.
 *
 * All numbers [REVIEW]: run feel, to be tuned against real family runs.
 */

import { mulberry32, pickFresh } from '../util/rand';
import { wordsFor } from './speedtest';
import { STAGES } from '../curriculum/stages';
import type { EnemyKind } from '../game/scoring';
import type { Profile } from '../profile/types';

// ---------- Health (PRD 16) ----------
export const MAX_HEALTH = 100;
/** The full error stack (PRD 5): a small drain, punished exactly once. */
export const MISS_DRAIN = 2;
/** Drain per second at point-blank; scales down with distance. */
export const THREAT_DRAIN_PER_S = 1.1;
/** Healed on clearing a wave. Breathers matter; full resets do not. */
export const WAVE_HEAL = 8;
/** Heartbeat warning thresholds (audio builds as health falls, PRD 16). */
export const HEARTBEAT_AT = 35;
export const HEARTBEAT_URGENT_AT = 18;

/**
 * Threat drain scaled by the nearest enemy's closeness (0 = just spawned,
 * 1 = at the kill line). Standing in an empty room costs nothing.
 */
export function threatDrainPerS(closeness: number): number {
  const c = Math.min(1, Math.max(0, closeness));
  return THREAT_DRAIN_PER_S * (0.3 + 0.7 * c);
}

// ---------- Wave plan (PRD 18 scaling) ----------
export interface WavePlan {
  wave: number;
  /** Kills required to clear the wave. */
  quota: number;
  spawnIntervalS: number;
  walkTimeS: number;
  crawlerChance: number;
  bruteChance: number;
}

export const QUOTA_BASE = 5;
export const QUOTA_PER_WAVE = 2;
export const QUOTA_CAP = 25;
/** Buffer over demonstrated pace: starts Learn-like, thins to nearly nothing. */
export const WAVE_BUFFER_START = 0.35;
export const WAVE_BUFFER_STEP = 0.05;
export const WAVE_BUFFER_FLOOR = 0.05;
/** Peak guard: implied throughput never exceeds this share of demonstrated peak. */
export const PEAK_SHARE = 0.9;
export const MIN_SPAWN_S = 2.2;
export const WALK_START_S = 26;
export const WALK_STEP_S = 1.5;
export const WALK_FLOOR_S = 15;
export const READ_BEAT_S = 0.9;

/**
 * The fastest the profile has ever demonstrated, in correct chars/second.
 * Speed-test peak first (it is the sustained-five-seconds reading), then the
 * best session, then placement, then a default that assumes little.
 */
export function demonstratedPeakCps(profile: Profile): number {
  const peaks = profile.speedTests.map((t) => t.peakWpm).filter((w) => w > 0);
  if (peaks.length) return (Math.max(...peaks) * 5) / 60;
  const sessions = profile.sessions.map((s) => s.wpm).filter((w) => w > 0);
  if (sessions.length) return (Math.max(...sessions) * 5) / 60;
  if (profile.placement && profile.placement.wpm > 0) return (profile.placement.wpm * 5) / 60;
  return (20 * 5) / 60; // a survival unlock implies at least modest typing
}

export function wavePlan(profile: Profile, wave: number, meanTokenChars: number): WavePlan {
  const peakCps = demonstratedPeakCps(profile);
  const buffer = Math.max(WAVE_BUFFER_FLOOR, WAVE_BUFFER_START - WAVE_BUFFER_STEP * (wave - 1));
  const needS = meanTokenChars / peakCps + READ_BEAT_S;
  // The peak guard: even at zero buffer, the interval never implies a rate
  // above PEAK_SHARE of what the player has actually shown.
  const peakFloorS = meanTokenChars / (peakCps * PEAK_SHARE);
  const spawnIntervalS = Math.max(MIN_SPAWN_S, peakFloorS, needS * (1 + buffer));

  return {
    wave,
    quota: Math.min(QUOTA_CAP, QUOTA_BASE + QUOTA_PER_WAVE * wave),
    spawnIntervalS,
    walkTimeS: Math.max(WALK_FLOOR_S, WALK_START_S - WALK_STEP_S * (wave - 1)),
    crawlerChance: Math.min(0.3, 0.05 + 0.05 * wave),
    bruteChance: wave >= 3 ? Math.min(0.2, 0.05 * (wave - 2)) : 0,
  };
}

// ---------- Content (PRD 18 levers + PRD 20 filtering) ----------
/** Longer, rarer vocabulary for the later waves. Filtered to taught keys. */
const RARE_WORDS = [
  'oxygen', 'wizard', 'jigsaw', 'quartz', 'sphinx', 'vortex', 'zephyr', 'galaxy',
  'lantern', 'monarch', 'phantom', 'reactor', 'specimen', 'corridor', 'membrane',
  'protocol', 'quarantine', 'laboratory', 'transmission', 'containment',
];

/** Standalone number tokens, once Stage 8 has taught the row. */
const NUMBER_TOKENS = ['10', '42', '88', '404', '1024', '2026', '7000', '365', '90210'];

/** Density curves: how thick each lever gets, by wave. All clamped. */
export function rareShare(wave: number): number {
  return Math.min(0.5, 0.1 * (wave - 1));
}
export function capitalDensity(wave: number): number {
  return Math.min(0.5, 0.08 * Math.max(0, wave - 1));
}
export function punctDensity(wave: number): number {
  return Math.min(0.6, 0.1 * Math.max(0, wave - 2));
}
export function numberShare(wave: number): number {
  return Math.min(0.2, 0.05 * Math.max(0, wave - 2));
}
export function sentenceShare(wave: number): number {
  return Math.min(0.3, 0.06 * Math.max(0, wave - 3));
}

const PUNCT_ENDINGS = ['.', ',', '!', '?'];

/**
 * Token provider for a survival run. Same EnemyTokenProvider port the
 * encounter already speaks; complexity comes from the wave, capability from
 * the taught-key set, and none of it ever conflicts because every lever
 * checks what the curriculum has introduced.
 */
export class SurvivalSource {
  private rand: () => number;
  private taught: Set<string>;
  private wave = 1;
  private recent: string[] = [];
  private words: string[];
  private rare: string[];
  private sentences: string[];
  private numbers: string[];
  private canCapitalize: boolean;
  private canPunctuate: boolean;

  constructor(taught: Set<string>, seed: number) {
    this.rand = mulberry32(seed);
    this.taught = taught;
    this.words = wordsFor(taught);
    this.rare = RARE_WORDS.filter((w) => [...w].every((ch) => taught.has(ch)));
    this.numbers = taught.has('1') ? NUMBER_TOKENS.filter((t) => [...t].every((ch) => taught.has(ch))) : [];
    // Sentences reuse the Stage 9 pools: content the curriculum already vetted.
    this.sentences = taught.has(' ')
      ? STAGES.filter((s) => s.number === 9).flatMap((s) => s.lessons.flatMap((l) => l.pool))
      : [];
    this.canCapitalize = taught.has('A');
    this.canPunctuate = taught.has('.');
  }

  setWave(wave: number): void {
    this.wave = Math.max(1, wave);
  }

  get meanTokenChars(): number {
    // Good enough for pacing: the plain word pool's mean, nudged up as rare
    // words join. Decorations add a char or two; the buffer absorbs them.
    const base = this.words.reduce((a, w) => a + w.length, 0) / Math.max(1, this.words.length);
    return base + rareShare(this.wave) * 2;
  }

  /** One token for a standard enemy, with the wave's decorations. */
  next(): string {
    const r = this.rand();
    if (this.sentences.length && r < sentenceShare(this.wave)) {
      return pickFresh(this.rand, this.sentences, this.recent);
    }
    if (this.numbers.length && r < sentenceShare(this.wave) + numberShare(this.wave)) {
      return pickFresh(this.rand, this.numbers, this.recent);
    }
    const pool = this.rare.length && this.rand() < rareShare(this.wave) ? this.rare : this.words;
    return this.decorate(pickFresh(this.rand, pool, this.recent));
  }

  tokensFor(kind: EnemyKind): string[] {
    if (kind === 'crawler') {
      // Recognition speed: the shortest undecorated words available.
      const short = this.words.filter((w) => w.length <= 4);
      return [pickFresh(this.rand, short.length ? short : this.words, this.recent)];
    }
    if (kind === 'brute') {
      // The heavy: rare and long where the pool allows, a sentence on top
      // when the curriculum does.
      const long = [...this.rare, ...this.words.filter((w) => w.length >= 6)];
      const pool = long.length ? long : this.words;
      const tokens = [
        this.decorate(pickFresh(this.rand, pool, this.recent)),
        this.decorate(pickFresh(this.rand, pool, this.recent)),
      ];
      tokens.push(
        this.sentences.length && this.rand() < 0.5
          ? pickFresh(this.rand, this.sentences, this.recent)
          : this.decorate(pickFresh(this.rand, pool, this.recent)),
      );
      return tokens;
    }
    return [this.next()];
  }

  /** Capitalization and punctuation density, PRD 18's levers. */
  private decorate(token: string): string {
    let out = token;
    if (this.canCapitalize && /^[a-z]/.test(out) && this.rand() < capitalDensity(this.wave)) {
      out = out[0].toUpperCase() + out.slice(1);
    }
    if (this.canPunctuate && this.rand() < punctDensity(this.wave)) {
      const endings = PUNCT_ENDINGS.filter((p) => this.taught.has(p));
      if (endings.length) out += endings[Math.floor(this.rand() * endings.length)];
    }
    return out;
  }
}

// ---------- Records (PRD 21) ----------
export interface SurvivalResult {
  wave: number;
  kills: number;
  score: number;
  at: string;
}

export function isNewBest(previous: SurvivalResult | null, run: SurvivalResult): boolean {
  if (!previous) return true;
  if (run.wave !== previous.wave) return run.wave > previous.wave;
  return run.score > previous.score;
}
