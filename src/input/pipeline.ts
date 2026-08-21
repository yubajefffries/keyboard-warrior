/**
 * Input pipeline. PRD Section 3.1.
 *
 * This module MUST NOT import from the scene graph or any renderer.
 * It captures raw keyboard events on `window`, stamps them with a sequence
 * number and frame time, and forwards them to subscribers. Every later system
 * (typing engine, stats, harnesses) consumes these records, never raw DOM
 * events.
 */

export interface KeyRecord {
  /** Monotonic sequence number, assigned in listener order. */
  seq: number;
  type: 'down' | 'up';
  key: string;
  code: string;
  repeat: boolean;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  capsLock: boolean;
  /** DOM event.timeStamp (ms, coarsened by the browser). */
  timeStamp: number;
  /** Most recent requestAnimationFrame timestamp when the event fired. */
  frameTime: number;
}

export type KeyListener = (record: KeyRecord) => void;

export interface PipelineWarnings {
  capsLockOn: boolean;
  /** Shift reported down with no matching keyup for a suspicious duration. */
  stuckShift: boolean;
}

export class InputPipeline {
  private seq = 0;
  private listeners = new Set<KeyListener>();
  private warningListeners = new Set<(w: PipelineWarnings) => void>();
  private lastFrameTime = 0;
  private rafHandle = 0;
  private downKeys = new Map<string, number>(); // code -> timeStamp of keydown
  private warnings: PipelineWarnings = { capsLockOn: false, stuckShift: false };
  private observedDeltas: number[] = [];
  private lastTimeStamp = 0;
  private attached = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    this.trackResolution(e.timeStamp);
    if (!e.repeat) this.downKeys.set(e.code, e.timeStamp);
    this.updateWarnings(e);
    this.emit(this.toRecord(e, 'down'));
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.trackResolution(e.timeStamp);
    this.downKeys.delete(e.code);
    this.updateWarnings(e);
    this.emit(this.toRecord(e, 'up'));
  };

  private onBlur = (): void => {
    // Focus loss can eat keyups; clear held state so nothing is "stuck".
    this.downKeys.clear();
  };

  attach(target: Window = window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener('keydown', this.onKeyDown, { capture: true });
    target.addEventListener('keyup', this.onKeyUp, { capture: true });
    target.addEventListener('blur', this.onBlur);
    const tick = (t: number): void => {
      this.lastFrameTime = t;
      this.rafHandle = target.requestAnimationFrame(tick);
    };
    this.rafHandle = target.requestAnimationFrame(tick);
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    this.attached = false;
    target.removeEventListener('keydown', this.onKeyDown, { capture: true });
    target.removeEventListener('keyup', this.onKeyUp, { capture: true });
    target.removeEventListener('blur', this.onBlur);
    target.cancelAnimationFrame(this.rafHandle);
  }

  subscribe(fn: KeyListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onWarnings(fn: (w: PipelineWarnings) => void): () => void {
    this.warningListeners.add(fn);
    return () => this.warningListeners.delete(fn);
  }

  /**
   * Smallest positive gap between event timestamps seen so far, in ms.
   * Reported per browser by the Input Fidelity harness; the timing gate is
   * judged against this measured value, not assumed precision.
   */
  observedTimestampResolution(): number | null {
    if (this.observedDeltas.length === 0) return null;
    return Math.min(...this.observedDeltas);
  }

  /** Test hook: feed a synthetic event without a DOM. */
  injectForTest(partial: Partial<KeyRecord> & { key: string; type: 'down' | 'up' }): KeyRecord {
    const record: KeyRecord = {
      seq: this.seq++,
      code: partial.code ?? '',
      repeat: partial.repeat ?? false,
      shift: partial.shift ?? false,
      ctrl: partial.ctrl ?? false,
      alt: partial.alt ?? false,
      meta: partial.meta ?? false,
      capsLock: partial.capsLock ?? false,
      timeStamp: partial.timeStamp ?? 0,
      frameTime: partial.frameTime ?? 0,
      key: partial.key,
      type: partial.type,
    };
    for (const fn of this.listeners) fn(record);
    return record;
  }

  private toRecord(e: KeyboardEvent, type: 'down' | 'up'): KeyRecord {
    return {
      seq: this.seq++,
      type,
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
      capsLock: e.getModifierState ? e.getModifierState('CapsLock') : false,
      timeStamp: e.timeStamp,
      frameTime: this.lastFrameTime,
    };
  }

  private emit(record: KeyRecord): void {
    for (const fn of this.listeners) fn(record);
  }

  private trackResolution(t: number): void {
    if (this.lastTimeStamp > 0) {
      const delta = t - this.lastTimeStamp;
      if (delta > 0 && this.observedDeltas.length < 500) this.observedDeltas.push(delta);
    }
    this.lastTimeStamp = t;
  }

  private updateWarnings(e: KeyboardEvent): void {
    const capsLockOn = e.getModifierState ? e.getModifierState('CapsLock') : false;
    const shiftDownAt =
      this.downKeys.get('ShiftLeft') ?? this.downKeys.get('ShiftRight');
    const stuckShift =
      shiftDownAt !== undefined && e.timeStamp - shiftDownAt > 10_000;
    if (capsLockOn !== this.warnings.capsLockOn || stuckShift !== this.warnings.stuckShift) {
      this.warnings = { capsLockOn, stuckShift };
      for (const fn of this.warningListeners) fn(this.warnings);
    }
  }
}
