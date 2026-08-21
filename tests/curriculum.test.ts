import { describe, it, expect } from 'vitest';
import { STAGES, LessonSource, judgeLesson, keysTaughtThrough, validateStages } from '../src/curriculum/stages';
import { LESSON_MIN_ACCURACY } from '../src/profile/types';

describe('curriculum content (PRD 11)', () => {
  it('never asks for a key the lesson has not taught', () => {
    expect(validateStages()).toEqual([]);
  });

  it('introduces F and J before anything else', () => {
    expect(STAGES[0].lessons[0].introduces).toEqual(['f', 'j']);
    expect(STAGES[0].lessons[0].keys).toEqual(['f', 'j']);
  });

  it('teaches the whole home row by the end of Stage 1', () => {
    const taught = keysTaughtThrough(1);
    for (const k of ['a', 's', 'd', 'f', 'j', 'k', 'l', ';']) expect(taught.has(k)).toBe(true);
    expect(taught.has('g')).toBe(false); // G is an index stretch, taught with the upper row
  });

  it('introduces every key exactly once', () => {
    const seen = new Set<string>();
    for (const stage of STAGES) {
      for (const lesson of stage.lessons) {
        for (const k of lesson.introduces) {
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it('serves tokens without repeating the last three', () => {
    const source = new LessonSource(STAGES[1].lessons[2], 42);
    const window: string[] = [];
    for (let i = 0; i < 200; i++) {
      const token = source.next();
      expect(window).not.toContain(token);
      window.push(token);
      if (window.length > 3) window.shift();
    }
  });
});

describe('lesson pass criteria (PRD 12)', () => {
  it('passes on accuracy and the stage WPM floor', () => {
    expect(judgeLesson(1, 0.95, 14, 24, null).passed).toBe(true);
  });

  it('fails below the accuracy floor and names the slipperiest key', () => {
    const out = judgeLesson(1, 0.82, 20, 24, { key: 'k', accuracy: 0.6 });
    expect(out.passed).toBe(false);
    expect(out.diagnosis).toContain('K');
    expect(out.diagnosis).toContain('60%');
  });

  it('fails below the speed floor but says accuracy is fine', () => {
    const out = judgeLesson(1, 0.99, 6, 24, null);
    expect(out.passed).toBe(false);
    expect(out.diagnosis).toContain('just reps');
  });

  it('gives exactly one diagnosis line, never a lecture', () => {
    const out = judgeLesson(2, 0.5, 4, 10, { key: 'a', accuracy: 0.3 });
    expect(out.diagnosis.split('\n')).toHaveLength(1);
  });

  it('uses the accuracy floor from the constants, not a literal', () => {
    expect(judgeLesson(1, LESSON_MIN_ACCURACY, 99, 30, null).passed).toBe(true);
    expect(judgeLesson(1, LESSON_MIN_ACCURACY - 0.01, 99, 30, null).passed).toBe(false);
  });
});
