/**
 * Export / import. PRD Section 21 (hard requirement for Phase 1a).
 *
 * The contract is unusually strict for a household game, and deliberately so:
 * browser storage is volatile, so the export file is the only durable copy of
 * a family's progress. Rules, straight from the PRD:
 *
 * - the export carries a schemaVersion
 * - import migrates older versions forward
 * - import refuses a newer version with a clear message, never a partial load
 * - import validates structure BEFORE touching existing state
 * - malformed or hand-edited files fail safe with no state change
 *
 * So validation returns a value; it never throws into the caller's state, and
 * the caller only commits after `ok`.
 */

import {
  PROFILE_SCHEMA_VERSION,
  defaultSettings,
  emptyKeyTable,
  type Profile,
  type ProfileSettings,
  type Route,
} from './types';

const APP_TAG = 'keyboard-warrior';

export interface ExportPayload {
  app: typeof APP_TAG;
  schemaVersion: number;
  exportedAt: string;
  profiles: Profile[];
}

export type ImportResult =
  | { ok: true; profiles: Profile[]; migratedFrom: number | null }
  | { ok: false; error: string; detail?: string };

export function exportProfiles(profiles: Profile[]): string {
  const payload: ExportPayload = {
    app: APP_TAG,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profiles,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportFilename(profiles: Profile[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const who = profiles.length === 1 ? `-${slug(profiles[0].name)}` : '';
  return `keyboard-warrior${who}-${stamp}.json`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
}

const ROUTES: Route[] = ['beginner', 'intermediate', 'advanced'];

export function importProfiles(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.', detail: 'Nothing was changed.' };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'That file is not a Keyboard Warrior export.', detail: 'Nothing was changed.' };
  }
  const payload = raw as Partial<ExportPayload>;

  if (payload.app !== APP_TAG) {
    return {
      ok: false,
      error: 'That file is not a Keyboard Warrior export.',
      detail: 'Nothing was changed. Look for a file exported from the Progress screen.',
    };
  }

  const version = payload.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'That export has no usable schema version.', detail: 'Nothing was changed.' };
  }
  if (version > PROFILE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `That save is from a newer version of the game (format ${version}, this build reads ${PROFILE_SCHEMA_VERSION}).`,
      detail: 'Update the game, then import again. Nothing was changed.',
    };
  }

  if (!Array.isArray(payload.profiles)) {
    return { ok: false, error: 'That export contains no profiles.', detail: 'Nothing was changed.' };
  }
  if (payload.profiles.length === 0) {
    return { ok: false, error: 'That export contains no profiles.', detail: 'Nothing was changed.' };
  }

  // Validate every profile before accepting any of them: a half-imported
  // family save is worse than a refused one.
  const migrated: Profile[] = [];
  for (let i = 0; i < payload.profiles.length; i++) {
    const result = migrateProfile(payload.profiles[i], version);
    if (!result.ok) {
      return {
        ok: false,
        error: `Profile ${i + 1} in that file is malformed.`,
        detail: `${result.error} Nothing was changed.`,
      };
    }
    migrated.push(result.profile);
  }

  return { ok: true, profiles: migrated, migratedFrom: version < PROFILE_SCHEMA_VERSION ? version : null };
}

type ProfileResult = { ok: true; profile: Profile } | { ok: false; error: string };

/**
 * Migration seam. There is only one format so far; the table exists so adding
 * v2 is a mechanical edit rather than a rewrite of the import path.
 */
function migrateProfile(input: unknown, fromVersion: number): ProfileResult {
  let candidate = input;
  for (let v = fromVersion; v < PROFILE_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, error: `No migration exists from format ${v}.` };
    candidate = step(candidate);
  }
  return validateProfile(candidate);
}

/** version N -> N+1. Keyed by the version being migrated FROM. */
const MIGRATIONS: Record<number, (p: unknown) => unknown> = {};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateProfile(input: unknown): ProfileResult {
  if (!isPlainObject(input)) return { ok: false, error: 'It is not an object.' };

  const id = input.id;
  const name = input.name;
  if (typeof id !== 'string' || id === '') return { ok: false, error: 'It has no id.' };
  if (typeof name !== 'string' || name.trim() === '') return { ok: false, error: 'It has no name.' };

  const route = ROUTES.includes(input.route as Route) ? (input.route as Route) : null;
  if (route === null) return { ok: false, error: `Unknown route ${JSON.stringify(input.route)}.` };

  const stage = input.stage;
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1 || stage > 10) {
    return { ok: false, error: `Stage ${JSON.stringify(stage)} is not a real stage.` };
  }

  const keys = validateKeys(input.keys);
  if (!keys.ok) return { ok: false, error: keys.error };

  if (!Array.isArray(input.sessions)) return { ok: false, error: 'Its session history is not a list.' };
  if (!Array.isArray(input.speedTests)) return { ok: false, error: 'Its speed test history is not a list.' };

  // Fields below are repaired rather than rejected: they are preferences and
  // derived data, and refusing a family's whole save over a missing setting
  // would be the wrong trade.
  const now = new Date().toISOString();
  const profile: Profile = {
    id,
    name: name.trim(),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    lastPlayedAt: typeof input.lastPlayedAt === 'string' ? input.lastPlayedAt : now,
    route,
    stage,
    lesson: typeof input.lesson === 'number' && input.lesson >= 0 ? Math.floor(input.lesson) : 0,
    stagesCleared: Array.isArray(input.stagesCleared)
      ? input.stagesCleared.filter((n): n is number => typeof n === 'number')
      : [],
    settings: mergeSettings(input.settings, route),
    keys: keys.value,
    sessions: input.sessions as Profile['sessions'],
    speedTests: input.speedTests as Profile['speedTests'],
    placement: isPlainObject(input.placement) ? (input.placement as unknown as Profile['placement']) : null,
  };
  return { ok: true, profile };
}

function mergeSettings(input: unknown, route: Route): ProfileSettings {
  const base = defaultSettings(route);
  if (!isPlainObject(input)) return base;
  const merged = { ...base };
  for (const key of Object.keys(base) as (keyof ProfileSettings)[]) {
    const v = input[key];
    if (typeof v === typeof base[key]) (merged as Record<string, unknown>)[key] = v;
  }
  merged.lookahead = Math.min(4, Math.max(0, Math.floor(merged.lookahead)));
  merged.audioMix = Math.min(1, Math.max(0, merged.audioMix));
  return merged;
}

type KeysResult = { ok: true; value: Profile['keys'] } | { ok: false; error: string };

function validateKeys(input: unknown): KeysResult {
  const table = emptyKeyTable();
  if (input === undefined || input === null) return { ok: true, value: table };
  if (!isPlainObject(input)) return { ok: false, error: 'Its key stats are not an object.' };

  for (const context of ['learn', 'combat', 'speed_test'] as const) {
    const bucket = input[context];
    if (bucket === undefined) continue;
    if (!isPlainObject(bucket)) return { ok: false, error: `Its ${context} key stats are not an object.` };
    for (const [key, value] of Object.entries(bucket)) {
      if (!isPlainObject(value)) return { ok: false, error: `Key stats for ${JSON.stringify(key)} are not an object.` };
      const presses = value.presses;
      const errors = value.errors;
      if (typeof presses !== 'number' || presses < 0) {
        return { ok: false, error: `Key ${JSON.stringify(key)} has an impossible press count.` };
      }
      if (typeof errors !== 'number' || errors < 0 || errors > presses) {
        return { ok: false, error: `Key ${JSON.stringify(key)} has more errors than presses.` };
      }
      table[context][key] = {
        presses,
        errors,
        recentIntervals: Array.isArray(value.recentIntervals)
          ? value.recentIntervals.filter((n): n is number => typeof n === 'number' && n >= 0)
          : [],
        baselineMs: typeof value.baselineMs === 'number' ? value.baselineMs : null,
        lastSeen: typeof value.lastSeen === 'string' ? value.lastSeen : null,
        state: typeof value.state === 'string' ? (value.state as Profile['keys']['learn'][string]['state']) : 'unseen',
        confusedWith: isPlainObject(value.confusedWith)
          ? (Object.fromEntries(
              Object.entries(value.confusedWith).filter(([, n]) => typeof n === 'number'),
            ) as Record<string, number>)
          : {},
      };
    }
  }
  return { ok: true, value: table };
}
