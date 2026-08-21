import { describe, it, expect } from 'vitest';
import {
  AdaptiveSource,
  INJECTION_OFF_ABOVE,
  LOW_EXPOSURE_FLOOR_RATE,
  MAX_CONSECUTIVE_WEAK,
  WEAK_INJECTION_MAX,
  planFor,
  practiceNote,
  type AdaptivePlan,
} from '../src/curriculum/adaptive';
import { STAGES, type Lesson } from '../src/curriculum/stages';
import { createProfile } from '../src/profile/store';
import { absorbSamples } from '../src/profile/mastery';
import type { KeySample, StatContext } from '../src/stats/keystats';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const DAY = 86_400_000;
/** Stage 2 mixed drill: the widest pool in the built curriculum. */
const LESSON: Lesson = STAGES[1].lessons[2];

function plan(over: Partial<AdaptivePlan> = {}): AdaptivePlan {
  return { weak: new Set(), lowExposure: new Set(), passthrough: false, ...over };
}

function samples(key: string, n: number, correct = true, interKeyMs = 150): KeySample[] {
  return Array.from({ length: n }, () => ({
    expected: key,
    pressed: correct ? key : 'x',
    correct,
    context: 'combat' as StatContext,
    interKeyMs,
    firstKeyLatencyMs: null,
  }));
}

function masterKey(p: ReturnType<typeof createProfile>, key: string): void {
  absorbSamples(p, samples(key, 20), { now: new Date(NOW.getTime() - DAY), sessionId: 's1' });
  absorbSamples(p, samples(key, 20), { now: NOW, sessionId: 's2' });
}

function serve(source: AdaptiveSource, n: number): string[] {
  return Array.from({ length: n }, () => source.next());
}

describe('weak-key injection (PRD 13)', () => {
  it('over-represents a weak key without exceeding the cap', () => {
    const source = new AdaptiveSource(LESSON, plan({ weak: new Set(['k']) }), 1);
    serve(source, 200);
    const mix = source.mix;
    const share = mix.weak / mix.served;
    expect(share).toBeGreaterThan(0.2); // it is actually being practised
    expect(share).toBeLessThanOrEqual(WEAK_INJECTION_MAX); // and still a shootout
  });

  it('never runs more than two weak tokens back to back', () => {
    const source = new AdaptiveSource(LESSON, plan({ weak: new Set(['k', 'd']) }), 7);
    const tokens = serve(source, 300);
    let run = 0;
    for (const token of tokens) {
      const isWeak = [...token].some((c) => c === 'k' || c === 'd');
      run = isWeak ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(MAX_CONSECUTIVE_WEAK);
    }
  });

  it('surrounds weak keys with keys the player owns', () => {
    const source = new AdaptiveSource(LESSON, plan({ weak: new Set(['k']) }), 3);
    for (const token of serve(source, 100)) {
      if (token.includes('k')) {
        // Every served token containing the weak key also carries an anchor,
        // so the sequence still completes and the gun still fires.
        expect([...token].some((c) => c !== 'k')).toBe(true);
      }
    }
  });

  it('gives low-exposure keys a floor so they can earn their own evaluation', () => {
    const source = new AdaptiveSource(LESSON, plan({ lowExposure: new Set([';']) }), 5);
    serve(source, 200);
    expect(source.mix.lowExposure / source.mix.served).toBeGreaterThanOrEqual(LOW_EXPOSURE_FLOOR_RATE);
  });

  it('still serves plenty the player can land cleanly', () => {
    const source = new AdaptiveSource(LESSON, plan({ weak: new Set(['k']) }), 11);
    const tokens = serve(source, 200);
    const clean = tokens.filter((t) => !t.includes('k')).length;
    expect(clean / tokens.length).toBeGreaterThan(0.5);
  });

  it('does not repeat inside the last three tokens', () => {
    const source = new AdaptiveSource(LESSON, plan({ weak: new Set(['k']) }), 13);
    const window: string[] = [];
    for (const token of serve(source, 200)) {
      expect(window).not.toContain(token);
      window.push(token);
      if (window.length > 3) window.shift();
    }
  });

  it('is deterministic for a seed, so a run can be reproduced', () => {
    const a = serve(new AdaptiveSource(LESSON, plan({ weak: new Set(['k']) }), 42), 50);
    const b = serve(new AdaptiveSource(LESSON, plan({ weak: new Set(['k']) }), 42), 50);
    expect(a).toEqual(b);
  });
});

describe('when injection should not happen at all', () => {
  it('passes through when nearly every key in the lesson is weak', () => {
    // Stage 1 lesson 1 teaches F and J. On a first run both are weak, and
    // "over-represent the weak keys" would just mean "serve the lesson".
    const p = createProfile('T');
    const built = planFor(p, STAGES[0].lessons[0]);
    expect(built.passthrough).toBe(true);
  });

  it('turns injection on once most of the lesson is owned', () => {
    const p = createProfile('T');
    for (const k of ['a', 's', 'd', 'f', 'j', 'l', ';']) masterKey(p, k);
    const built = planFor(p, LESSON);
    expect(built.passthrough).toBe(false);
    expect(built.weak.has('k')).toBe(true); // the one never practised
  });

  it('leaves the mix alone when nothing is weak', () => {
    const source = new AdaptiveSource(LESSON, plan(), 17);
    serve(source, 100);
    expect(source.mix.weak).toBe(0);
  });

  it('holds the threshold it documents', () => {
    expect(INJECTION_OFF_ABOVE).toBeGreaterThan(0.5);
    expect(WEAK_INJECTION_MAX).toBeLessThanOrEqual(0.4); // PRD 13 says 25-40%
  });
});

describe('what the player is told', () => {
  it('says nothing when nothing has slipped', () => {
    const p = createProfile('T');
    for (const k of ['a', 's', 'd', 'f', 'j', 'k', 'l', ';']) masterKey(p, k);
    expect(practiceNote(p, planFor(p, LESSON))).toBeNull();
  });

  it('mentions a key that decayed, without calling it a failure', () => {
    const p = createProfile('T');
    for (const k of ['a', 's', 'd', 'f', 'j', 'k', 'l', ';']) masterKey(p, k);
    absorbSamples(p, samples('d', 40, false), { now: NOW, sessionId: 's3' });
    const note = practiceNote(p, planFor(p, LESSON));
    expect(note).toContain('D');
    expect(note).not.toMatch(/forgot|failed|bad|weak/i);
  });
});
