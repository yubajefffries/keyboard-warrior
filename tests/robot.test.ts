import { describe, it, expect } from 'vitest';
import { msPerChar, keyToCode, neighbourOf, judgeBurst, type RobotReport } from '../src/dev/robot';

function report(over: Partial<RobotReport> = {}): RobotReport {
  return {
    wpm: 100,
    intervalMs: 120,
    jitterPct: 0,
    errorRate: 0,
    sent: 300,
    injectedErrors: 0,
    starvedSlots: 0,
    lateSlots: 0,
    durationMs: 36_000,
    achievedWpm: 99.8,
    drift: { mean: 1, p50: 1, p95: 2, p99: 3, max: 5 },
    handler: { mean: 0.2, p50: 0.2, p95: 0.5, p99: 0.9, max: 2 },
    frames: { count: 2160, meanFps: 60, worstMs: 20, over16: 4, over33: 0 },
    ...over,
  };
}

describe('robot timing', () => {
  it('converts wpm to the standard 5-chars-per-word interval', () => {
    expect(msPerChar(100)).toBeCloseTo(120, 6); // 8.33 chars/s
    expect(msPerChar(60)).toBeCloseTo(200, 6);
    expect(msPerChar(200)).toBeCloseTo(60, 6);
  });

  it('maps US QWERTY keys to real event codes', () => {
    expect(keyToCode('a')).toBe('KeyA');
    expect(keyToCode('F')).toBe('KeyF');
    expect(keyToCode(';')).toBe('Semicolon');
    expect(keyToCode(' ')).toBe('Space');
    expect(keyToCode('4')).toBe('Digit4');
  });

  it('injects errors as physically adjacent keys', () => {
    expect(neighbourOf('a')).toBe('s');
    expect(neighbourOf('j')).toBe('k');
    expect(neighbourOf('?')).toBe('f'); // fallback is still a real key
  });
});

describe('burst verdict', () => {
  it('passes a clean run', () => {
    const v = judgeBurst(report(), { expected: 'asdf', observed: 'asdf' });
    expect(v.pass).toBe(true);
  });

  it('fails and points at the first divergence when a key is dropped', () => {
    const v = judgeBurst(report(), { expected: 'asdfjkl', observed: 'asdjkl' });
    expect(v.pass).toBe(false);
    const line = v.lines.find((l) => l.label === 'Lossless + in order')!;
    expect(line.pass).toBe(false);
    expect(line.value).toContain('char 3');
  });

  it('fails on a visible frame hitch even when every key arrived', () => {
    const v = judgeBurst(report({ frames: { count: 100, meanFps: 52, worstMs: 61, over16: 9, over33: 2 } }), {
      expected: 'as',
      observed: 'as',
    });
    expect(v.pass).toBe(false);
    expect(v.lines.find((l) => l.label === 'No visible hitch')!.pass).toBe(false);
  });

  it('fails when per-key app cost blows the 4 ms budget', () => {
    const v = judgeBurst(
      report({ handler: { mean: 3, p50: 3, p95: 5, p99: 7, max: 12 } }),
      { expected: 'as', observed: 'as' },
    );
    expect(v.pass).toBe(false);
    expect(v.lines.find((l) => l.label === 'Per-key app cost')!.pass).toBe(false);
  });

  it('fails when the run could not hold the requested rate, and says why', () => {
    const v = judgeBurst(report({ achievedWpm: 74, lateSlots: 63 }), {
      expected: 'as',
      observed: 'as',
    });
    expect(v.pass).toBe(false);
    const line = v.lines.find((l) => l.label === 'Rate actually achieved')!;
    expect(line.pass).toBe(false);
    expect(line.detail).toContain('could not sustain');
  });
});
