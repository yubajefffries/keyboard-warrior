/**
 * The focus track. PRD Section 19 (atmosphere layer).
 *
 * v3 (2026-08-26, Jeff's spec: "more than the simple beat -- sorta spooky,
 * sorta upbeat hip hop"). The track is now an actual composed loop instead
 * of a bare entrainment tone:
 *
 * - A boom-bap drum groove at 88 BPM with swung sixteenth hats: kick that
 *   digs, rimshot-snare on 2 and 4, quiet hats carrying the motion. Upbeat
 *   enough to type to; every velocity is jittered so the loop breathes.
 * - A SPOOKY harmonic bed in D minor: a slow detuned pad whose root sinks
 *   from D to Bb every four bars, a sub drone underneath, a bass line that
 *   leans on the tritone (D -> Ab) the way horror scores do, and a sparse
 *   far-away bell answering every other phrase through a long reverb.
 * - The binaural focus layer survives underneath (180/194 Hz carriers, one
 *   per ear = a 14 Hz beat in the low-beta band): headphones deepen the
 *   track, but the groove itself is plain acoustics and carries the rhythm
 *   on any speaker, laptop, or mono.
 *
 * Everything is synthesized at runtime -- oscillators, filtered noise, and
 * a generated impulse response -- so the repo stays fully redistributable.
 * Scheduling uses the standard WebAudio lookahead pattern: a coarse timer
 * books events a beat ahead on the audio clock, so a busy main thread
 * (the exact situation this game creates) never smears the groove.
 *
 * Runs on its own AudioContext so the weapon bus's compressor never ducks
 * the music and the music never pumps the guns. Toggled from settings
 * (profile.settings.focusTrack), scaled by the same master volume slider.
 */

/** The binaural pair. Their difference is the beat the brain locks to. */
export const CARRIER_HZ = 180;
export const BEAT_HZ = 14; // low beta: alert, engaged, not jittery
/** Groove tempo. Boom-bap lives in the mid-80s to low-90s. */
export const BPM = 88;
/** Base gain of the whole track at full volume. It is a bed, not a lead. */
const TRACK_GAIN = 0.16;
/** Seconds for the fade in/out; an abrupt start would be a startle. */
const FADE_S = 1.5;
/** Swing: how far every off-sixteenth leans late, as a share of a step. */
const SWING = 0.3;

const STEP_S = 60 / BPM / 4;
const BAR_S = STEP_S * 16;

// D natural minor, the corner of it this track lives in.
const D2 = 73.42;
const F2 = 87.31;
const AB2 = 103.83; // the tritone: the spook
const A2 = 110.0;
const BB1 = 58.27;
const AB4 = 415.3;
const D5 = 587.33;

export class FocusTrack {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private persistent: { stop(): void }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStepAt = 0;
  private step = 0;
  private playing = false;
  private volume = 0.5;

  get isPlaying(): boolean {
    return this.playing;
  }

  /** 0..1 from the settings slider, shared with the weapon kit. */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx && this.playing) {
      this.master.gain.setTargetAtTime(TRACK_GAIN * this.volume, this.ctx.currentTime, 0.1);
    }
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  start(): void {
    if (this.playing) {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    if (!this.ctx) this.ctx = new AudioContext();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(
      Math.max(0.001, TRACK_GAIN * this.volume),
      ctx.currentTime + FADE_S,
    );
    this.master.connect(ctx.destination);

    // The room the bell and snare live in: a long dark generated hall.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulseResponse(ctx);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.7;
    this.reverb.connect(reverbReturn);
    reverbReturn.connect(this.master);

    this.startSustained(ctx);

    // The groove: book steps a beat ahead on the audio clock.
    this.step = 0;
    this.nextStepAt = ctx.currentTime + 0.2;
    this.timer = setInterval(() => this.scheduleAhead(), 90);

    this.playing = true;
  }

  stop(): void {
    if (!this.playing || !this.ctx || !this.master) return;
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    const master = this.master;
    const persistent = this.persistent;
    this.persistent = [];
    this.master = null;
    this.reverb = null;
    master.gain.setTargetAtTime(0.0001, ctx.currentTime, FADE_S / 4);
    // Let the fade finish before tearing the graph down; scheduled one-shots
    // all route through this master, so they die with it.
    window.setTimeout(() => {
      for (const n of persistent) {
        try {
          n.stop();
        } catch {
          // already stopped
        }
      }
      master.disconnect();
    }, FADE_S * 1000);
  }

  // ---------- sustained layers ----------
  private startSustained(ctx: AudioContext): void {
    const master = this.master!;
    this.padOscs = [];
    this.subOsc = null;

    // The binaural pair: one pure carrier per ear, panned hard. The 14 Hz
    // difference exists only in the listener's head; speakers just hear a
    // quiet tone inside the pad.
    const merger = ctx.createChannelMerger(2);
    const pairGain = ctx.createGain();
    pairGain.gain.value = 0.22;
    merger.connect(pairGain).connect(master);
    for (const [freq, channel] of [
      [CARRIER_HZ, 0],
      [CARRIER_HZ + BEAT_HZ, 1],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g);
      g.connect(merger, 0, channel);
      osc.start();
      this.persistent.push(osc);
    }

    // The pad: two saws a few cents apart through a slowly breathing
    // lowpass. Its root steps D -> D -> Bb -> Bb across the four-bar
    // phrase -- the harmonic movement that makes the loop a piece of music
    // instead of a texture. Scheduled as glides so it never clicks.
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 420;
    padFilter.Q.value = 0.8;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.34;
    padFilter.connect(padGain).connect(master);
    const breathe = ctx.createOscillator();
    breathe.type = 'sine';
    breathe.frequency.value = 1 / (BAR_S * 2); // one slow breath per 2 bars
    const breatheDepth = ctx.createGain();
    breatheDepth.gain.value = 140;
    breathe.connect(breatheDepth).connect(padFilter.frequency);
    breathe.start();
    this.persistent.push(breathe);
    for (const detune of [-4, 3]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = D2;
      osc.detune.value = detune;
      // Program the whole phrase's root motion, repeating: hold D two bars,
      // sink to Bb for two. setInterval-free: rebooked with the drums.
      osc.connect(padFilter);
      osc.start();
      this.persistent.push(osc);
      this.padOscs.push(osc);
    }

    // The sub drone: the floor of the room.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = D2 / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.3;
    sub.connect(subGain).connect(master);
    sub.start();
    this.persistent.push(sub);
    this.subOsc = sub;
  }

  private padOscs: OscillatorNode[] = [];
  private subOsc: OscillatorNode | null = null;

  // ---------- the groove ----------
  private scheduleAhead(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    // Book everything inside the next ~250ms window.
    while (this.nextStepAt < ctx.currentTime + 0.25) {
      const swing = this.step % 2 === 1 ? STEP_S * SWING : 0;
      this.scheduleStep(this.step, this.nextStepAt + swing);
      this.step += 1;
      this.nextStepAt += STEP_S;
    }
  }

  private scheduleStep(step: number, t: number): void {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const jitter = () => 0.9 + Math.random() * 0.2;

    // Harmonic phrase: two bars on D, two on Bb, forever. The glide starts
    // just before the barline so the change lands ON it.
    if (s === 0) {
      const onBb = bar % 4 >= 2;
      for (const osc of this.padOscs) {
        osc.frequency.setTargetAtTime(onBb ? BB1 * 2 : D2, t - 0.05, 0.08);
      }
      this.subOsc?.frequency.setTargetAtTime(onBb ? BB1 : D2 / 2, t - 0.05, 0.08);
    }

    // Kick: the boom. 1, the and-of-2, the 3-and -- classic head-nod.
    if (s === 0 || s === 7 || s === 10 || (s === 13 && bar % 2 === 1)) {
      this.kick(t, s === 0 ? 1 : 0.8 * jitter());
    }
    // Snare: 2 and 4, a rim more than a crack, with room on it.
    if (s === 4 || s === 12) this.snare(t, jitter());
    // Hats: eighths with swung ghost notes between. Quiet on purpose.
    if (s % 2 === 0) this.hat(t, (s % 4 === 0 ? 0.5 : 0.35) * jitter(), 0.03);
    else if (s === 7 || s === 15) this.hat(t, 0.22 * jitter(), 0.05); // the swing made audible
    // An open hat breathes at the end of every second bar.
    if (s === 14 && bar % 2 === 1) this.hat(t, 0.3, 0.18);

    // Bass: follows the kick, and every other bar it leans on Ab -- the
    // tritone against D that keeps "upbeat" from becoming "cheerful".
    if (s === 0) this.bass(t, bar % 4 >= 2 ? BB1 * 2 : D2, STEP_S * 5);
    if (s === 7) this.bass(t, bar % 2 === 1 ? AB2 : D2, STEP_S * 2.5);
    if (s === 10) this.bass(t, F2, STEP_S * 3);
    if (s === 13 && bar % 2 === 1) this.bass(t, A2, STEP_S * 2);

    // The bell: one far-away note every other bar, alternating a cold D
    // with the darker Ab. Mostly reverb by the time it reaches you.
    if (s === 2 && bar % 2 === 0) this.bell(t, bar % 4 === 0 ? D5 : AB4);
  }

  // ---------- voices ----------
  private kick(t: number, vel: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = this.env(t, 0.85 * vel, 0.002, 0.24);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.3);
    // The knock on top, so it cuts on small speakers.
    const click = this.noise(t, 0.015, 'highpass', 1200, 0.12 * vel);
    click.connect(this.master!);
  }

  private snare(t: number, vel: number): void {
    const body = this.noise(t, 0.09, 'bandpass', 1700, 0.28 * vel, 1.2);
    body.connect(this.master!);
    if (this.reverb) {
      const send = this.ctx!.createGain();
      send.gain.value = 0.5;
      body.connect(send).connect(this.reverb);
    }
    const ctx = this.ctx!;
    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(190, t);
    tone.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    const g = this.env(t, 0.22 * vel, 0.001, 0.08);
    tone.connect(g).connect(this.master!);
    tone.start(t);
    tone.stop(t + 0.12);
  }

  private hat(t: number, vel: number, decayS: number): void {
    const h = this.noise(t, decayS, 'highpass', 6800, 0.16 * vel);
    h.connect(this.master!);
  }

  private bass(t: number, freq: number, durS: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const grit = ctx.createOscillator();
    grit.type = 'sawtooth';
    grit.frequency.value = freq;
    const gritGain = ctx.createGain();
    gritGain.gain.value = 0.25;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = this.env(t, 0.5, 0.01, durS);
    osc.connect(lp);
    grit.connect(gritGain).connect(lp);
    lp.connect(g).connect(this.master!);
    osc.start(t);
    grit.start(t);
    osc.stop(t + durS + 0.1);
    grit.stop(t + durS + 0.1);
  }

  private bell(t: number, freq: number): void {
    const ctx = this.ctx!;
    // Two slightly-inharmonic partials: a bell, not an organ.
    for (const [ratio, gain] of [
      [1, 0.12],
      [2.76, 0.05],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const g = this.env(t, gain, 0.004, 1.6);
      osc.connect(g);
      g.connect(this.master!);
      if (this.reverb) {
        const send = ctx.createGain();
        send.gain.value = 1.4; // the bell IS mostly its room
        g.connect(send).connect(this.reverb);
      }
      osc.start(t);
      osc.stop(t + 1.8);
    }
  }

  // ---------- shared machinery ----------
  private env(t: number, peak: number, attackS: number, decayS: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + attackS);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attackS + decayS);
    return g;
  }

  private noise(
    t: number,
    decayS: number,
    filterType: BiquadFilterType,
    freq: number,
    peak: number,
    q = 1,
  ): GainNode {
    const ctx = this.ctx!;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.env(t, peak, 0.001, decayS);
    src.connect(filter).connect(g);
    src.start(t, Math.random() * 0.5, decayS + 0.05);
    return g;
  }

  /** 1.6s of decaying noise, darkening toward the tail: a cold hall. */
  private impulseResponse(ctx: AudioContext): AudioBuffer {
    const seconds = 1.6;
    const rate = ctx.sampleRate;
    const length = Math.ceil(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const time = i / rate;
        const raw = (Math.random() * 2 - 1) * Math.exp(-time * 3.4);
        const k = Math.min(0.9, time * 0.85);
        smooth = smooth * k + raw * (1 - k);
        data[i] = smooth;
      }
    }
    return buffer;
  }
}
