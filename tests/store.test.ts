import { describe, it, expect } from 'vitest';
import { createProfile, recordActivity, recordSpeedTest, trim } from '../src/profile/store';
import { MAX_SESSION_HISTORY, SESSION_IDLE_MINUTES, type SpeedTestResult } from '../src/profile/types';

const minutes = (n: number) => n * 60_000;

function speedTest(at: string): SpeedTestResult {
  return {
    at, durationS: 30, wpm: 50, rawWpm: 52, accuracy: 0.96,
    correctChars: 125, incorrectChars: 5, consistency: 8, peakWpm: 60,
  };
}

describe('sessions (PRD 21: continuous play separated by 30+ minutes of idle)', () => {
  it('merges back-to-back lessons into one session', () => {
    const p = createProfile('T');
    const start = new Date('2026-08-21T10:00:00Z');
    recordActivity(p, { correctChars: 100, activeMs: minutes(2), accuracy: 1 }, start);
    recordActivity(
      p,
      { correctChars: 100, activeMs: minutes(2), accuracy: 0.9 },
      new Date(start.getTime() + minutes(5)),
    );
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0].correctChars).toBe(200);
    expect(p.sessions[0].accuracy).toBeCloseTo(0.95, 5);
  });

  it('starts a new session after the idle gap', () => {
    const p = createProfile('T');
    const start = new Date('2026-08-21T10:00:00Z');
    recordActivity(p, { correctChars: 100, activeMs: minutes(2), accuracy: 1 }, start);
    recordActivity(
      p,
      { correctChars: 100, activeMs: minutes(2), accuracy: 1 },
      new Date(start.getTime() + minutes(SESSION_IDLE_MINUTES + 1)),
    );
    expect(p.sessions).toHaveLength(2);
  });

  it('weights merged accuracy by characters, not by how many activities there were', () => {
    const p = createProfile('T');
    const start = new Date('2026-08-21T10:00:00Z');
    recordActivity(p, { correctChars: 1000, activeMs: minutes(10), accuracy: 1 }, start);
    // A 10-character warm-up at 0% must not drag the session to 50%.
    recordActivity(
      p,
      { correctChars: 10, activeMs: minutes(1), accuracy: 0 },
      new Date(start.getTime() + minutes(1)),
    );
    expect(p.sessions[0].accuracy).toBeCloseTo(1000 / 1010, 5);
  });

  it('computes session WPM over the merged active time', () => {
    const p = createProfile('T');
    const start = new Date('2026-08-21T10:00:00Z');
    recordActivity(p, { correctChars: 250, activeMs: minutes(1), accuracy: 1 }, start);
    expect(p.sessions[0].wpm).toBe(50);
  });
});

describe('history caps (PRD 21: cannot grow without bound)', () => {
  it('trims session history to the cap, keeping the newest', () => {
    const p = createProfile('T');
    for (let i = 0; i < MAX_SESSION_HISTORY + 50; i++) {
      p.sessions.push({
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:00.000Z',
        correctChars: i, activeMs: 1000, accuracy: 1, wpm: 10,
      });
    }
    trim(p);
    expect(p.sessions).toHaveLength(MAX_SESSION_HISTORY);
    expect(p.sessions[p.sessions.length - 1].correctChars).toBe(MAX_SESSION_HISTORY + 49);
  });

  it('records speed tests and moves the last-played stamp', () => {
    const p = createProfile('T');
    recordSpeedTest(p, speedTest('2026-08-21T12:00:00.000Z'));
    expect(p.speedTests).toHaveLength(1);
    expect(p.lastPlayedAt).toBe('2026-08-21T12:00:00.000Z');
  });
});

describe('profile creation', () => {
  it('starts each route at the stage its placement implies', () => {
    expect(createProfile('a', 'beginner').stage).toBe(1);
    expect(createProfile('a', 'intermediate').stage).toBe(3);
    expect(createProfile('a', 'advanced').stage).toBe(5);
  });

  it('gives every profile a distinct id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createProfile('x').id));
    expect(ids.size).toBe(200);
  });
});
