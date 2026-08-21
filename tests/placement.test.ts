import { describe, it, expect } from 'vitest';
import {
  PlacementScorer,
  PlacementSource,
  routeFor,
  WORD_UNLOCK_MIN_TOKENS,
  type PlacementScore,
} from '../src/placement/placement';

function score(over: Partial<PlacementScore> = {}): PlacementScore {
  return {
    correctChars: 300,
    totalPresses: 310,
    errors: 10,
    elapsedMs: 60_000,
    accuracy: 0.97,
    wpm: 60,
    homeRowAccuracy: 0.98,
    otherAccuracy: 0.96,
    otherPresses: 120,
    reachedWords: true,
    ...over,
  };
}

describe('placement routing (PRD 3.3)', () => {
  it('sends a clean fast typist straight past the primer', () => {
    const r = routeFor(score());
    expect(r.route).toBe('advanced');
    expect(r.stage).toBe(5);
  });

  it('sends a solid home row with shaky speed to Intermediate', () => {
    const r = routeFor(score({ wpm: 30, accuracy: 0.93, otherAccuracy: 0.8 }));
    expect(r.route).toBe('intermediate');
    expect(r.stage).toBe(3); // upper row: they have not shown the rest of the keyboard
  });

  it('starts Intermediate at common words when the whole keyboard is clean', () => {
    const r = routeFor(score({ wpm: 30, accuracy: 0.95, otherAccuracy: 0.97, otherPresses: 60 }));
    expect(r.route).toBe('intermediate');
    expect(r.stage).toBe(5);
  });

  it('sends a hunt-and-peck player to Stage 1', () => {
    const r = routeFor(score({ wpm: 12, accuracy: 0.7, homeRowAccuracy: 0.68, reachedWords: false }));
    expect(r.route).toBe('beginner');
    expect(r.stage).toBe(1);
  });

  it('does not place anyone high off a drill they barely typed', () => {
    const r = routeFor(score({ totalPresses: 8, wpm: 90, accuracy: 1 }));
    expect(r.route).toBe('beginner');
    expect(r.reason).toContain('Not enough typed');
  });

  it('never routes Advanced without the word phase', () => {
    const r = routeFor(score({ reachedWords: false }));
    expect(r.route).not.toBe('advanced');
  });

  it('gives a reason that talks about what to do next, not about the player', () => {
    for (const s of [score(), score({ wpm: 12, accuracy: 0.6, homeRowAccuracy: 0.6 })]) {
      expect(routeFor(s).reason.length).toBeGreaterThan(10);
      expect(routeFor(s).reason).not.toMatch(/bad|poor|slow typist/i);
    }
  });
});

describe('placement drill', () => {
  it('starts on letters and promotes to words only when accuracy holds', () => {
    const source = new PlacementSource(5);
    expect(source.phase).toBe('letters');
    for (let i = 0; i < WORD_UNLOCK_MIN_TOKENS; i++) {
      source.next();
      source.considerPromotion(0.99);
    }
    expect(source.phase).toBe('words');
  });

  it('keeps a struggling player on letters for the whole drill', () => {
    const source = new PlacementSource(5);
    for (let i = 0; i < 40; i++) {
      source.next();
      source.considerPromotion(0.6);
    }
    expect(source.phase).toBe('letters');
    expect(source.reachedWords).toBe(false);
  });

  it('splits home-row accuracy from the rest of the keyboard', () => {
    const scorer = new PlacementScorer();
    for (let i = 0; i < 10; i++) scorer.record('f', true);
    for (let i = 0; i < 10; i++) scorer.record('t', i < 5);
    const s = scorer.score(60_000, true);
    expect(s.homeRowAccuracy).toBe(1);
    expect(s.otherAccuracy).toBe(0.5);
    expect(s.accuracy).toBe(0.75);
  });

  it('computes WPM by the standard definition', () => {
    const scorer = new PlacementScorer();
    for (let i = 0; i < 250; i++) scorer.record('f', true);
    expect(scorer.score(60_000, true).wpm).toBe(50); // 250 chars / 5 per word / 1 min
  });
});
