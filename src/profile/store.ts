/**
 * Profile store. PRD Section 21.
 *
 * Browser storage is treated as volatile on purpose: every write is
 * best-effort and a failed write must never take the run down with it. The
 * export file, not localStorage, is the thing the PRD calls durable.
 *
 * All profiles live under one key. A family has at most MAX_PROFILES of them,
 * per-key history is capped by construction, and one blob means a save is
 * atomic instead of half-written across several keys.
 */

import {
  MAX_PROFILES,
  MAX_SESSION_HISTORY,
  MAX_SPEED_TEST_HISTORY,
  PROFILE_SCHEMA_VERSION,
  SESSION_IDLE_MINUTES,
  defaultSettings,
  emptyKeyTable,
  type Profile,
  type Route,
  type SessionSummary,
  type SpeedTestResult,
} from './types';
import { loadStoredProfiles } from './transfer';

const STORAGE_KEY = 'kw.profiles';
const ACTIVE_KEY = 'kw.activeProfile';

export interface StoredState {
  schemaVersion: number;
  profiles: Profile[];
}

/** Storage can throw (private mode, blocked cookies), not just return null. */
function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(value: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    return false; // quota or blocked storage: the caller keeps playing
  }
}

export function newProfileId(): string {
  // crypto.randomUUID is not in every browser the PRD targets; this is only an
  // identity, never a secret.
  const rand = Math.random().toString(36).slice(2, 10);
  return `p_${Date.now().toString(36)}_${rand}`;
}

export function createProfile(name: string, route: Route = 'beginner'): Profile {
  const now = new Date().toISOString();
  return {
    id: newProfileId(),
    name: name.trim() || 'Player',
    createdAt: now,
    lastPlayedAt: now,
    route,
    stage: route === 'beginner' ? 1 : route === 'intermediate' ? 3 : 5,
    lesson: 0,
    stagesCleared: [],
    settings: defaultSettings(route),
    keys: emptyKeyTable(),
    keyStates: {},
    sessions: [],
    speedTests: [],
    placement: null,
  };
}

export class ProfileStore {
  private profiles: Profile[] = [];
  private activeId: string | null = null;
  /** False when storage is unavailable, so the UI can warn about export. */
  readonly persistent: boolean;
  /** Profiles in storage that could not be read. Surfaced, never swallowed. */
  readonly dropped: number = 0;
  /** Set when the stored save was written by an older build. */
  readonly migratedFrom: number | null = null;

  constructor() {
    const raw = readRaw();
    this.persistent = raw !== null || writeRaw(JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION, profiles: [] }));
    if (raw) {
      try {
        // Through the same migration and validation path as a file import.
        // A save written by an older build is not a hypothetical: one is
        // sitting in localStorage the moment this ships.
        const result = loadStoredProfiles(JSON.parse(raw));
        this.profiles = result.profiles;
        this.dropped = result.dropped;
        this.migratedFrom = result.migratedFrom;
        // Write the upgraded shape straight back, so the migration runs once
        // rather than on every load for the rest of the profile's life.
        if (result.migratedFrom !== null) this.save();
      } catch {
        // Corrupt blob: start clean rather than half-load. The player's real
        // backup is the export file.
        this.profiles = [];
      }
    }
    try {
      this.activeId = localStorage.getItem(ACTIVE_KEY);
    } catch {
      this.activeId = null;
    }
    if (this.activeId && !this.profiles.some((p) => p.id === this.activeId)) this.activeId = null;
  }

  list(): Profile[] {
    return [...this.profiles].sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
  }

  get count(): number {
    return this.profiles.length;
  }

  get atCapacity(): boolean {
    return this.profiles.length >= MAX_PROFILES;
  }

  get(id: string): Profile | null {
    return this.profiles.find((p) => p.id === id) ?? null;
  }

  active(): Profile | null {
    return this.activeId ? this.get(this.activeId) : null;
  }

  setActive(id: string | null): void {
    this.activeId = id;
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* volatile by design */
    }
  }

  add(profile: Profile): { ok: true } | { ok: false; error: string } {
    if (this.atCapacity) {
      return { ok: false, error: `This browser already holds ${MAX_PROFILES} profiles. Delete one first.` };
    }
    this.profiles.push(profile);
    this.save();
    return { ok: true };
  }

  /** Replaces the stored copy of a profile the caller has been mutating. */
  update(profile: Profile): void {
    const i = this.profiles.findIndex((p) => p.id === profile.id);
    if (i === -1) return;
    this.profiles[i] = trim(profile);
    this.save();
  }

  rename(id: string, name: string): void {
    const p = this.get(id);
    if (!p) return;
    p.name = name.trim() || p.name;
    this.save();
  }

  remove(id: string): void {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeId === id) this.setActive(null);
    this.save();
  }

  duplicate(id: string): Profile | null {
    const source = this.get(id);
    if (!source || this.atCapacity) return null;
    const copy: Profile = JSON.parse(JSON.stringify(source));
    copy.id = newProfileId();
    copy.name = `${source.name} (copy)`;
    copy.createdAt = new Date().toISOString();
    this.profiles.push(copy);
    this.save();
    return copy;
  }

  /** Replace everything, after an import has already validated the payload. */
  replaceAll(profiles: Profile[]): void {
    this.profiles = profiles.slice(0, MAX_PROFILES).map(trim);
    if (this.activeId && !this.profiles.some((p) => p.id === this.activeId)) this.setActive(null);
    this.save();
  }

  save(): boolean {
    const state: StoredState = { schemaVersion: PROFILE_SCHEMA_VERSION, profiles: this.profiles };
    return writeRaw(JSON.stringify(state));
  }
}

/** Enforce the history caps from PRD 21 before anything is written. */
export function trim(profile: Profile): Profile {
  if (profile.sessions.length > MAX_SESSION_HISTORY) {
    profile.sessions = profile.sessions.slice(-MAX_SESSION_HISTORY);
  }
  if (profile.speedTests.length > MAX_SPEED_TEST_HISTORY) {
    profile.speedTests = profile.speedTests.slice(-MAX_SPEED_TEST_HISTORY);
  }
  return profile;
}

export function recordSession(profile: Profile, session: SessionSummary): void {
  profile.sessions.push(session);
  profile.lastPlayedAt = session.endedAt;
  trim(profile);
}

/**
 * PRD 21: a session is continuous play separated from other play by 30+
 * minutes of idle. So a lesson finished five minutes after the last one
 * extends that session rather than starting a new one — otherwise "sessions"
 * would just count lessons, and every per-session metric would be wrong.
 */
export function recordActivity(
  profile: Profile,
  activity: { correctChars: number; activeMs: number; accuracy: number },
  now = new Date(),
): SessionSummary {
  const iso = now.toISOString();
  const last = profile.sessions[profile.sessions.length - 1];
  const idleMs = last ? now.getTime() - Date.parse(last.endedAt) : Infinity;

  if (last && idleMs < SESSION_IDLE_MINUTES * 60_000) {
    const correctChars = last.correctChars + activity.correctChars;
    const activeMs = last.activeMs + activity.activeMs;
    // Weight the merged accuracy by characters, not by activity count: a
    // 40-character warm-up should not weigh as much as a full lesson.
    const weight = last.correctChars + activity.correctChars;
    last.accuracy =
      weight > 0
        ? (last.accuracy * last.correctChars + activity.accuracy * activity.correctChars) / weight
        : activity.accuracy;
    last.correctChars = correctChars;
    last.activeMs = activeMs;
    last.endedAt = iso;
    last.wpm = activeMs > 0 ? correctChars / 5 / (activeMs / 60_000) : 0;
    profile.lastPlayedAt = iso;
    return last;
  }

  const session: SessionSummary = {
    startedAt: new Date(now.getTime() - activity.activeMs).toISOString(),
    endedAt: iso,
    correctChars: activity.correctChars,
    activeMs: activity.activeMs,
    accuracy: activity.accuracy,
    wpm: activity.activeMs > 0 ? activity.correctChars / 5 / (activity.activeMs / 60_000) : 0,
  };
  recordSession(profile, session);
  return session;
}

export function recordSpeedTest(profile: Profile, result: SpeedTestResult): void {
  profile.speedTests.push(result);
  profile.lastPlayedAt = result.at;
  trim(profile);
}
