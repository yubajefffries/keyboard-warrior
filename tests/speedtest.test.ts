import { describe, it, expect } from 'vitest';
import {
  PEAK_WINDOW_MS,
  SpeedTestScorer,
  WordSource,
  peakWpm,
  stdev,
  wordsFor,
} from '../src/modes/speedtest';
import { keysTaughtThrough } from '../src/curriculum/stages';

describe('speed test scoring (PRD 18)', () => {
  it('uses the standard WPM definition and separates raw from net', () => {
    const s = new SpeedTestScorer();
    for (let i = 0; i < 250; i++) s.record('f', true, 100);
    for (let i = 0; i < 50; i++) s.record('f', false, 100);
    const r = s.result(60, 60_000);
    expect(r.wpm).toBe(50); // 250 correct / 5 / 1 min
    expect(r.rawWpm).toBe(60); // 300 typed / 5 / 1 min
    expect(r.accuracy).toBeCloseTo(250 / 300, 5);
  });

  it('does not call one lucky short word a peak', () => {
    const s = new SpeedTestScorer();
    let t = 0;
    // Twenty steady words at ~30 WPM, then one word finished in 20 ms.
    for (let i = 0; i < 20; i++) {
      t += 2000;
      s.completeToken('word', t);
    }
    t += 20;
    s.completeToken('the', t);
    const peak = s.result(60, 60_000).peakWpm;
    // Taken alone that last word reads as 2400 WPM. Five seconds of clock
    // cannot be faked by one keystroke burst.
    expect(peak).toBeLessThan(60);
  });

  it('falls back to net WPM when the run is shorter than one window', () => {
    expect(peakWpm([{ at: 0, chars: 5 }], PEAK_WINDOW_MS, 42)).toBe(42);
    expect(peakWpm([], PEAK_WINDOW_MS, 42)).toBe(42);
  });

  it('finds the busiest five seconds of the run', () => {
    const marks: { at: number; chars: number }[] = [];
    for (let i = 1; i <= 20; i++) marks.push({ at: i * 1000, chars: 5 });   // 60 WPM
    for (let i = 21; i <= 30; i++) marks.push({ at: i * 1000, chars: 10 }); // 120 WPM
    expect(peakWpm(marks, 5_000, 0)).toBeCloseTo(120, 0);
  });

  it('reports consistency as spread, zero for a metronome', () => {
    expect(stdev([40, 40, 40])).toBe(0);
    expect(stdev([20, 60])).toBeGreaterThan(0);
  });

  it('names the slowest and least accurate keys', () => {
    const s = new SpeedTestScorer();
    for (let i = 0; i < 5; i++) s.record('f', true, 100);
    for (let i = 0; i < 5; i++) s.record('q', true, 900);
    for (let i = 0; i < 5; i++) s.record('z', i < 1, 200);
    const weak = s.weakest();
    expect(weak.slowest[0]).toBe('q');
    expect(weak.leastAccurate[0]).toBe('z');
  });
});

describe('content filtering (PRD 11)', () => {
  it('gives a Stage 1 profile only home-row words', () => {
    const words = wordsFor(keysTaughtThrough(1));
    for (const w of words) {
      for (const ch of w) expect('asdfghjkl;'.includes(ch)).toBe(true);
    }
  });

  it('gives a Stage 5 profile real common words, even though Stage 5 has no lessons yet', () => {
    const words = wordsFor(keysTaughtThrough(5));
    expect(words).toContain('the');
    expect(words).toContain('because');
    expect(words.length).toBeGreaterThan(50);
  });

  it('never serves a word containing an untaught key', () => {
    for (const stage of [1, 2, 3, 4, 5]) {
      const taught = keysTaughtThrough(stage);
      for (const w of wordsFor(taught)) {
        for (const ch of w) expect(taught.has(ch)).toBe(true);
      }
    }
  });

  it('does not repeat within the last three words', () => {
    const source = new WordSource(wordsFor(keysTaughtThrough(5)), 7);
    const window: string[] = [];
    for (let i = 0; i < 300; i++) {
      const token = source.next();
      expect(window).not.toContain(token);
      window.push(token);
      if (window.length > 3) window.shift();
    }
  });
});
