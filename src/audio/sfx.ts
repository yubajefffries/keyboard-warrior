/**
 * Phase 0 weapon SFX kit: fire, dry-fire, pump, impact, shell, soft tick.
 * PRD Section 19.
 *
 * Synthesized with WebAudio so the repo stays fully redistributable (no
 * fetched assets yet). If a recorded CC0 kit lands later it replaces this
 * behind the same interface; see LICENSES.md.
 */

/** One second of noise, reused by every shot. */
const NOISE_SECONDS = 1;

export class WeaponAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Must be called from a user gesture (browser autoplay policy). */
  ensureStarted(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  private volume = 0.6;

  /**
   * 0..1 from the settings slider. Mapped so the profile default of 0.5 lands
   * on the gain this kit was tuned at, and 0 is actually silent.
   */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v)) * 1.2;
    if (this.volume > 1) this.volume = 1;
    if (this.master) this.master.gain.value = this.volume;
  }

  /**
   * Built once, then replayed from a random offset. Filling a fresh buffer per
   * shot meant ~17k Math.random() calls on the main thread every time the gun
   * fired; at burst typing speeds that is a frame hitch you can hear.
   */
  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise;
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  private playNoise(opts: {
    duration: number;
    gain: number;
    filterType: BiquadFilterType;
    freq: number;
    q?: number;
    decay: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const offset = Math.random() * Math.max(0, NOISE_SECONDS - opts.duration);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.value = opts.freq;
    filter.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + opts.decay);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0, offset, opts.duration);
  }

  private playTone(opts: {
    freq: number;
    endFreq?: number;
    duration: number;
    gain: number;
    type?: OscillatorType;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + opts.duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + opts.duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + opts.duration);
  }

  /** Shotgun blast: low boom + wideband crack. */
  fire(): void {
    this.playNoise({ duration: 0.35, gain: 0.9, filterType: 'lowpass', freq: 900, decay: 0.3 });
    this.playNoise({ duration: 0.12, gain: 0.5, filterType: 'highpass', freq: 2500, decay: 0.09 });
    this.playTone({ freq: 110, endFreq: 45, duration: 0.28, gain: 0.8, type: 'triangle' });
  }

  /** Error: dry metallic click, unmistakably not a shot. */
  dryFire(): void {
    this.playNoise({ duration: 0.05, gain: 0.4, filterType: 'bandpass', freq: 3200, q: 6, decay: 0.04 });
    this.playTone({ freq: 1600, endFreq: 900, duration: 0.05, gain: 0.15, type: 'square' });
  }

  /** Pump cycle: two mechanical clacks. */
  pump(): void {
    this.playNoise({ duration: 0.06, gain: 0.45, filterType: 'bandpass', freq: 1100, q: 3, decay: 0.05 });
    this.playNoise({ duration: 0.07, gain: 0.5, filterType: 'bandpass', freq: 800, q: 3, decay: 0.06, delay: 0.11 });
  }

  /** Pellet impact on flesh/target. */
  impact(): void {
    this.playNoise({ duration: 0.1, gain: 0.5, filterType: 'lowpass', freq: 500, decay: 0.09, delay: 0.02 });
  }

  /** Shell casing hitting the floor. */
  shell(): void {
    this.playTone({ freq: 5200, endFreq: 3800, duration: 0.05, gain: 0.12, type: 'sine', delay: 0.25 });
    this.playTone({ freq: 4600, endFreq: 3500, duration: 0.04, gain: 0.08, type: 'sine', delay: 0.34 });
  }

  /** Soft per-correct-key confirmation tick. */
  tick(): void {
    this.playTone({ freq: 2200, duration: 0.03, gain: 0.07, type: 'sine' });
  }

  /** Revolver: sharper, drier crack than the shotgun; one word, one shot. */
  revolverFire(): void {
    this.playNoise({ duration: 0.18, gain: 0.85, filterType: 'lowpass', freq: 1400, decay: 0.14 });
    this.playNoise({ duration: 0.08, gain: 0.55, filterType: 'highpass', freq: 3200, decay: 0.06 });
    this.playTone({ freq: 160, endFreq: 70, duration: 0.16, gain: 0.6, type: 'triangle' });
  }

  /** Cylinder ratchet after each shot: the revolver's pump-equivalent beat. */
  cylinder(): void {
    this.playNoise({ duration: 0.04, gain: 0.3, filterType: 'bandpass', freq: 2400, q: 5, decay: 0.035, delay: 0.12 });
  }

  /** Cylinder spin flourish every sixth shot. Cosmetic; Learn never blocks on a reload. */
  reloadSpin(): void {
    for (let i = 0; i < 6; i++) {
      this.playNoise({
        duration: 0.03, gain: 0.16, filterType: 'bandpass', freq: 2800, q: 6,
        decay: 0.025, delay: 0.16 + i * 0.05,
      });
    }
  }

  /** Low double thump: the warning that builds as health falls (PRD 16). */
  heartbeat(): void {
    this.playTone({ freq: 55, endFreq: 40, duration: 0.1, gain: 0.5, type: 'sine' });
    this.playTone({ freq: 50, endFreq: 38, duration: 0.09, gain: 0.35, type: 'sine', delay: 0.16 });
  }

  /** Meaty thud for a brute taking a hit without dying. */
  bruteHit(): void {
    this.playNoise({ duration: 0.14, gain: 0.6, filterType: 'lowpass', freq: 300, decay: 0.12, delay: 0.02 });
    this.playTone({ freq: 90, endFreq: 55, duration: 0.12, gain: 0.4, type: 'sine', delay: 0.02 });
  }
}
