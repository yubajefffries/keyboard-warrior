/**
 * Weapon SFX kit: fire, dry-fire, pump, impact, shell, tick, revolver,
 * heartbeat. PRD Section 19.
 *
 * Synthesized with WebAudio so the repo stays fully redistributable -- no
 * fetched assets, and even the reverb's impulse response is generated in
 * code. If a recorded CC0 kit lands later it replaces this behind the same
 * interface; see LICENSES.md.
 *
 * What makes it sound like a gun rather than a beep, in order of importance:
 *
 * 1. A ROOM. Every shot feeds a convolver whose impulse response is a
 *    procedurally generated decaying-noise burst: the laboratory answers
 *    back. A gunshot with no tail reads as a UI click at any volume.
 * 2. A COMPRESSOR on the master bus. Layers stack without clipping and the
 *    transients hit harder than their raw sum.
 * 3. LAYERS with real envelopes: sub-thump for chest, body for boom, crack
 *    for the top, each with a near-instant attack and its own decay.
 * 4. JITTER. Every shot varies a few percent in pitch and gain, because two
 *    identical shots in a row is the loudest possible tell of a synthesizer.
 *
 * Everything is scheduled on the audio thread; per-shot node creation is what
 * WebAudio is designed for and never touches the frame loop the burst test
 * measures.
 */

/** One second of noise, reused by every layer of every shot. */
const NOISE_SECONDS = 1;

export class WeaponAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private dry: GainNode | null = null;
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

    // Bus layout: voices -> dry -> compressor -> master -> out
    //             voices -> (per-voice send) -> reverb -> return -> compressor
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.12;
    this.compressor.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.compressor);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulseResponse(ctx);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.6;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.compressor);
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

  /**
   * The room, generated: 0.7s of decaying noise with a handful of discrete
   * early reflections in the first 60ms, darkened toward the tail by simple
   * one-pole smoothing. Sounds like concrete and steel, which is what the
   * laboratory is made of.
   */
  private impulseResponse(ctx: AudioContext): AudioBuffer {
    const seconds = 0.7;
    const rate = ctx.sampleRate;
    const length = Math.ceil(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        // Tail: noise decaying fast, darkening as it goes (more smoothing later).
        const raw = (Math.random() * 2 - 1) * Math.exp(-t * 7);
        const k = Math.min(0.9, t * 1.4);
        smooth = smooth * k + raw * (1 - k);
        data[i] = smooth;
      }
      // Early reflections: a few hard slaps off nearby walls, offset per
      // channel so the pair decorrelates into a sense of width.
      for (const [at, level] of [[0.011, 0.5], [0.023, 0.35], [0.041, 0.28], [0.058, 0.2]] as const) {
        const idx = Math.floor((at + channel * 0.004) * rate);
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

  /** Route a voice's output: full dry, and a measured send into the room. */
  private out(node: AudioNode, reverbSend: number): void {
    node.connect(this.dry!);
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
    this.out(g, opts.reverb ?? 0);
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
    this.out(g, opts.reverb ?? 0);
    osc.start(t0);
    osc.stop(t0 + opts.duration + 0.05);
  }

  /** A metallic contact: a resonant ping plus a grain of noise, over in ms. */
  private click(freq: number, gain: number, delay = 0, reverb = 0.1): void {
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

  /** Shotgun: sub-thump, boom with a closing filter, mid bark, top crack. */
  fire(): void {
    // Chest: a fast pitch-drop sub. This is the layer you feel.
    this.toneHit({
      freq: this.jitter(110, 0.08), endFreq: 38, duration: 0.16,
      gain: 1.0, type: 'sine', attack: 0.001, reverb: 0.15,
    });
    // Boom: the filter closes as it decays, darkening naturally.
    this.burst({
      duration: 0.3, gain: 0.9, filterType: 'lowpass',
      freq: this.jitter(750, 0.08), freqEnd: 160, attack: 0.001, reverb: 0.5,
    });
    // Bark: the mid-range slap that carries the report.
    this.burst({
      duration: 0.11, gain: 0.75, filterType: 'bandpass',
      freq: this.jitter(950, 0.08), q: 1.1, attack: 0.001, reverb: 0.4,
    });
    // Crack: the first half-centisecond of a muzzle blast.
    this.burst({
      duration: 0.035, gain: 0.65, filterType: 'highpass',
      freq: this.jitter(3000, 0.1), attack: 0.001, reverb: 0.35,
    });
  }

  /** Revolver: tighter and brighter than the pump, with more room in it. */
  revolverFire(): void {
    this.toneHit({
      freq: this.jitter(150, 0.08), endFreq: 55, duration: 0.09,
      gain: 0.85, type: 'sine', attack: 0.001, reverb: 0.2,
    });
    this.burst({
      duration: 0.16, gain: 0.8, filterType: 'lowpass',
      freq: this.jitter(1500, 0.08), freqEnd: 300, attack: 0.001, reverb: 0.55,
    });
    this.burst({
      duration: 0.07, gain: 0.7, filterType: 'bandpass',
      freq: this.jitter(1600, 0.08), q: 1.4, attack: 0.001, reverb: 0.45,
    });
    this.burst({
      duration: 0.03, gain: 0.7, filterType: 'highpass',
      freq: this.jitter(3600, 0.1), attack: 0.001, reverb: 0.4,
    });
  }

  /** Error: the hammer falls on nothing. Unmistakably not a shot. */
  dryFire(): void {
    this.click(3400, 0.55, 0, 0.08);
    this.click(1500, 0.3, 0.03, 0.06);
  }

  /** Pump cycle: back and forward, two different pieces of metal. */
  pump(): void {
    this.click(1700, 0.5, 0.1, 0.15);
    this.burst({
      duration: 0.05, gain: 0.4, filterType: 'bandpass',
      freq: this.jitter(950, 0.08), q: 3, attack: 0.002, delay: 0.1, reverb: 0.15,
    });
    this.click(1250, 0.55, 0.21, 0.15);
    this.burst({
      duration: 0.06, gain: 0.45, filterType: 'bandpass',
      freq: this.jitter(700, 0.08), q: 3, attack: 0.002, delay: 0.21, reverb: 0.15,
    });
  }

  /** Pellet impact: a wet thud with a little pitch inside it. */
  impact(): void {
    this.toneHit({
      freq: this.jitter(120, 0.1), endFreq: 55, duration: 0.1,
      gain: 0.5, type: 'sine', attack: 0.002, delay: 0.02, reverb: 0.15,
    });
    this.burst({
      duration: 0.1, gain: 0.5, filterType: 'lowpass',
      freq: this.jitter(420, 0.1), attack: 0.002, delay: 0.02, reverb: 0.2,
    });
    this.burst({
      duration: 0.045, gain: 0.3, filterType: 'bandpass',
      freq: this.jitter(850, 0.1), q: 2, attack: 0.002, delay: 0.02, reverb: 0.15,
    });
  }

  /** Brass on concrete: tink, tink, and a small roll. */
  shell(): void {
    const base = this.jitter(4800, 0.08);
    this.click(base, 0.3, 0.24, 0.25);
    this.click(base * 0.82, 0.22, 0.35, 0.25);
    this.click(base * 0.9, 0.12, 0.43, 0.2);
  }

  /** Cylinder ratchet after each revolver shot: three teeth passing. */
  cylinder(): void {
    this.click(2400, 0.28, 0.1, 0.1);
    this.click(2600, 0.22, 0.125, 0.1);
    this.click(2200, 0.18, 0.15, 0.1);
  }

  /** Cylinder spin flourish every sixth shot. Cosmetic; Learn never blocks on a reload. */
  reloadSpin(): void {
    for (let i = 0; i < 7; i++) {
      this.click(this.jitter(2700, 0.05), 0.16, 0.16 + i * 0.045 + Math.random() * 0.008, 0.12);
    }
  }

  /** Meaty thud for a brute taking a hit without dying. */
  bruteHit(): void {
    this.toneHit({
      freq: this.jitter(80, 0.08), endFreq: 42, duration: 0.14,
      gain: 0.7, type: 'sine', attack: 0.002, delay: 0.02, reverb: 0.2,
    });
    this.burst({
      duration: 0.13, gain: 0.6, filterType: 'lowpass',
      freq: this.jitter(280, 0.1), attack: 0.002, delay: 0.02, reverb: 0.25,
    });
    this.burst({
      duration: 0.06, gain: 0.35, filterType: 'bandpass',
      freq: this.jitter(520, 0.1), q: 2.5, attack: 0.002, delay: 0.02, reverb: 0.2,
    });
  }

  /** Soft per-correct-key confirmation tick. Deliberately dry: it is UI. */
  tick(): void {
    this.toneHit({ freq: 2100, duration: 0.025, gain: 0.06, type: 'sine', attack: 0.001 });
  }

  /** Low double thump: the warning that builds as health falls (PRD 16). */
  heartbeat(): void {
    this.toneHit({ freq: 58, endFreq: 40, duration: 0.11, gain: 0.5, type: 'sine', attack: 0.004 });
    this.toneHit({ freq: 52, endFreq: 38, duration: 0.1, gain: 0.35, type: 'sine', attack: 0.004, delay: 0.16 });
  }
}
