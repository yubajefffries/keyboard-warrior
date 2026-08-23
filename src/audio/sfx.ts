/**
 * Weapon SFX kit: fire, dry-fire, pump, impact, shell, tick, revolver,
 * heartbeat. PRD Section 19.
 *
 * Synthesized with WebAudio so the repo stays fully redistributable -- no
 * fetched assets, and even the reverb's impulse response is generated in
 * code. If a recorded CC0 kit lands later it replaces this behind the same
 * interface; see LICENSES.md.
 *
 * Tuned to the family's spec: "more bang, more reverb, think Quake." The
 * Quake recipe, translated to a signal chain:
 *
 * 1. GRIT. Weapon voices drive a tanh waveshaper HOT. The saturation is not
 *    a defect to avoid, it IS the character: it fattens the sub, splatters
 *    the mids, and glues the layers into one detonation instead of four
 *    polite bursts.
 * 2. A CAVERN, not a room. The generated impulse response runs 1.8 seconds
 *    with a slow decay and heavy early reflections; the reverb hears both
 *    the clean layers and a tap of the distorted bus, so the tail is as
 *    dirty as the shot. Every report hangs in the dark for a beat.
 * 3. LOW END that arrives like a door slam: a pitch-diving sub plus a
 *    saturated triangle growl underneath the boom.
 * 4. A COMPRESSOR squeezing hard enough to pump. That pump on the tail is
 *    half of what people remember as "90s shooter."
 * 5. JITTER on every trigger, because two identical shots in a row is the
 *    loudest possible tell of a synthesizer.
 *
 * UI sounds (tick, heartbeat) stay clean and dry: they bypass the grit bus
 * and get no room. The gun is the event; the interface is not.
 */

/** One second of noise, reused by every layer of every shot. */
const NOISE_SECONDS = 1;

export class WeaponAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private dry: GainNode | null = null;
  private grit: WaveShaperNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbReturn: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;

  /** Must be called from a user gesture (browser autoplay policy). */
  ensureStarted(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    // Bus layout:
    //   weapon voices -> grit(waveshaper) -> compressor -> master -> out
    //   UI voices ----------> dry --------> compressor
    //   voices (per-voice send) + grit tap -> reverb -> return -> compressor
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 10;
    this.compressor.ratio.value = 7;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.2; // slow enough to pump on the tail
    this.compressor.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.compressor);

    // The grit: soft-clip saturation, driven hot by the weapon layers.
    this.grit = ctx.createWaveShaper();
    this.grit.curve = this.saturationCurve(3.5);
    this.grit.oversample = '2x';
    const gritLevel = ctx.createGain();
    gritLevel.gain.value = 0.85;
    this.grit.connect(gritLevel);
    gritLevel.connect(this.compressor);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulseResponse(ctx);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.85;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.compressor);

    // The cavern also hears the distorted bus itself, so the tail carries
    // the same dirt as the shot instead of a polite clean echo.
    const gritToRoom = ctx.createGain();
    gritToRoom.gain.value = 0.4;
    this.grit.connect(gritToRoom);
    gritToRoom.connect(this.reverb);
  }

  /**
   * 0..1 from the settings slider. Mapped so the profile default of 0.5 lands
   * on the gain this kit was tuned at, and 0 is actually silent.
   */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v)) * 1.2;
    if (this.volume > 1) this.volume = 1;
    if (this.master) this.master.gain.value = this.volume;
  }

  // ---------- Shared machinery ----------

  /** tanh soft clip. k sets how hard the mids splatter. */
  private saturationCurve(k: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  /**
   * The cavern, generated: 1.8s of decaying noise, darkening toward the
   * tail, with heavy early slaps in the first 120ms offset per channel so
   * the pair decorrelates into width. Quake rooms were big, hard, and dark.
   */
  private impulseResponse(ctx: AudioContext): AudioBuffer {
    const seconds = 1.8;
    const rate = ctx.sampleRate;
    const length = Math.ceil(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        // Slow decay: the hall keeps answering long after the shot.
        const raw = (Math.random() * 2 - 1) * Math.exp(-t * 3.2);
        const k = Math.min(0.92, t * 0.9); // darken as it dies
        smooth = smooth * k + raw * (1 - k);
        data[i] = smooth;
      }
      // Early reflections: hard surfaces, close and loud, then the far walls.
      for (const [at, level] of [
        [0.012, 0.7], [0.025, 0.55], [0.043, 0.45], [0.061, 0.35],
        [0.083, 0.3], [0.112, 0.22],
      ] as const) {
        const idx = Math.floor((at + channel * 0.005) * rate);
        if (idx < length) data[idx] += level * (channel === 0 ? 1 : -1);
      }
    }
    return buffer;
  }

  /**
   * Built once, then replayed from a random offset. Filling a fresh buffer
   * per shot meant ~17k Math.random() calls on the main thread per trigger.
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

  /** +/- pct variation, so no two shots are the same shot. */
  private jitter(value: number, pct: number): number {
    return value * (1 + (Math.random() * 2 - 1) * pct);
  }

  /**
   * Route a voice: weapons into the grit bus, UI into the clean dry bus,
   * and a measured per-voice send into the cavern either way.
   */
  private out(node: AudioNode, reverbSend: number, gritty: boolean): void {
    node.connect(gritty ? this.grit! : this.dry!);
    if (reverbSend > 0 && this.reverb) {
      const send = this.ctx!.createGain();
      send.gain.value = reverbSend;
      node.connect(send);
      send.connect(this.reverb);
    }
  }

  /** An envelope that actually snaps: near-instant attack, exponential decay. */
  private envelope(t0: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return g;
  }

  private burst(opts: {
    duration: number;
    gain: number;
    filterType: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    attack?: number;
    delay?: number;
    reverb?: number;
    clean?: boolean;
  }): void {
    if (!this.ctx || !this.dry) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const offset = Math.random() * Math.max(0, NOISE_SECONDS - opts.duration);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.duration);
    filter.Q.value = opts.q ?? 1;
    const g = this.envelope(t0, opts.gain, opts.attack ?? 0.002, opts.duration);
    src.connect(filter).connect(g);
    this.out(g, opts.reverb ?? 0, !opts.clean);
    src.start(t0, offset, opts.duration + 0.05);
  }

  private toneHit(opts: {
    freq: number;
    endFreq?: number;
    duration: number;
    gain: number;
    type?: OscillatorType;
    attack?: number;
    delay?: number;
    reverb?: number;
    clean?: boolean;
  }): void {
    if (!this.ctx || !this.dry) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + opts.duration);
    const g = this.envelope(t0, opts.gain, opts.attack ?? 0.002, opts.duration);
    osc.connect(g);
    this.out(g, opts.reverb ?? 0, !opts.clean);
    osc.start(t0);
    osc.stop(t0 + opts.duration + 0.05);
  }

  /** A metallic contact: a resonant ping plus a grain of noise, over in ms. */
  private click(freq: number, gain: number, delay = 0, reverb = 0.15): void {
    this.burst({
      duration: 0.02, gain: gain * 0.7, filterType: 'bandpass',
      freq: this.jitter(freq, 0.06), q: 9, attack: 0.001, delay, reverb,
    });
    this.toneHit({
      freq: this.jitter(freq * 1.3, 0.06), endFreq: freq * 0.8, duration: 0.025,
      gain: gain * 0.4, type: 'triangle', attack: 0.001, delay, reverb,
    });
  }

  // ---------- The kit ----------

  /**
   * Shotgun: a detonation with a hall behind it. Sub dive, saturated growl,
   * a long boom whose filter closes as it dies, mid bark, top crack.
   */
  fire(): void {
    // The door slam: a sub that dives an octave and drives the shaper hard.
    this.toneHit({
      freq: this.jitter(120, 0.08), endFreq: 34, duration: 0.22,
      gain: 1.5, type: 'sine', attack: 0.001, reverb: 0.3,
    });
    // The growl underneath: saturated triangle, pure Quake.
    this.toneHit({
      freq: this.jitter(70, 0.1), endFreq: 40, duration: 0.3,
      gain: 0.9, type: 'triangle', attack: 0.001, reverb: 0.35,
    });
    // The boom: long, dark by the end.
    this.burst({
      duration: 0.45, gain: 1.2, filterType: 'lowpass',
      freq: this.jitter(700, 0.08), freqEnd: 110, attack: 0.001, reverb: 0.9,
    });
    // The bark that carries the report down the corridor.
    this.burst({
      duration: 0.15, gain: 0.95, filterType: 'bandpass',
      freq: this.jitter(900, 0.08), q: 1.1, attack: 0.001, reverb: 0.8,
    });
    // The crack on top.
    this.burst({
      duration: 0.045, gain: 0.85, filterType: 'highpass',
      freq: this.jitter(2800, 0.1), attack: 0.001, reverb: 0.65,
    });
  }

  /** Revolver: a magnum, not a pistol. Tighter than the pump, just as loud. */
  revolverFire(): void {
    this.toneHit({
      freq: this.jitter(140, 0.08), endFreq: 45, duration: 0.14,
      gain: 1.3, type: 'sine', attack: 0.001, reverb: 0.35,
    });
    this.toneHit({
      freq: this.jitter(85, 0.1), endFreq: 48, duration: 0.18,
      gain: 0.7, type: 'triangle', attack: 0.001, reverb: 0.3,
    });
    this.burst({
      duration: 0.24, gain: 1.05, filterType: 'lowpass',
      freq: this.jitter(1400, 0.08), freqEnd: 200, attack: 0.001, reverb: 0.95,
    });
    this.burst({
      duration: 0.09, gain: 0.85, filterType: 'bandpass',
      freq: this.jitter(1500, 0.08), q: 1.3, attack: 0.001, reverb: 0.8,
    });
    this.burst({
      duration: 0.04, gain: 0.9, filterType: 'highpass',
      freq: this.jitter(3400, 0.1), attack: 0.001, reverb: 0.7,
    });
  }

  /** Error: the hammer falls on nothing. Unmistakably not a shot. */
  dryFire(): void {
    this.click(3400, 0.55, 0, 0.08);
    this.click(1500, 0.3, 0.03, 0.06);
  }

  /** Pump cycle: heavy machinery, back and forward. */
  pump(): void {
    this.click(1300, 0.6, 0.1, 0.3);
    this.burst({
      duration: 0.06, gain: 0.55, filterType: 'bandpass',
      freq: this.jitter(800, 0.08), q: 3, attack: 0.002, delay: 0.1, reverb: 0.3,
    });
    this.click(950, 0.65, 0.22, 0.3);
    this.burst({
      duration: 0.07, gain: 0.6, filterType: 'bandpass',
      freq: this.jitter(600, 0.08), q: 3, attack: 0.002, delay: 0.22, reverb: 0.3,
    });
  }

  /** Pellet impact: a wet thud with a little pitch inside it. */
  impact(): void {
    this.toneHit({
      freq: this.jitter(110, 0.1), endFreq: 50, duration: 0.12,
      gain: 0.7, type: 'sine', attack: 0.002, delay: 0.02, reverb: 0.25,
    });
    this.burst({
      duration: 0.12, gain: 0.65, filterType: 'lowpass',
      freq: this.jitter(400, 0.1), attack: 0.002, delay: 0.02, reverb: 0.35,
    });
    this.burst({
      duration: 0.05, gain: 0.4, filterType: 'bandpass',
      freq: this.jitter(850, 0.1), q: 2, attack: 0.002, delay: 0.02, reverb: 0.25,
    });
  }

  /** Brass on concrete: tink, tink, and a small roll, echoing a little. */
  shell(): void {
    const base = this.jitter(4800, 0.08);
    this.click(base, 0.3, 0.26, 0.35);
    this.click(base * 0.82, 0.22, 0.38, 0.35);
    this.click(base * 0.9, 0.12, 0.47, 0.3);
  }

  /** Cylinder ratchet after each revolver shot: three teeth passing. */
  cylinder(): void {
    this.click(2400, 0.28, 0.12, 0.12);
    this.click(2600, 0.22, 0.145, 0.12);
    this.click(2200, 0.18, 0.17, 0.12);
  }

  /** Cylinder spin flourish every sixth shot. Cosmetic; Learn never blocks on a reload. */
  reloadSpin(): void {
    for (let i = 0; i < 7; i++) {
      this.click(this.jitter(2700, 0.05), 0.16, 0.18 + i * 0.045 + Math.random() * 0.008, 0.15);
    }
  }

  /** Heavy thud for a brute taking a hit without dying. */
  bruteHit(): void {
    this.toneHit({
      freq: this.jitter(75, 0.08), endFreq: 38, duration: 0.18,
      gain: 1.0, type: 'sine', attack: 0.002, delay: 0.02, reverb: 0.35,
    });
    this.burst({
      duration: 0.16, gain: 0.8, filterType: 'lowpass',
      freq: this.jitter(260, 0.1), attack: 0.002, delay: 0.02, reverb: 0.4,
    });
    this.burst({
      duration: 0.07, gain: 0.45, filterType: 'bandpass',
      freq: this.jitter(500, 0.1), q: 2.5, attack: 0.002, delay: 0.02, reverb: 0.3,
    });
  }

  /** Soft per-correct-key confirmation tick. Clean and dry: it is UI. */
  tick(): void {
    this.toneHit({ freq: 2100, duration: 0.025, gain: 0.06, type: 'sine', attack: 0.001, clean: true });
  }

  /** Low double thump: the warning that builds as health falls (PRD 16). */
  heartbeat(): void {
    this.toneHit({ freq: 58, endFreq: 40, duration: 0.11, gain: 0.5, type: 'sine', attack: 0.004, clean: true });
    this.toneHit({ freq: 52, endFreq: 38, duration: 0.1, gain: 0.35, type: 'sine', attack: 0.004, delay: 0.16, clean: true });
  }
}
