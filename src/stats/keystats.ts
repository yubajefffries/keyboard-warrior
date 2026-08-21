/**
 * Per-key stat tracking, split by context. PRD Sections 5, 12, 13.
 *
 * Records accuracy, inter-key interval, and first-key latency per expected
 * key, plus a confusion matrix (expected key -> pressed key -> count).
 * Pure data structure; no DOM, no renderer.
 */

export type StatContext = 'learn' | 'combat' | 'speed_test';

export interface KeySample {
  expected: string;
  pressed: string;
  correct: boolean;
  context: StatContext;
  /** ms since previous keypress; null for the first press of a session. */
  interKeyMs: number | null;
  /** ms from prompt shown to first keypress of the token; null otherwise. */
  firstKeyLatencyMs: number | null;
}

export interface KeySummary {
  key: string;
  presses: number;
  errors: number;
  accuracy: number;
  meanInterKeyMs: number | null;
  meanFirstKeyLatencyMs: number | null;
}

export class StatsTracker {
  private samples: KeySample[] = [];
  private confusion = new Map<string, Map<string, number>>();

  recordPress(
    expected: string,
    pressed: string,
    correct: boolean,
    context: StatContext,
    interKeyMs: number | null,
    firstKeyLatencyMs: number | null,
  ): void {
    this.samples.push({ expected, pressed, correct, context, interKeyMs, firstKeyLatencyMs });
    if (!correct) {
      let row = this.confusion.get(expected);
      if (!row) {
        row = new Map();
        this.confusion.set(expected, row);
      }
      row.set(pressed, (row.get(pressed) ?? 0) + 1);
    }
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  totalAccuracy(context?: StatContext): number {
    const pool = context ? this.samples.filter((s) => s.context === context) : this.samples;
    if (pool.length === 0) return 1;
    return pool.filter((s) => s.correct).length / pool.length;
  }

  /**
   * Standard WPM over a wall-clock window: (correct chars / 5) / minutes.
   * The caller supplies elapsed ms so pause time can be excluded.
   */
  static wpm(correctChars: number, elapsedMs: number): number {
    if (elapsedMs <= 0) return 0;
    return correctChars / 5 / (elapsedMs / 60_000);
  }

  perKey(context?: StatContext): KeySummary[] {
    const byKey = new Map<string, KeySample[]>();
    for (const s of this.samples) {
      if (context && s.context !== context) continue;
      const list = byKey.get(s.expected) ?? [];
      list.push(s);
      byKey.set(s.expected, list);
    }
    const out: KeySummary[] = [];
    for (const [key, list] of byKey) {
      const errors = list.filter((s) => !s.correct).length;
      const intervals = list
        .map((s) => s.interKeyMs)
        .filter((v): v is number => v !== null && v > 0 && v < 5_000);
      const latencies = list
        .map((s) => s.firstKeyLatencyMs)
        .filter((v): v is number => v !== null && v > 0 && v < 30_000);
      out.push({
        key,
        presses: list.length,
        errors,
        accuracy: (list.length - errors) / list.length,
        meanInterKeyMs: intervals.length
          ? intervals.reduce((a, b) => a + b, 0) / intervals.length
          : null,
        meanFirstKeyLatencyMs: latencies.length
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : null,
      });
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  confusionMatrix(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [expected, row] of this.confusion) {
      out[expected] = Object.fromEntries(row);
    }
    return out;
  }

  exportJSON(): string {
    return JSON.stringify(
      {
        schemaVersion: 1,
        samples: this.samples,
        confusion: this.confusionMatrix(),
      },
      null,
      2,
    );
  }
}
