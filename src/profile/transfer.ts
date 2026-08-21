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
  MASTERY_WINDOW,
  PROFILE_SCHEMA_VERSION,
  defaultSettings,
  emptyKeyAggregate,
  emptyKeyTable,
  type KeyState,
  type Profile,
  type ProfileSettings,
  type Route,
} from './types';

const KEY_STATES: KeyState[] = [
  'unseen', 'introduced', 'practiced', 'mastered', 'decayed', 'unverified',
];

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

export interface LoadResult {
  profiles: Profile[];
  /** Profiles that could not be read and were left behind. */
  dropped: number;
  /** Set when the stored blob was an older format. */
  migratedFrom: number | null;
}

/**
 * Read profiles out of browser storage.
 *
 * This is the same migration and validation path as `importProfiles`, and it
 * has to be: a save written by an older build is sitting in localStorage right
 * now, and code that reads it without upgrading it gets a profile missing
 * every field the current mastery engine expects.
 *
 * The one difference is what happens to a bad profile. An import is a file the
 * player just handed over, so all-or-nothing is right. Storage is the family's
 * only copy, so one unreadable profile must not take the others down with it:
 * it is dropped, counted, and the caller can say so.
 */
export function loadStoredProfiles(raw: unknown): LoadResult {
  if (!isPlainObject(raw) || !Array.isArray(raw.profiles)) {
    return { profiles: [], dropped: 0, migratedFrom: null };
  }
  const version =
    typeof raw.schemaVersion === 'number' && Number.isInteger(raw.schemaVersion) && raw.schemaVersion >= 1
      ? raw.schemaVersion
      : 1;
  // A blob from a NEWER build cannot be safely downgraded. Leave it alone
  // rather than half-reading it: the player still has their file export, and
  // silently discarding fields the new build wrote would be worse.
  if (version > PROFILE_SCHEMA_VERSION) {
    return { profiles: [], dropped: raw.profiles.length, migratedFrom: null };
  }

  const profiles: Profile[] = [];
  let dropped = 0;
  for (const candidate of raw.profiles) {
    const result = migrateProfile(candidate, version);
    if (result.ok) profiles.push(result.profile);
    else dropped += 1;
  }
  return { profiles, dropped, migratedFrom: version < PROFILE_SCHEMA_VERSION ? version : null };
}

type ProfileResult = { ok: true; profile: Profile } | { ok: false; error: string };

/** Runs a save through every migration between its format and this build's. */
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
const MIGRATIONS: Record<number, (p: unknown) => unknown> = {
  /**
   * v1 -> v2, the mastery gates.
   *
   * v1 stored lifetime accuracy and a per-context `state`. It has no rolling
   * outcome window, no per-day tally, and no per-session counts, so none of
   * that can be invented here: the new fields start empty and the window
   * readings fall back to lifetime until real samples refill them. What CAN be
   * carried across is the verdict the player already earned, so the old
   * per-context states are folded into one table and the best one wins. The
   * alternative was demoting every key in every existing save to unjudged.
   */
  1: (input) => {
    if (!isPlainObject(input)) return input;
    const out = { ...input } as Record<string, unknown>;
    const keyStates: Record<string, string> = {};
    const keys = isPlainObject(input.keys) ? input.keys : {};
    const rank: Record<string, number> = {
      unseen: 0, introduced: 1, decayed: 2, practiced: 3, unverified: 4, mastered: 5,
    };
    const migratedKeys: Record<string, Record<string, unknown>> = {};
    for (const context of ['learn', 'combat', 'speed_test']) {
      const bucket = (keys as Record<string, unknown>)[context];
      if (!isPlainObject(bucket)) continue;
      const outBucket: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(bucket)) {
        if (!isPlainObject(value)) continue;
        const state = typeof value.state === 'string' ? value.state : 'unseen';
        if ((rank[state] ?? 0) > (rank[keyStates[key]] ?? -1)) keyStates[key] = state;
        const { state: _dropped, ...rest } = value;
        outBucket[key] = {
          ...emptyKeyAggregate(),
          ...rest,
        };
      }
      migratedKeys[context] = outBucket;
    }
    out.keys = migratedKeys;
    out.keyStates = keyStates;
    return out;
  },
};

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
    keyStates: validateKeyStates(input.keyStates),
    sessions: input.sessions as Profile['sessions'],
    speedTests: input.speedTests as Profile['speedTests'],
    placement: isPlainObject(input.placement) ? (input.placement as unknown as Profile['placement']) : null,
  };
  return { ok: true, profile };
}

/**
 * An unknown state string is dropped rather than trusted. The next run of the
 * mastery engine recomputes it from the samples, which are the real record.
 */
function validateKeyStates(input: unknown): Record<string, KeyState> {
  if (!isPlainObject(input)) return {};
  const out: Record<string, KeyState> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && KEY_STATES.includes(value as KeyState)) {
      out[key] = value as KeyState;
    }
  }
  return out;
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
      // The window fields are repaired rather than rejected: they are derived
      // data that rebuilds itself from play, so a hand-trimmed export loses
      // some precision instead of the whole save.
      table[context][key] = {
        presses,
        errors,
        recentIntervals: Array.isArray(value.recentIntervals)
          ? value.recentIntervals.filter((n): n is number => typeof n === 'number' && n >= 0)
          : [],
        recentOutcomes:
          typeof value.recentOutcomes === 'string' && /^[01]*$/.test(value.recentOutcomes)
            ? value.recentOutcomes.slice(-MASTERY_WINDOW)
            : '',
        daily: Array.isArray(value.daily)
          ? (value.daily.filter(
              (row) =>
                Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'number' && row[1] >= 0,
            ) as [string, number][])
          : [],
        sessionPresses: Array.isArray(value.sessionPresses)
          ? value.sessionPresses.filter((n): n is number => typeof n === 'number' && n >= 0)
          : [],
        lastSessionId: typeof value.lastSessionId === 'string' ? value.lastSessionId : null,
        baselineMs: typeof value.baselineMs === 'number' ? value.baselineMs : null,
        lastSeen: typeof value.lastSeen === 'string' ? value.lastSeen : null,
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
