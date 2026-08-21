import { describe, it, expect } from 'vitest';
import { TypingEngine } from '../src/game/engine';
import { StatsTracker } from '../src/stats/keystats';
import type { KeyRecord } from '../src/input/types';

function key(k: string, extra: Partial<KeyRecord> = {}): KeyRecord {
  return {
    seq: 0,
    type: 'down',
    key: k,
    code: '',
    repeat: false,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    capsLock: false,
    timeStamp: 0,
    frameTime: 0,
    ...extra,
  };
}

function makeEngine() {
  const stats = new StatsTracker();
  const events: string[] = [];
  const engine = new TypingEngine(stats, {
    onHit: (c) => events.push(`hit:${c}`),
    onMiss: (e, p) => events.push(`miss:${e}<-${p}`),
    onComplete: (t) => events.push(`complete:${t}`),
  });
  return { stats, events, engine };
}

describe('TypingEngine (miss-and-retry, PRD 5)', () => {
  it('advances on correct keys and fires on completion', () => {
    const { engine, events } = makeEngine();
    engine.setToken('fj');
    engine.handle(key('f'));
    engine.handle(key('j'));
    expect(events).toEqual(['hit:f', 'complete:fj']);
  });

  it('does not advance on a miss; retry succeeds; error logged once against expected key', () => {
    const { engine, events, stats } = makeEngine();
    engine.setToken('as');
    engine.handle(key('s')); // wrong
    engine.handle(key('a')); // retry correct
    engine.handle(key('s'));
    expect(events).toEqual(['miss:a<-s', 'hit:a', 'complete:as']);
    const a = stats.perKey().find((r) => r.key === 'a')!;
    expect(a.errors).toBe(1);
    expect(a.presses).toBe(2); // one miss + one corrected press, both attributed to 'a'
    expect(stats.confusionMatrix()['a']['s']).toBe(1);
  });

  it('ignores backspace, modifiers chords, and held-key repeats', () => {
    const { engine, events } = makeEngine();
    engine.setToken('ff');
    engine.handle(key('Backspace'));
    engine.handle(key('f', { ctrl: true }));
    engine.handle(key('f', { repeat: true }));
    expect(events).toEqual([]);
    engine.handle(key('f'));
    engine.handle(key('f'));
    expect(events).toEqual(['hit:f', 'complete:ff']);
  });

  it('ignores keyup and does nothing when disabled', () => {
    const { engine, events } = makeEngine();
    engine.setToken('f');
    engine.handle(key('f', { type: 'up' }));
    expect(events).toEqual([]);
    engine.setEnabled(false);
    engine.handle(key('f'));
    expect(events).toEqual([]);
  });

  it('splits first-key latency from inter-key interval', () => {
    const stats = new StatsTracker();
    const engine = new TypingEngine(stats);
    engine.setToken('fj');
    engine.markTokenShown(1000);
    engine.handle(key('f', { timeStamp: 1400 }));
    engine.handle(key('j', { timeStamp: 1600 }));
    const f = stats.perKey().find((r) => r.key === 'f')!;
    const j = stats.perKey().find((r) => r.key === 'j')!;
    expect(f.meanFirstKeyLatencyMs).toBe(400);
    expect(f.meanInterKeyMs).toBeNull(); // first press of session has no interval
    expect(j.meanFirstKeyLatencyMs).toBeNull();
    expect(j.meanInterKeyMs).toBe(200);
  });
});
