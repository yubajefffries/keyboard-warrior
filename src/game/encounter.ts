/**
 * The combat encounter. PRD Sections 4, 6, 9, 14, 16.
 *
 * Was `main.ts` in Phase 0; now a class so the app can start one for a lesson,
 * stop it, and start another without rebuilding the scene. The scene, the gun,
 * and the enemies are created once and reused: rebuilding Babylon meshes
 * between lessons would stall the frame exactly when the player is warmed up.
 *
 * Learn-mode health (PRD 16): misses never kill. The only death is an enemy
 * physically reaching the player, and death is a checkpoint retry with one
 * diagnosis line.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

import type { InputPipeline } from '../input/pipeline';
import { TypingEngine } from './engine';
import {
  applyCreatureIntensity,
  buildCreature,
  makeCreatureMaterialSet,
  type Creature,
  type CreatureMaterialSet,
} from './creatures';
import { StatsTracker } from '../stats/keystats';
import type { WeaponAudio } from '../audio/sfx';
import { Scorer, type EnemyKind, type ScoreBreakdown } from './scoring';
import { buildFacility } from './environment';
import {
  HEARTBEAT_AT,
  HEARTBEAT_URGENT_AT,
  MAX_HEALTH,
  MISS_DRAIN,
  threatDrainPerS,
} from '../modes/survival';
import type { PromptView } from '../ui/prompt';
import { RobotTypist, judgeBurst, type RobotReport } from '../dev/robot';

export type EncounterState = 'idle' | 'running' | 'paused' | 'dead';

export interface EncounterDeps {
  canvas: HTMLCanvasElement;
  prompt: PromptView;
  hud: HTMLElement;
  audio: WeaponAudio;
  pipeline: InputPipeline;
  /** Read fresh every token so a settings change applies immediately. */
  lookahead: () => number;
}

/** Consecutive misses on one key before the finger hint offers itself. PRD 10. */
export const HINT_AFTER_CONSECUTIVE_MISSES = 3;

export interface EffectSettings {
  /** Low: silhouettes, no muzzle flash. PRD 21/22 intensity. */
  intensity: 'low' | 'full';
  /** Scales recoil, pump, and enemy sway down. Prompt is already locked. */
  motionReduction: boolean;
}

export interface EncounterCallbacks {
  onDeath?: (diagnosis: string) => void;
  /** An enemy died. Survival counts these against the wave quota. */
  onKill?: (kind: EnemyKind) => void;
  /**
   * The same key has been missed several times running. The app decides
   * whether to surface a finger hint, since only it knows the player's
   * finger-guide preference.
   */
  onStruggle?: (key: string) => void;
  onTokenComplete?: (token: string, completed: number, tokenAccuracy: number) => void;
  onPause?: (reason: string) => void;
  onBurstReport?: (html: string, report: RobotReport) => void;
}

export interface EncounterProgress {
  correctChars: number;
  /** Every typing press this run, hits and misses. */
  presses: number;
  activeMs: number;
  tokensCompleted: number;
  accuracy: number;
  wpm: number;
}

const MAX_RENDERED = 5;
const KILL_LINE_Z = -1.6;
/** Mean spawn depth; enemies appear at -34 to -38, so ~34 units of walk. */
const MEAN_TRAVEL_UNITS = 36 - Math.abs(KILL_LINE_Z);

/** The two dials the pacing model sets. Everything else follows from them. */
export interface EncounterPacing {
  spawnIntervalS: number;
  walkTimeS: number;
}

/**
 * Each enemy carries its own words, assigned at spawn. PRD 6/14: the active
 * target's word is the prompt, and what the look-ahead shows is the actual
 * queue of enemies -- so the promise "what you see coming is what arrives"
 * is now world-truth instead of queue-truth.
 */
export interface EnemyTokenProvider {
  tokensFor(kind: EnemyKind): string[];
}

export type WeaponKind = 'shotgun' | 'revolver';

interface EnemyT {
  creature: Creature;
  speed: number;
  alive: boolean;
  kind: EnemyKind;
  /** Remaining words. The hound spawns with two, the mech with three;
   *  killing an enemy takes all of them. */
  tokens: string[];
  /** Words carried at spawn, so the health bar knows what a full bar is. */
  totalTokens: number;
}

/** Per-kind movement relative to the pacing walk time. PRD 14. [REVIEW] */
const KIND_SPEED: Record<EnemyKind, number> = { standard: 1, crawler: 1.7, brute: 0.6 };
/** Where a shot lands on each kind: center mass, in world units off the ground. */
const AIM_Y: Record<EnemyKind, number> = { standard: 0.75, crawler: 0.4, brute: 1.9 };
/** Seconds the tracer takes to cross to its target. Fast, but seen. */
const TRACER_S = 0.07;
/** Seconds the muzzle flash geometry stays lit. One brief flash per shot. */
const FLASH_S = 0.06;
/** Learn-mode spawn odds once variety is on (Stage 3+); survival overrides
 *  per wave via setMix. At most one brute at a time either way. [REVIEW] */
const DEFAULT_CRAWLER_CHANCE = 0.18;
const DEFAULT_BRUTE_CHANCE = 0.1;

/** Matches the old hardcoded feel, for callers that pass no pacing. */
const DEFAULT_PACING: EncounterPacing = { spawnIntervalS: 5.5, walkTimeS: 50 };

export class Encounter {
  private deps: EncounterDeps;
  private cb: EncounterCallbacks = {};

  private engine3d: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private gunRoot: TransformNode;
  private pumpGrip: Mesh;
  private muzzle: PointLight;
  private creatureMats: CreatureMaterialSet;
  private shotgunNode: TransformNode;
  private revolverNode: TransformNode;
  private cylinderMesh: Mesh;

  private enemies: EnemyT[] = [];
  private recoil = 0;
  private pumpAnim = 0;
  private flashMesh: Mesh;
  private flashT = 0;
  private tracerMesh: Mesh;
  /** -1 idle; otherwise 0..1 progress from muzzle to target. */
  private tracerT = -1;
  private tracerFrom = new Vector3();
  private tracerTo = new Vector3();
  private spawnTimer = 0;
  private hudLine = '';

  /** Fresh per lesson: a lesson is scored on its own samples. */
  private tracker = new StatsTracker();
  private state: EncounterState = 'idle';
  private pausedFrom: EncounterState = 'running';
  private provider: EnemyTokenProvider | null = null;
  private active: EnemyT | null = null;
  private weapon: WeaponKind = 'shotgun';
  private variety = false;
  private showCombo = false;
  private mode: 'learn' | 'survival' = 'learn';
  private health = MAX_HEALTH;
  private heartbeatIn = 0;
  private waveNo = 0;
  private crawlerChance = DEFAULT_CRAWLER_CHANCE;
  private bruteChance = DEFAULT_BRUTE_CHANCE;
  private scorer = new Scorer();
  private shotsFired = 0;
  private typing: TypingEngine;
  /**
   * Enemies rolled ahead of their spawn so the look-ahead is never empty:
   * when the walking world holds fewer upcoming words than the player wants
   * to read, the queue is topped up from here, and spawn() consumes it in
   * order. The promise "what you see coming is what arrives" holds either
   * way -- these ARE the next arrivals.
   */
  private pending: { kind: EnemyKind; tokens: string[] }[] = [];
  private tokensCompleted = 0;
  private correctChars = 0;
  private missCount = 0;
  private activeMs = 0;
  private attempts = new Map<string, { errors: number; presses: number }>();
  private pacing: EncounterPacing = DEFAULT_PACING;
  /**
   * Retired bodies, reused by kind. Killing an enemy runs inside the
   * keystroke handler, and disposing (or rebuilding) a ~20-mesh hierarchy
   * there would eat the 4 ms per-key budget the burst test enforces; a
   * pooled creature is disabled and re-enabled instead. Bounded by
   * MAX_RENDERED per kind.
   */
  private creaturePool: Record<EnemyKind, Creature[]> = { standard: [], crawler: [], brute: [] };
  private effects: EffectSettings = { intensity: 'full', motionReduction: false };
  /** Presses at the moment the current token started, for per-token accuracy. */
  private tokenStartPresses = 0;
  private tokenStartCorrect = 0;
  private struggleKey: string | null = null;
  private struggleCount = 0;
  private spawnEnemies = true;

  // Robot burst (see docs/BURST_TESTING.md)
  private robot: RobotTypist;
  private burstSent = '';
  private burstObserved = '';
  private lastBurst: { report: RobotReport; expected: string; observed: string } | null = null;

  constructor(deps: EncounterDeps) {
    this.deps = deps;

    this.engine3d = new Engine(deps.canvas, true, { preserveDrawingBuffer: false, stencil: false });
    this.scene = new Scene(this.engine3d);
    this.scene.clearColor = new Color4(0.015, 0.025, 0.022, 1);

    this.camera = new FreeCamera('cam', new Vector3(0, 1.7, 0), this.scene);
    this.camera.setTarget(new Vector3(0, 1.5, -10));
    this.camera.inputs.clear(); // rail shooter: hands never leave typing position

    // Lighting stays inside the budget the gray-box used: hemispheric ambient
    // plus one lamp; the muzzle flash is the second dynamic light. Everything
    // else the laboratory appears lit by is emissive material, which is free.
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.32;
    ambient.diffuse = new Color3(0.45, 0.58, 0.55); // cold institutional green
    ambient.groundColor = new Color3(0.08, 0.1, 0.09);
    const lamp = new PointLight('lamp', new Vector3(0, 3.6, -7), this.scene);
    lamp.intensity = 0.65;
    lamp.diffuse = new Color3(0.75, 0.9, 0.8);

    // The abandoned robotics facility (PRD 8, environment passes). Static,
    // frozen, procedural; see environment.ts for the budget notes.
    buildFacility(this.scene);

    // Recoil moves the GUN, never the prompt.
    this.gunRoot = new TransformNode('gunRoot', this.scene);
    this.gunRoot.parent = this.camera;
    this.gunRoot.position.set(0.45, -0.42, 1.2);
    const gunMat = new StandardMaterial('gunMat', this.scene);
    gunMat.diffuseColor = new Color3(0.12, 0.12, 0.13);
    gunMat.specularColor = new Color3(0.3, 0.3, 0.3);

    // Shotgun: barrel, receiver, pump. Built once, toggled by setWeapon.
    this.shotgunNode = new TransformNode('shotgun', this.scene);
    this.shotgunNode.parent = this.gunRoot;
    const barrel = MeshBuilder.CreateCylinder('barrel', { diameter: 0.07, height: 0.9 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.35;
    barrel.parent = this.shotgunNode;
    barrel.material = gunMat;
    const receiver = MeshBuilder.CreateBox('receiver', { width: 0.09, height: 0.14, depth: 0.5 }, this.scene);
    receiver.position.z = -0.1;
    receiver.parent = this.shotgunNode;
    receiver.material = gunMat;
    this.pumpGrip = MeshBuilder.CreateBox('pump', { width: 0.1, height: 0.09, depth: 0.22 }, this.scene);
    this.pumpGrip.position.set(0, -0.09, 0.28);
    this.pumpGrip.parent = this.shotgunNode;
    this.pumpGrip.material = gunMat;

    // Revolver: short barrel, visible cylinder that spins on every shot, grip.
    this.revolverNode = new TransformNode('revolver', this.scene);
    this.revolverNode.parent = this.gunRoot;
    this.revolverNode.setEnabled(false);
    const rBarrel = MeshBuilder.CreateCylinder('rbarrel', { diameter: 0.05, height: 0.42 }, this.scene);
    rBarrel.rotation.x = Math.PI / 2;
    rBarrel.position.set(0, 0.02, 0.22);
    rBarrel.parent = this.revolverNode;
    rBarrel.material = gunMat;
    this.cylinderMesh = MeshBuilder.CreateCylinder('rcyl', { diameter: 0.11, height: 0.09, tessellation: 6 }, this.scene);
    this.cylinderMesh.rotation.x = Math.PI / 2;
    this.cylinderMesh.position.set(0, 0.01, -0.02);
    this.cylinderMesh.parent = this.revolverNode;
    this.cylinderMesh.material = gunMat;
    const rGrip = MeshBuilder.CreateBox('rgrip', { width: 0.055, height: 0.16, depth: 0.07 }, this.scene);
    rGrip.position.set(0, -0.1, -0.1);
    rGrip.rotation.x = 0.35;
    rGrip.parent = this.revolverNode;
    rGrip.material = gunMat;

    this.muzzle = new PointLight('muzzle', new Vector3(0, 0, 0.9), this.scene);
    this.muzzle.parent = this.gunRoot;
    this.muzzle.diffuse = new Color3(1, 0.7, 0.3);
    this.muzzle.intensity = 0;

    // The visible muzzle flash: one small emissive card at the barrel tip,
    // lit for FLASH_S per shot with a random spin so no two flashes match.
    // Suppressed entirely at low intensity (PRD 21/22), same as the light.
    const flashMat = new StandardMaterial('flashMat', this.scene);
    flashMat.emissiveColor = new Color3(1, 0.75, 0.3);
    flashMat.diffuseColor = Color3.Black();
    flashMat.disableLighting = true;
    this.flashMesh = MeshBuilder.CreatePlane('flash', { size: 0.3, sideOrientation: 2 /* DOUBLESIDE */ }, this.scene);
    this.flashMesh.parent = this.gunRoot;
    this.flashMesh.position.set(0, 0, 0.92);
    this.flashMesh.isPickable = false;
    this.flashMesh.material = flashMat;
    this.flashMesh.setEnabled(false);

    // The tracer: a short bright round that crosses from the muzzle to the
    // target in TRACER_S, so every shot is SEEN to land on the machine that
    // carried the word. World-space, emissive, fog applies.
    const tracerMat = new StandardMaterial('tracerMat', this.scene);
    tracerMat.emissiveColor = new Color3(1, 0.82, 0.35);
    tracerMat.diffuseColor = Color3.Black();
    tracerMat.disableLighting = true;
    this.tracerMesh = MeshBuilder.CreateBox('tracer', { width: 0.04, height: 0.04, depth: 1.5 }, this.scene);
    this.tracerMesh.isPickable = false;
    this.tracerMesh.material = tracerMat;
    this.tracerMesh.setEnabled(false);

    this.creatureMats = makeCreatureMaterialSet(this.scene);

    this.typing = new TypingEngine(this.tracker, {
      onPress: (pressed) => {
        if (this.robot.running) this.burstObserved += pressed;
      },
      onHit: (char) => {
        deps.audio.tick();
        this.bump(char, true);
        this.correctChars += 1;
        const combo = this.scorer.hit();
        if (combo.tierUp) this.pulseHud();
        // A clean press clears the struggle: the hint is for a key that is
        // genuinely lost, not for one fumbled once.
        if (this.struggleKey === char) this.resetStruggle();
        this.redrawActive();
      },
      onMiss: (expected) => {
        deps.audio.dryFire();
        this.missCount += 1;
        this.scorer.miss();
        // Survival's full error stack (PRD 5): a small drain, exactly once.
        if (this.mode === 'survival') this.health = Math.max(0, this.health - MISS_DRAIN);
        this.bump(expected, false);
        this.deps.prompt.flashError(performance.now());
        this.noteStruggle(expected);
        this.redrawActive();
      },
      onComplete: (token) => {
        this.correctChars += 1;
        this.bump(token[token.length - 1], true);
        const combo = this.scorer.hit();
        if (combo.tierUp) this.pulseHud();
        this.scorer.word(token);
        this.tokensCompleted += 1;

        // One token, one shot. Whether it kills depends on who carried it:
        // hounds and mechs soak hits until their word list is empty.
        const target = this.active;
        if (target) {
          target.tokens.shift();
          if (target.tokens.length === 0) {
            this.fireWeapon(true, this.aimPointOf(target));
            this.scorer.elimination(target.kind);
            target.alive = false;
            this.releaseCreature(target.creature);
            this.cb.onKill?.(target.kind);
          } else {
            this.fireWeapon(false, this.aimPointOf(target));
            this.deps.audio.bruteHit();
            // Staggered, not stopped: knocked back but still coming -- and
            // now wearing its remaining armor as a bar over its head.
            target.creature.root.position.z = Math.max(-38, target.creature.root.position.z - 1.2);
            target.creature.stagger();
            target.creature.setHealth(target.tokens.length / target.totalTokens);
          }
        } else {
          this.fireWeapon(true);
        }

        // Accuracy of just this token, for the break-suggestion detector.
        const presses = this.correctChars + this.missCount - this.tokenStartPresses;
        const correct = this.correctChars - this.tokenStartCorrect;
        const tokenAccuracy = presses > 0 ? correct / presses : 1;
        // PRD 6 switching rule: the active target changes ONLY here, at a
        // token boundary. Priority re-evaluates; the brute can lose the floor
        // to a crawler that got closer, and keeps its remaining words.
        this.engageNearest();
        this.cb.onTokenComplete?.(token, this.tokensCompleted, tokenAccuracy);
      },
    });

    this.robot = new RobotTypist({
      nextChar: () => (this.state === 'running' ? this.typing.expectedChar || null : null),
      onSample: (s) => {
        this.burstSent += s.sent;
      },
      onFinish: (report) => {
        this.lastBurst = { report, expected: this.burstSent, observed: this.burstObserved };
        this.cb.onBurstReport?.(this.burstReportHtml(), report);
      },
    });

    deps.pipeline.subscribe((record) => {
      if (this.state !== 'running') return;
      this.typing.handle(record);
    });

    this.scene.onBeforeRenderObservable.add(() => this.frame());
    this.engine3d.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', () => this.engine3d.resize());
  }

  // ---------- lifecycle ----------
  on(callbacks: EncounterCallbacks): void {
    this.cb = callbacks;
  }

  /** Samples from the run that just finished, for folding into the profile. */
  get stats(): StatsTracker {
    return this.tracker;
  }

  start(
    provider: EnemyTokenProvider,
    opts: {
      spawnEnemies?: boolean;
      pacing?: EncounterPacing;
      weapon?: WeaponKind;
      /** Crawlers and brutes join from Stage 3. PRD 14 (1b). */
      variety?: boolean;
      /** Whether score and combo appear on the HUD. PRD 17 visibility. */
      showCombo?: boolean;
      /** Survival: health drains, misses cost, death ends the run. PRD 16. */
      mode?: 'learn' | 'survival';
    } = {},
  ): void {
    this.mode = opts.mode ?? 'learn';
    this.health = MAX_HEALTH;
    this.heartbeatIn = 0;
    this.waveNo = this.mode === 'survival' ? 1 : 0;
    this.spawnEnemies = opts.spawnEnemies ?? true;
    if (opts.pacing) this.pacing = opts.pacing;
    this.setWeapon(opts.weapon ?? 'shotgun');
    this.variety = opts.variety ?? false;
    this.showCombo = opts.showCombo ?? false;
    this.crawlerChance = DEFAULT_CRAWLER_CHANCE;
    this.bruteChance = DEFAULT_BRUTE_CHANCE;
    this.provider = provider;
    this.tracker = new StatsTracker();
    this.typing.setStats(this.tracker);
    this.scorer = new Scorer();
    this.shotsFired = 0;
    this.clearEnemies();
    this.pending = []; // a new source: pre-rolled arrivals from the old one are void
    this.attempts = new Map();
    this.tokensCompleted = 0;
    this.correctChars = 0;
    this.missCount = 0;
    this.activeMs = 0;
    this.spawnTimer = 0;
    this.resetStruggle();
    this.state = 'running';
    this.typing.setEnabled(true);
    this.spawn();
    this.spawn();
    this.engageNearest();
  }

  /** In Learn, the lesson dictates the weapon (PRD 15). */
  setWeapon(weapon: WeaponKind): void {
    this.weapon = weapon;
    this.shotgunNode.setEnabled(weapon === 'shotgun');
    this.revolverNode.setEnabled(weapon === 'revolver');
  }

  /** Final score for the result screen. Call once when the lesson ends. */
  finalizeScore(accuracy: number, wpm: number): ScoreBreakdown {
    return this.scorer.finalize(accuracy, wpm);
  }

  get bestStreak(): number {
    return this.scorer.bestStreak;
  }

  stop(): void {
    if (this.robot.running) this.robot.stop();
    this.state = 'idle';
    this.typing.setEnabled(false);
    this.clearEnemies();
  }

  pause(reason: string): void {
    if (this.state !== 'running') return;
    if (this.robot.running) this.robot.stop();
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.typing.setEnabled(false);
    this.cb.onPause?.(reason);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.typing.setEnabled(true);
  }

  /**
   * Applied to enemies spawned from now on; the ones already walking keep
   * their speed. Used by the timer-was-wrong easing between attempts.
   */
  setPacing(pacing: EncounterPacing): void {
    this.pacing = pacing;
  }

  /** Wave control: stop feeding the room so the current wave can be cleared. */
  setSpawningEnabled(on: boolean): void {
    this.spawnEnemies = on;
  }

  /** Enemy mix for the current wave (PRD 18: mixed-mechanic waves). */
  setMix(mix: { crawlerChance: number; bruteChance: number }): void {
    this.crawlerChance = mix.crawlerChance;
    this.bruteChance = mix.bruteChance;
  }

  setWaveNumber(wave: number): void {
    this.waveNo = wave;
  }

  get aliveCount(): number {
    return this.enemies.filter((e) => e.alive).length;
  }

  get healthValue(): number {
    return this.health;
  }

  /** Wave-clear breather. Health is earned back, never reset. */
  healBy(amount: number): void {
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  /** Intensity and motion, from the profile's settings. Applies immediately. */
  setEffects(effects: EffectSettings): void {
    this.effects = effects;
    const low = effects.intensity === 'low';
    // Low intensity: enemies read as dark silhouettes, no red glow, eyes out.
    applyCreatureIntensity(this.creatureMats, low);
    if (low) this.muzzle.intensity = 0;
  }

  /** Retry from checkpoint: fresh enemies, progress and score kept. */
  retry(): void {
    this.clearEnemies();
    this.attempts = new Map();
    this.pending = [];
    this.state = 'running';
    this.typing.setEnabled(true);
    this.spawn();
    this.spawn();
    this.engageNearest();
  }

  get currentState(): EncounterState {
    return this.state;
  }

  get progress(): EncounterProgress {
    return {
      correctChars: this.correctChars,
      presses: this.correctChars + this.missCount,
      activeMs: this.activeMs,
      tokensCompleted: this.tokensCompleted,
      // Counters, not a scan: this getter runs every frame for the HUD, and
      // filtering the sample array grows linearly through a lesson -- in the
      // exact path the burst test measures.
      accuracy:
        this.correctChars + this.missCount === 0
          ? 1
          : this.correctChars / (this.correctChars + this.missCount),
      wpm: this.activeMs > 0 ? this.correctChars / 5 / (this.activeMs / 60_000) : 0,
    };
  }

  /** The key with the worst accuracy this attempt, for the diagnosis line. */
  worstKey(): { key: string; accuracy: number } | null {
    let worst: { key: string; accuracy: number } | null = null;
    for (const [key, row] of this.attempts) {
      if (row.presses < 3) continue;
      const accuracy = (row.presses - row.errors) / row.presses;
      if (!worst || accuracy < worst.accuracy) worst = { key, accuracy };
    }
    return worst;
  }

  // ---------- robot burst ----------
  startBurst(wpm: number, chars: number): boolean {
    if (this.state !== 'running') return false;
    this.burstSent = '';
    this.burstObserved = '';
    this.robot.start({ wpm, chars, jitterPct: 12, errorRate: 0.04, seed: 20260821 });
    return true;
  }

  stopBurst(): void {
    if (this.robot.running) this.robot.stop();
  }

  get burstRunning(): boolean {
    return this.robot.running;
  }

  get burst(): { report: RobotReport; expected: string; observed: string } | null {
    return this.lastBurst;
  }

  private burstReportHtml(): string {
    if (!this.lastBurst) return '';
    const { report, expected, observed } = this.lastBurst;
    const verdict = judgeBurst(report, { expected, observed });
    return (
      `<h3>ROBOT BURST &mdash; ${report.wpm} WPM &times; ${report.sent} KEYS</h3>` +
      `<div class="verdict ${verdict.pass ? 'pass' : 'fail'}">` +
      `${verdict.pass ? 'PASS' : 'FAIL'} &mdash; the game kept up at ${report.achievedWpm.toFixed(0)} wpm</div>` +
      verdict.lines
        .map(
          (l) =>
            `<div class="line"><div class="head"><span>${l.label}</span>` +
            `<b><span class="mark ${l.pass ? 'ok' : 'bad'}">${l.pass ? '✓' : '✖'}</span> ${l.value}</b></div>` +
            `<div class="detail">${l.detail}</div></div>`,
        )
        .join('') +
      `<div class="foot">${report.injectedErrors} deliberate typos, ${report.starvedSlots} idle slots. ` +
      `Synthetic events: this proves the app keeps up, not that the OS never drops a key. F9 runs it again.</div>`
    );
  }

  // ---------- internals ----------
  private noteStruggle(key: string): void {
    if (this.struggleKey === key) this.struggleCount += 1;
    else {
      this.struggleKey = key;
      this.struggleCount = 1;
    }
    if (this.struggleCount >= HINT_AFTER_CONSECUTIVE_MISSES) {
      this.cb.onStruggle?.(key);
      this.resetStruggle();
    }
  }

  private resetStruggle(): void {
    this.struggleKey = null;
    this.struggleCount = 0;
  }

  /** Brief HUD emphasis on a combo tier-up. One class toggle, no layout work. */
  private pulseHud(): void {
    this.deps.hud.classList.remove('tierup');
    void this.deps.hud.offsetWidth; // restart the animation on rapid tier-ups
    this.deps.hud.classList.add('tierup');
  }

  private bump(key: string, correct: boolean): void {
    const row = this.attempts.get(key) ?? { errors: 0, presses: 0 };
    row.presses += 1;
    if (!correct) row.errors += 1;
    this.attempts.set(key, row);
  }

  /**
   * PRD 6: pick the next active target at a token boundary. Nearest remaining
   * enemy (no Screamers yet), engaged until ITS current token completes. If
   * nothing is alive, spawn immediately: the prompt must never sit empty.
   */
  private engageNearest(): void {
    let best: EnemyT | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!best || e.creature.root.position.z > best.creature.root.position.z) best = e;
    }
    if (!best) {
      this.spawn();
      best = this.enemies.find((e) => e.alive) ?? null;
      if (!best) {
        // Field empty and spawning paused (a wave boundary): nothing to type,
        // and the prompt must say so rather than pointing at a ghost.
        this.active = null;
        this.typing.setToken('');
        this.deps.prompt.render('', 0);
        this.deps.prompt.setUpcoming([]);
        return;
      }
    }

    // World highlight moves with the engagement, not per frame.
    if (this.active && this.active !== best && this.active.alive) {
      this.active.creature.setActive(false);
    }
    this.active = best;
    best.creature.setActive(true);

    this.tokenStartPresses = this.correctChars + this.missCount;
    this.tokenStartCorrect = this.correctChars;
    this.typing.setToken(best.tokens[0]);
    this.typing.markTokenShown(performance.now());
    this.redrawActive();
    this.redrawUpcoming();
  }

  private redrawActive(): void {
    this.deps.prompt.render(this.typing.currentToken, this.typing.typedCount);
  }

  /**
   * The look-ahead is the world: the rest of the active enemy's words, then
   * the other enemies' words in threat order -- and when the walking world
   * runs shorter than the player's look-ahead, the pending queue rolls the
   * NEXT arrivals early and shows their words. Either way, what is drawn as
   * coming is what actually arrives (Jeff's fix request 2026-08-26: the
   * queue must never sit empty while more enemies are on the way).
   */
  private upcomingTokens(count: number): string[] {
    if (count <= 0 || !this.active) return [];
    const out = [...this.active.tokens.slice(1)];
    const others = this.enemies
      .filter((e) => e.alive && e !== this.active)
      .sort((a, b) => b.creature.root.position.z - a.creature.root.position.z);
    for (const e of others) out.push(...e.tokens);
    if (out.length < count && this.spawnEnemies && this.provider) {
      this.ensurePending(count - out.length);
      for (const p of this.pending) out.push(...p.tokens);
    }
    return out.slice(0, count);
  }

  /** Pre-roll future spawns until they cover `tokensNeeded` more words. */
  private ensurePending(tokensNeeded: number): void {
    let have = this.pending.reduce((a, p) => a + p.tokens.length, 0);
    while (have < tokensNeeded && this.pending.length < MAX_RENDERED) {
      const kind = this.rollKind();
      const tokens = this.provider!.tokensFor(kind);
      this.pending.push({ kind, tokens });
      have += tokens.length;
    }
  }

  private redrawUpcoming(): void {
    this.deps.prompt.setUpcoming(this.upcomingTokens(this.deps.lookahead()));
  }

  /** Where a shot lands on this enemy: center mass in world space. */
  private aimPointOf(enemy: EnemyT): Vector3 {
    const p = enemy.creature.root.position;
    return new Vector3(p.x, AIM_Y[enemy.kind], p.z);
  }

  /**
   * One completed token = one shot. `kill` decides the sound of the hit;
   * `aimPoint` is where the tracer flies (none for a shot into an empty room).
   */
  private fireWeapon(kill: boolean, aimPoint?: Vector3): void {
    const audio = this.deps.audio;
    this.shotsFired += 1;
    if (this.weapon === 'revolver') {
      audio.revolverFire();
      if (kill) audio.impact();
      audio.cylinder();
      if (this.shotsFired % 6 === 0) audio.reloadSpin();
      this.cylinderMesh.rotation.y += Math.PI / 3;
      this.recoil = 0.7; // snappier, lighter than the pump
    } else {
      audio.fire();
      if (kill) audio.impact();
      audio.pump();
      audio.shell();
      this.recoil = 1;
      this.pumpAnim = 1;
    }
    // The muzzle flash is the one photosensitivity-relevant flash in combat:
    // low intensity suppresses the light, the card, and the tracer together.
    if (this.effects.intensity !== 'low') {
      this.muzzle.intensity = this.weapon === 'revolver' ? 1.6 : 2.2;
      this.flashT = FLASH_S;
      this.flashMesh.setEnabled(true);
      this.flashMesh.rotation.z = Math.random() * Math.PI;
      const flashSize = this.weapon === 'revolver' ? 0.8 : 1.1;
      this.flashMesh.scaling.set(flashSize, flashSize, flashSize);
      if (aimPoint) {
        this.tracerFrom.copyFrom(this.muzzle.getAbsolutePosition());
        this.tracerTo.copyFrom(aimPoint);
        const dir = this.tracerTo.subtract(this.tracerFrom);
        if (dir.lengthSquared() > 0.05) {
          this.tracerMesh.setEnabled(true);
          this.tracerMesh.position.copyFrom(this.tracerFrom);
          this.tracerMesh.setDirection(dir.normalize());
          this.tracerT = 0;
        }
      }
    }
  }

  private spawn(): void {
    if (!this.spawnEnemies || !this.provider) return;
    if (this.enemies.filter((e) => e.alive).length >= MAX_RENDERED) return;

    // The pending queue spawns in the order its words were shown; only when
    // it is empty is a fresh enemy rolled on the spot.
    const next = this.pending.shift() ?? { kind: this.rollKind(), tokens: null };
    const kind = next.kind;
    const creature = this.acquireCreature(kind);
    creature.root.position.set((Math.random() - 0.5) * 7, 0, -34 - Math.random() * 4);
    // Walk time comes from the pacing model; +/-10% so a group still shambles
    // rather than marching. Kind multipliers are what make a crawler a crawler.
    const speed =
      (MEAN_TRAVEL_UNITS / this.pacing.walkTimeS) * KIND_SPEED[kind] * (0.9 + Math.random() * 0.2);
    const tokens = next.tokens ?? this.provider.tokensFor(kind);
    this.enemies.push({ creature, speed, alive: true, kind, tokens, totalTokens: tokens.length });
    this.redrawUpcoming();
  }

  private rollKind(): EnemyKind {
    if (!this.variety) return 'standard';
    const r = Math.random();
    // At most one brute at a time -- walking OR already promised in pending.
    const bruteAlive =
      this.enemies.some((e) => e.alive && e.kind === 'brute') ||
      this.pending.some((p) => p.kind === 'brute');
    if (!bruteAlive && r < this.bruteChance) return 'brute';
    if (r < this.bruteChance + this.crawlerChance) return 'crawler';
    return 'standard';
  }

  private acquireCreature(kind: EnemyKind): Creature {
    const pooled = this.creaturePool[kind].pop();
    if (pooled) {
      pooled.reset();
      pooled.root.setEnabled(true);
      return pooled;
    }
    return buildCreature(this.scene, kind, this.creatureMats);
  }

  private releaseCreature(creature: Creature): void {
    creature.root.setEnabled(false);
    creature.setActive(false);
    this.creaturePool[creature.kind].push(creature);
  }

  private clearEnemies(): void {
    for (const e of this.enemies) if (e.alive) this.releaseCreature(e.creature);
    this.enemies.length = 0;
    this.active = null;
  }

  private die(reason?: string): void {
    this.state = 'dead';
    if (this.robot.running) this.robot.stop();
    this.typing.setEnabled(false);
    const worst = this.worstKey();
    this.cb.onDeath?.(
      reason ??
        (worst
          ? `${worst.key === ' ' ? 'SPACE' : worst.key.toUpperCase()} was ${Math.round(worst.accuracy * 100)}% this attempt.`
          : 'They were just too close. Try again.'),
    );
  }

  private frame(): void {
    // An occluded window renders no frames, and pause-on-blur never fires if
    // the window was never focused; the next frame then arrives with the whole
    // gap as its delta (observed: 62s) and teleports every enemy to the kill
    // line. Cap the step: a stall loses the stalled time, never the player.
    const dt = Math.min(this.engine3d.getDeltaTime() / 1000, 0.25);
    const now = performance.now();

    const motion = this.effects.motionReduction ? 0.25 : 1;
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 6);
      this.gunRoot.position.z = 1.2 - this.recoil * 0.18 * motion;
      this.gunRoot.rotation.x = -this.recoil * 0.12 * motion;
    }
    if (this.pumpAnim > 0) {
      this.pumpAnim = Math.max(0, this.pumpAnim - dt * 3);
      this.pumpGrip.position.z = 0.28 - Math.sin((1 - this.pumpAnim) * Math.PI) * 0.12 * motion;
    }
    if (this.muzzle.intensity > 0) this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 30);
    // Flash card: dies with its timer, shrinking as it goes.
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      if (this.flashT === 0) this.flashMesh.setEnabled(false);
      else {
        const s = (0.6 + (this.flashT / FLASH_S) * 0.5) * (this.weapon === 'revolver' ? 0.8 : 1.1);
        this.flashMesh.scaling.set(s, s, s);
      }
    }
    // Tracer: fly the muzzle-to-target line, then vanish at the hit.
    if (this.tracerT >= 0) {
      this.tracerT += dt / TRACER_S;
      if (this.tracerT >= 1) {
        this.tracerT = -1;
        this.tracerMesh.setEnabled(false);
      } else {
        Vector3.LerpToRef(this.tracerFrom, this.tracerTo, this.tracerT, this.tracerMesh.position);
      }
    }

    this.deps.prompt.tick(now);
    if (this.state !== 'running') return;
    // Same cap: a stalled frame must not count as a minute of typing time.
    this.activeMs += dt * 1000;

    if (this.spawnEnemies) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = this.pacing.spawnIntervalS * (0.8 + Math.random() * 0.4);
      }
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const pos = e.creature.root.position;
        pos.z += e.speed * dt;
        pos.x += Math.sin(now / 400 + pos.z) * 0.15 * dt * motion;
        e.creature.animate(dt, motion);
        if (pos.z >= KILL_LINE_Z) {
          this.die();
          return;
        }
      }
      // The engagement only changes at token boundaries (PRD 6), so if the
      // active enemy somehow died without completing (cleared externally),
      // recover here rather than leaving a prompt pointing at a ghost.
      if (!this.active || !this.active.alive) this.engageNearest();

      // Survival health: time under threat, scaled by how close the nearest
      // enemy is. An empty room costs nothing; a face full of machines does.
      if (this.mode === 'survival') {
        let nearest = -Infinity;
        for (const e of this.enemies)
          if (e.alive && e.creature.root.position.z > nearest) nearest = e.creature.root.position.z;
        if (nearest > -Infinity) {
          const closeness = (nearest + 38) / (38 + KILL_LINE_Z);
          this.health = Math.max(0, this.health - threatDrainPerS(closeness) * dt);
        }
        if (this.health <= 0) {
          this.die('You were overwhelmed. The room was never empty long enough.');
          return;
        }
        // The warning that builds (PRD 16): a low heartbeat, faster as it gets bad.
        if (this.health < HEARTBEAT_AT) {
          this.heartbeatIn -= dt;
          if (this.heartbeatIn <= 0) {
            this.deps.audio.heartbeat();
            this.heartbeatIn = this.health < HEARTBEAT_URGENT_AT ? 0.55 : 0.9;
          }
        }
      }
    }

    const p = this.progress;
    const combo = this.scorer.combo;
    const hp = Math.ceil(this.health);
    const line =
      (this.mode === 'survival'
        ? `<span class="${hp < HEARTBEAT_AT ? 'hplow' : 'hp'}">HP ${hp}</span> &nbsp; WAVE ${this.waveNo} &nbsp; `
        : '') +
      `WPM ${Math.round(p.wpm)} &nbsp; ACC ${Math.round(p.accuracy * 100)}% &nbsp; ` +
      `FPS ${Math.round(this.engine3d.getFps())}` +
      (this.showCombo
        ? ` &nbsp; SCORE ${this.scorer.runningTotal.toLocaleString()}` +
          (combo.multiplier > 1 ? ` &nbsp; <span class="combo">x${combo.multiplier}</span>` : '')
        : '') +
      (this.robot.running ? ` &nbsp; <span style="color:#e8b04a">ROBOT ${this.robot.config.wpm}</span>` : '');
    // Only touch the DOM when the text changes: a per-frame innerHTML write
    // would land in the very burst numbers the robot is measuring.
    if (line !== this.hudLine) {
      this.hudLine = line;
      this.deps.hud.innerHTML = line;
    }
  }
}
