/**
 * Typing engine: miss-and-retry combat typing. PRD Sections 4-6.
 *
 * Pure logic, no DOM and no renderer. Consumes KeyRecords from the input
 * pipeline, tracks progress through the active token, and emits gameplay
 * events (fire on completion, dry-fire on miss). Backspace does nothing.
 * Held-key repeats never advance text. Modifier chords are ignored.
 */

import type { KeyRecord } from '../input/types';
import { StatsTracker, type StatContext } from '../stats/keystats';

export interface EngineEvents {
  /** A correct keypress that is not yet the end of the token. */
  onHit?: (char: string) => void;
  /** A wrong keypress. expected/pressed for the confusion matrix. */
  onMiss?: (expected: string, pressed: string) => void;
  /** The whole token was completed (weapon fires). */
  onComplete?: (token: string) => void;
}

const IGNORED_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'Enter',
  'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'ContextMenu',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

export class TypingEngine {
  private token = '';
  private index = 0;
  private events: EngineEvents;
  private stats: StatsTracker;
  private context: StatContext;
  private tokenStartTime: number | null = null;
  private lastKeyTime: number | null = null;
  private enabled = true;

  constructor(stats: StatsTracker, events: EngineEvents = {}, context: StatContext = 'combat') {
    this.stats = stats;
    this.events = events;
    this.context = context;
  }

  setToken(token: string): void {
    this.token = token;
    this.index = 0;
    this.tokenStartTime = null;
    // lastKeyTime intentionally survives across tokens inside an encounter:
    // the inter-key interval from last char of one token to first char of the
    // next is still real typing rhythm. It is reset by setEnabled(false).
  }

  get currentToken(): string {
    return this.token;
  }

  get typedCount(): number {
    return this.index;
  }

  get remaining(): string {
    return this.token.slice(this.index);
  }

  get expectedChar(): string {
    return this.token[this.index] ?? '';
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.lastKeyTime = null;
  }

  handle(record: KeyRecord): void {
    if (!this.enabled || this.token === '' || this.index >= this.token.length) return;
    if (record.type !== 'down') return;
    if (record.repeat) return; // held keys never auto-advance combat text
    if (record.ctrl || record.alt || record.meta) return; // no modifier traps
    if (IGNORED_KEYS.has(record.key)) return;
    if (record.key.length !== 1) return;

    const expected = this.token[this.index];
    const now = record.timeStamp;
    const firstKeyLatency =
      this.tokenStartTime !== null && this.index === 0 ? now - this.tokenStartTime : null;
    const interKey = this.lastKeyTime !== null ? now - this.lastKeyTime : null;
    this.lastKeyTime = now;

    if (record.key === expected) {
      this.stats.recordPress(expected, record.key, true, this.context, interKey, firstKeyLatency);
      this.index += 1;
      if (this.index >= this.token.length) {
        this.events.onComplete?.(this.token);
      } else {
        this.events.onHit?.(expected);
      }
    } else {
      // Error logs against the EXPECTED key; pressed key recorded for the
      // confusion matrix. Cursor does not advance. Correction never erases
      // the logged error. PRD Section 5.
      this.stats.recordPress(expected, record.key, false, this.context, interKey, firstKeyLatency);
      this.events.onMiss?.(expected, record.key);
    }
  }

  /** Call when the token becomes visible, to anchor first-key latency. */
  markTokenShown(timeStamp: number): void {
    this.tokenStartTime = timeStamp;
  }
}
