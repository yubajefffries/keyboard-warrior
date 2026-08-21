import { describe, it, expect } from 'vitest';
import { exportProfiles, importProfiles, exportFilename } from '../src/profile/transfer';
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
      presses: 40, errors: 2, recentIntervals: [120, 130], baselineMs: 125,
      lastSeen: '2026-08-20T00:00:00.000Z', state: 'practiced', confusedWith: { d: 2 },
    };
    const result = importProfiles(exportProfiles([original]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profiles[0].name).toBe('Jeff');
    expect(result.profiles[0].stage).toBe(3);
    expect(result.profiles[0].keys.learn['f'].presses).toBe(40);
    expect(result.profiles[0].keys.learn['f'].confusedWith).toEqual({ d: 2 });
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
