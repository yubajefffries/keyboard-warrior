import { describe, it, expect } from 'vitest';
import { exportProfiles, importProfiles, exportFilename, loadStoredProfiles } from '../src/profile/transfer';
import { windowAccuracy } from '../src/profile/mastery';
import { createProfile } from '../src/profile/store';
import { PROFILE_SCHEMA_VERSION } from '../src/profile/types';

function roundTrip(mutate: (payload: Record<string, unknown>) => void = () => {}) {
  const payload = JSON.parse(exportProfiles([createProfile('Jeff', 'beginner')]));
  mutate(payload);
  return importProfiles(JSON.stringify(payload));
}

describe('profile export/import (PRD 21)', () => {
  it('round-trips a profile unchanged', () => {
    const original = createProfile('Jeff', 'intermediate');
    original.stage = 3;
    original.keys.learn['f'] = {
      presses: 40, errors: 2, recentIntervals: [120, 130], recentOutcomes: '1101',
      daily: [['2026-08-20', 40]], sessionPresses: [40], lastSessionId: 's1',
      baselineMs: 125, lastSeen: '2026-08-20T00:00:00.000Z', confusedWith: { d: 2 },
    };
    original.keyStates['f'] = 'practiced';
    const result = importProfiles(exportProfiles([original]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profiles[0].name).toBe('Jeff');
    expect(result.profiles[0].stage).toBe(3);
    expect(result.profiles[0].keys.learn['f'].presses).toBe(40);
    expect(result.profiles[0].keys.learn['f'].confusedWith).toEqual({ d: 2 });
    expect(result.profiles[0].keys.learn['f'].recentOutcomes).toBe('1101');
    expect(result.profiles[0].keyStates['f']).toBe('practiced');
    expect(result.migratedFrom).toBeNull();
  });

  it('refuses a newer format with a clear message and no partial load', () => {
    const result = roundTrip((p) => {
      p.schemaVersion = PROFILE_SCHEMA_VERSION + 1;
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('newer version');
    expect(result.detail).toContain('Nothing was changed');
  });

  it('refuses a file from another app', () => {
    const result = roundTrip((p) => {
      p.app = 'some-other-typing-game';
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not a Keyboard Warrior export');
  });

  it('refuses invalid JSON without throwing', () => {
    const result = importProfiles('{ this is not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });

  it('refuses the WHOLE file when any one profile is malformed', () => {
    const good = createProfile('Good');
    const bad = JSON.parse(JSON.stringify(createProfile('Bad'))) as Record<string, unknown>;
    delete bad.name;
    const payload = JSON.parse(exportProfiles([good])) as Record<string, unknown>;
    (payload.profiles as unknown[]).push(bad);
    const result = importProfiles(JSON.stringify(payload));
    expect(result.ok).toBe(false); // a half-imported family save is worse than a refused one
    if (!result.ok) expect(result.error).toContain('Profile 2');
  });

  it('rejects impossible key stats rather than importing nonsense', () => {
    const result = roundTrip((p) => {
      (p.profiles as Record<string, unknown>[])[0].keys = {
        learn: { f: { presses: 2, errors: 9 } },
      };
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('more errors than presses');
  });

  it('repairs missing settings instead of rejecting a whole save over a preference', () => {
    const result = roundTrip((p) => {
      delete (p.profiles as Record<string, unknown>[])[0].settings;
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profiles[0].settings.keyboardViz).toBe('on'); // beginner default
  });

  it('clamps hand-edited settings into range', () => {
    const result = roundTrip((p) => {
      (p.profiles as Record<string, unknown>[])[0].settings = { lookahead: 99, audioMix: -3 };
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profiles[0].settings.lookahead).toBe(4);
      expect(result.profiles[0].settings.audioMix).toBe(0);
    }
  });

  it('names the export file after a single profile', () => {
    expect(exportFilename([createProfile('Jeff C')])).toMatch(/^keyboard-warrior-jeff-c-\d{4}-\d{2}-\d{2}\.json$/);
    expect(exportFilename([createProfile('A'), createProfile('B')])).toMatch(/^keyboard-warrior-\d{4}/);
  });
});

/**
 * A v1 save is not hypothetical: one exists on the machine this was built on.
 * These lock down what happens to it.
 */
describe('v1 -> v2 migration', () => {
  const V1_SAVE = JSON.stringify({
    app: 'keyboard-warrior',
    schemaVersion: 1,
    exportedAt: '2026-08-21T10:00:00.000Z',
    profiles: [
      {
        id: 'p_old',
        name: 'Beginner',
        createdAt: '2026-08-21T09:00:00.000Z',
        lastPlayedAt: '2026-08-21T09:30:00.000Z',
        route: 'beginner',
        stage: 1,
        lesson: 1,
        stagesCleared: [],
        settings: { keyboardViz: 'on', lookahead: 3, audioMix: 0.5 },
        keys: {
          learn: {},
          combat: {
            f: { presses: 36, errors: 0, recentIntervals: [140, 150], baselineMs: 145, lastSeen: '2026-08-21T09:30:00.000Z', state: 'mastered', confusedWith: {} },
            j: { presses: 32, errors: 4, recentIntervals: [160], baselineMs: 165, lastSeen: '2026-08-21T09:30:00.000Z', state: 'practiced', confusedWith: { k: 4 } },
          },
          speed_test: {
            f: { presses: 10, errors: 0, recentIntervals: [130], baselineMs: null, lastSeen: '2026-08-21T09:30:00.000Z', state: 'introduced', confusedWith: {} },
          },
        },
        sessions: [],
        speedTests: [],
        placement: null,
      },
    ],
  });

  it('accepts the old save and reports that it upgraded it', () => {
    const result = importProfiles(V1_SAVE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
  });

  it('keeps the mastery the player already earned rather than demoting it', () => {
    const result = importProfiles(V1_SAVE);
    if (!result.ok) throw new Error(result.error);
    // f was mastered in combat and merely introduced in speed_test: the best
    // verdict across contexts survives.
    expect(result.profiles[0].keyStates['f']).toBe('mastered');
    expect(result.profiles[0].keyStates['j']).toBe('practiced');
  });

  it('adds the new window fields empty rather than inventing history', () => {
    const result = importProfiles(V1_SAVE);
    if (!result.ok) throw new Error(result.error);
    const f = result.profiles[0].keys.combat['f'];
    expect(f.recentOutcomes).toBe('');
    expect(f.daily).toEqual([]);
    expect(f.sessionPresses).toEqual([]);
    expect(f.presses).toBe(36); // what it did record is kept
  });

  it('drops the old per-context state field', () => {
    const result = importProfiles(V1_SAVE);
    if (!result.ok) throw new Error(result.error);
    expect('state' in result.profiles[0].keys.combat['f']).toBe(false);
  });

  it('reads a migrated key by its lifetime accuracy until the window refills', () => {
    const result = importProfiles(V1_SAVE);
    if (!result.ok) throw new Error(result.error);
    expect(windowAccuracy(result.profiles[0].keys.combat['j'])).toBeCloseTo(28 / 32, 5);
  });
});

describe('key state validation', () => {
  it('drops a hand-edited state the engine does not recognise', () => {
    const payload = JSON.parse(exportProfiles([createProfile('Jeff')])) as Record<string, unknown>;
    (payload.profiles as Record<string, unknown>[])[0].keyStates = { f: 'legendary', j: 'mastered' };
    const result = importProfiles(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profiles[0].keyStates['f']).toBeUndefined();
    expect(result.profiles[0].keyStates['j']).toBe('mastered');
  });

  it('ignores an outcome window that is not outcomes', () => {
    const payload = JSON.parse(exportProfiles([createProfile('Jeff')])) as Record<string, unknown>;
    (payload.profiles as Record<string, unknown>[])[0].keys = {
      combat: { f: { presses: 5, errors: 0, recentOutcomes: 'not outcomes' } },
    };
    const result = importProfiles(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profiles[0].keys.combat['f'].recentOutcomes).toBe('');
  });

});

/**
 * Loading from browser storage, which is a different problem from importing a
 * file: the stored blob may have been written by an older build, and it is the
 * family's only copy.
 */
describe('loading from storage', () => {
  const v1Blob = {
    schemaVersion: 1,
    profiles: [
      {
        id: 'p1', name: 'Old', createdAt: '2026-08-01T00:00:00.000Z',
        lastPlayedAt: '2026-08-01T00:00:00.000Z', route: 'beginner', stage: 1, lesson: 0,
        stagesCleared: [], settings: {},
        keys: { combat: { f: { presses: 36, errors: 0, recentIntervals: [140], baselineMs: 140, lastSeen: '2026-08-01T00:00:00.000Z', state: 'mastered', confusedWith: {} } } },
        sessions: [], speedTests: [], placement: null,
      },
    ],
  };

  it('migrates an old stored save instead of handing back a broken profile', () => {
    const result = loadStoredProfiles(v1Blob);
    expect(result.migratedFrom).toBe(1);
    expect(result.profiles[0].keyStates['f']).toBe('mastered');
    // The fields the mastery engine reads must all exist, or it throws on the
    // first key it looks at.
    const f = result.profiles[0].keys.combat['f'];
    expect(Array.isArray(f.daily)).toBe(true);
    expect(Array.isArray(f.sessionPresses)).toBe(true);
    expect(typeof f.recentOutcomes).toBe('string');
  });

  it('does not report a migration when the save is already current', () => {
    const current = { schemaVersion: PROFILE_SCHEMA_VERSION, profiles: [createProfile('New')] };
    expect(loadStoredProfiles(current).migratedFrom).toBeNull();
  });

  it('drops one unreadable profile rather than losing the whole family', () => {
    const blob = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profiles: [createProfile('Good'), { id: 'x' }, createProfile('AlsoGood')],
    };
    const result = loadStoredProfiles(blob);
    expect(result.profiles).toHaveLength(2);
    expect(result.dropped).toBe(1);
  });

  it('refuses to downgrade a save from a newer build', () => {
    const blob = { schemaVersion: PROFILE_SCHEMA_VERSION + 1, profiles: [createProfile('Future')] };
    const result = loadStoredProfiles(blob);
    expect(result.profiles).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  it('survives junk without throwing', () => {
    for (const junk of [null, 42, 'nope', {}, { profiles: 'not a list' }]) {
      expect(() => loadStoredProfiles(junk)).not.toThrow();
      expect(loadStoredProfiles(junk).profiles).toEqual([]);
    }
  });
});
