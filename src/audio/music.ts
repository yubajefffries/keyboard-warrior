/**
 * The focus track. PRD Section 19 (atmosphere layer), added 2026-08-25.
 *
 * A binaural-beat soundtrack in the spirit of Doom/Quake having music under
 * the action -- except this game's job is sustained typing focus, so instead
 * of a metal riff it plays the thing that measurably holds attention: a
 * binaural beat. Two pure carriers, a few hertz apart, one per ear; the
 * brain hears the difference as a slow amplitude beat and tends to settle
 * toward that rhythm. The beat here is 14 Hz -- low beta, the alert-focus
 * band -- on a 180/194 Hz carrier pair, which is inside the range where the
 * binaural effect is strongest (carriers under ~1 kHz).
 *
 * Under the beat sits a very quiet dark ambient bed (a detuned sub drone
 * and a slow airy noise wash) so the track reads as a soundtrack rather
 * than a hearing test. Everything is synthesized: the repo stays fully
 * redistributable. Everything is STEADY or slow -- the wash's filter drifts
 * over ~20 seconds -- because PRD 22's no-strobe law is a good law for
 * audio too: nothing here throbs, stabs, or startles.
 *
 * The beat reaches the listener two ways, so the track works however it is
 * played: the binaural pair (headphones -- each ear must get its own
 * carrier), and a gentle amplitude pulse on the ambient bed at the SAME
 * 14 Hz (an isochronic tremolo), which is acoustic and survives speakers,
 * laptops, and mono. Headphones get both and are still the strongest
 * version; the settings screen says so.
 *
 * Runs on its own AudioContext so the weapon bus's compressor never ducks
 * the music and the music never pumps the guns. Toggled from settings
 * (profile.settings.focusTrack), scaled by the same master volume slider.
 */

/** The two carriers. Their difference is the beat the brain locks to. */
export const CARRIER_HZ = 180;
export const BEAT_HZ = 14; // low beta: alert, engaged, not jittery
/** Base gain of the whole track at full volume. It is a bed, not a lead. */
const TRACK_GAIN = 0.11;
/** Seconds for the fade in/out; an abrupt start would be a startle. */
const FADE_S = 1.5;

export class FocusTrack {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: { stop(): void }[] = [];
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

    // The beat: one pure carrier per ear, panned hard. The 14 Hz difference
    // exists only in the listener's head, which is the whole trick.
    const merger = ctx.createChannelMerger(2);
    merger.connect(this.master);
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
      this.nodes.push(osc);
    }

    // The bed bus: everything ambient runs through one gain whose level a
    // sine LFO rocks at the SAME beat frequency. This is what a speaker
    // listener actually receives -- the binaural pair needs separated ears,
    // but an amplitude pulse is plain acoustics. The swing is gentle (a
    // smooth tremolo, roughly half depth) so it reads as a slow shimmer in
    // the drone, never a stutter.
    const bed = ctx.createGain();
    bed.gain.value = 0.78;
    bed.connect(this.master);
    const pulse = ctx.createOscillator();
    pulse.type = 'sine';
    pulse.frequency.value = BEAT_HZ;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.26;
    pulse.connect(pulseDepth).connect(bed.gain);
    pulse.start();
    this.nodes.push(pulse);

    // The bed, part one: a sub drone two octaves down, slightly detuned
    // against itself so it breathes instead of standing still.
    for (const detune of [0, 1.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = CARRIER_HZ / 4 + detune;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      osc.connect(lp).connect(g).connect(bed);
      osc.start();
      this.nodes.push(osc);
    }

    // The bed, part two: a distant air wash. Looped noise through a narrow
    // band whose center drifts over ~20 seconds -- slow enough to be
    // weather, never a sweep you notice happening.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 2.5;
    const drift = ctx.createOscillator();
    drift.type = 'sine';
    drift.frequency.value = 1 / 20; // one slow breath every 20 seconds
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 120;
    drift.connect(driftDepth).connect(band.frequency);
    const washGain = ctx.createGain();
    washGain.gain.value = 0.16;
    noise.connect(band).connect(washGain).connect(bed);
    noise.start();
    drift.start();
    this.nodes.push(noise, drift);

    this.playing = true;
  }

  stop(): void {
    if (!this.playing || !this.ctx || !this.master) return;
    this.playing = false;
    const ctx = this.ctx;
    const master = this.master;
    const nodes = this.nodes;
    this.nodes = [];
    this.master = null;
    master.gain.setTargetAtTime(0.0001, ctx.currentTime, FADE_S / 4);
    // Let the fade finish before tearing the graph down.
    window.setTimeout(() => {
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          // already stopped
        }
      }
      master.disconnect();
    }, FADE_S * 1000);
  }
}
