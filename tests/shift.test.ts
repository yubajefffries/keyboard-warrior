import { describe, it, expect } from 'vitest';
import { SHIFT_OF, UNSHIFT, baseKeyOf, isShiftedChar, properShiftSide } from '../src/content/shift';
import { FINGER_OF, gateStatus, absorbSamples } from '../src/profile/mastery';
import { createProfile } from '../src/profile/store';
import { keysTaughtThrough, STAGES } from '../src/curriculum/stages';
import { TypingEngine } from '../src/game/engine';
import { StatsTracker } from '../src/stats/keystats';
import type { KeyRecord } from '../src/input/types';
import type { KeySample } from '../src/stats/keystats';

const NOW = new Date('2026-08-22T12:00:00.000Z');

describe('shift pairs (PRD 5, 11)', () => {
  it('round-trips every pair', () => {
    for (const [base, shifted] of Object.entries(SHIFT_OF)) {
      expect(UNSHIFT[shifted]).toBe(base);
      expect(baseKeyOf(shifted)).toBe(base);
      expect(isShiftedChar(shifted)).toBe(true);
      expect(isShiftedChar(base)).toBe(false);
    }
  });

  it('knows the opposite hand for every shifted character', () => {
    expect(properShiftSide('A', FINGER_OF)).toBe('right'); // a is left pinky
    expect(properShiftSide('J', FINGER_OF)).toBe('left');
    expect(properShiftSide('?', FINGER_OF)).toBe('left'); // / is right pinky
    expect(properShiftSide('!', FINGER_OF)).toBe('right'); // 1 is left pinky
    expect(properShiftSide('"', FINGER_OF)).toBe('left'); // apostrophe is right pinky
    expect(properShiftSide('a', FINGER_OF)).toBeNull(); // unshifted: no chord
  });

  it('gives every shifted character its base finger', () => {
    expect(FINGER_OF['A']).toBe(FINGER_OF['a']);
    expect(FINGER_OF['?']).toBe(FINGER_OF['/']);
    expect(FINGER_OF[':']).toBe(FINGER_OF[';']);
    expect(FINGER_OF['5']).toBe('left-index');
    expect(FINGER_OF['0']).toBe('right-pinky');
  });
});

describe('the typing engine already speaks Shift', () => {
  function press(k: string): KeyRecord {
    return {
      seq: 0, type: 'down', key: k, code: '', repeat: false,
      shift: k !== k.toLowerCase(), ctrl: false, alt: false, meta: false,
      capsLock: false, timeStamp: 0, frameTime: 0,
    };
  }

  it('accepts a capital and a shifted symbol as ordinary characters', () => {
    const stats = new StatsTracker();
    const events: string[] = [];
    const engine = new TypingEngine(stats, { onComplete: (t) => events.push(t) });
    engine.setToken('Go!');
    engine.handle(press('G'));
    engine.handle(press('o'));
    engine.handle(press('!'));
    expect(events).toEqual(['Go!']);
  });

  it('records a wrong-case press as an error on the letter, never on Shift (PRD 5)', () => {
    const stats = new StatsTracker();
    const engine = new TypingEngine(stats);
    engine.setToken('The');
    engine.handle(press('t')); // forgot shift
    engine.handle(press('T'));
    const row = stats.perKey().find((r) => r.key === 'T')!;
    expect(row.errors).toBe(1);
    expect(row.presses).toBe(2);
    // The confusion matrix's T -> t row IS the case_error flag.
    expect(stats.confusionMatrix()['T']['t']).toBe(1);
  });

  it('types a full sentence, spaces included', () => {
    const stats = new StatsTracker();
    const events: string[] = [];
    const engine = new TypingEngine(stats, { onComplete: (t) => events.push(t) });
    const sentence = 'Stay with me.';
    engine.setToken(sentence);
    for (const ch of sentence) engine.handle(press(ch));
    expect(events).toEqual([sentence]);
  });
});

describe('stage gates and chords', () => {
  function samples(key: string, n: number): KeySample[] {
    return Array.from({ length: n }, () => ({
      expected: key, pressed: key, correct: true, context: 'combat',
      interKeyMs: 150, firstKeyLatencyMs: null,
    }));
  }

  it('never lets an untyped capital hold Stage 6 shut', () => {
    const p = createProfile('T');
    // Master every base letter; touch no capitals at all.
    for (const k of 'abcdefghijklmnopqrstuvwxyz;') {
      absorbSamples(p, samples(k, 20), { now: new Date(NOW.getTime() - 86_400_000), sessionId: 's1' });
      absorbSamples(p, samples(k, 20), { now: NOW, sessionId: 's2' });
    }
    const gate = gateStatus(p, keysTaughtThrough(6), NOW);
    expect(gate.ready).toBe(true);
    expect(gate.waived).toContain('A');
    expect(gate.waived).toContain('Z');
  });

  it('still gates on real new keys: an untyped digit blocks Stage 8', () => {
    const p = createProfile('T');
    for (const k of 'abcdefghijklmnopqrstuvwxyz;') {
      absorbSamples(p, samples(k, 20), { now: NOW, sessionId: 's1' });
    }
    const gate = gateStatus(p, keysTaughtThrough(8), NOW);
    expect(gate.ready).toBe(false);
    expect(gate.blocking.some((b) => b.key === '4')).toBe(true);
    // But the shifted punctuation from Stage 7 does not block.
    expect(gate.blocking.some((b) => b.key === '?')).toBe(false);
  });

  it('teaches space in Stage 9 and every digit in Stage 8', () => {
    expect(keysTaughtThrough(9).has(' ')).toBe(true);
    for (const d of '0123456789') expect(keysTaughtThrough(8).has(d)).toBe(true);
    for (const c of 'AZJM') expect(keysTaughtThrough(6).has(c)).toBe(true);
  });

  it('has sentence pools that fit the built prompt scaling', () => {
    for (const stage of STAGES.filter((s) => s.number >= 9)) {
      for (const lesson of stage.lessons) {
        for (const token of lesson.pool) expect(token.length).toBeLessThanOrEqual(60);
      }
    }
  });
});
