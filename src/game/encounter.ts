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
import { StatsTracker } from '../stats/keystats';
import { TokenQueue, type TokenSource } from '../content/sequences';
import type { WeaponAudio } from '../audio/sfx';
import type { PromptView } from '../ui/prompt';
import type { KeyboardViz } from '../ui/keyboard';
import { RobotTypist, judgeBurst, type RobotReport } from '../dev/robot';

export type EncounterState = 'idle' | 'running' | 'paused' | 'dead';

export interface EncounterDeps {
  canvas: HTMLCanvasElement;
  prompt: PromptView;
  hud: HTMLElement;
  keyboard: KeyboardViz | null;
  audio: WeaponAudio;
  pipeline: InputPipeline;
  /** Read fresh every token so a settings change applies immediately. */
  lookahead: () => number;
}

/** Consecutive misses on one key before the finger hint offers itself. PRD 10. */
export const HINT_AFTER_CONSECUTIVE_MISSES = 3;

export interface EncounterCallbacks {
  onDeath?: (diagnosis: string) => void;
  /**
   * The same key has been missed several times running. The app decides
   * whether to surface a finger hint, since only it knows whether the
   * keyboard is currently on screen.
   */
  onStruggle?: (key: string) => void;
  onTokenComplete?: (token: string, completed: number) => void;
  onPause?: (reason: string) => void;
  onBurstReport?: (html: string, report: RobotReport) => void;
}

export interface EncounterProgress {
  correctChars: number;
  activeMs: number;
  tokensCompleted: number;
  accuracy: number;
  wpm: number;
}

const MAX_RENDERED = 5;
const KILL_LINE_Z = -1.6;

export class Encounter {
  private deps: EncounterDeps;
  private cb: EncounterCallbacks = {};

  private engine3d: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private gunRoot: TransformNode;
  private pumpGrip: Mesh;
  private muzzle: PointLight;
  private enemyMat: StandardMaterial;
  private activeMat: StandardMaterial;

  private enemies: { mesh: Mesh; speed: number; alive: boolean }[] = [];
  private recoil = 0;
  private pumpAnim = 0;
  private spawnTimer = 0;
  private hudLine = '';

  /** Fresh per lesson: a lesson is scored on its own samples. */
  private tracker = new StatsTracker();
  private state: EncounterState = 'idle';
  private pausedFrom: EncounterState = 'running';
  private queue: TokenQueue | null = null;
  private typing: TypingEngine;
  private completed: string[] = [];
  private tokensCompleted = 0;
  private correctChars = 0;
  private activeMs = 0;
  private attempts = new Map<string, { errors: number; presses: number }>();
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
    this.scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);

    this.camera = new FreeCamera('cam', new Vector3(0, 1.7, 0), this.scene);
    this.camera.setTarget(new Vector3(0, 1.5, -10));
    this.camera.inputs.clear(); // rail shooter: hands never leave typing position

    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.25;
    ambient.diffuse = new Color3(0.5, 0.55, 0.65);
    const lamp = new PointLight('lamp', new Vector3(0, 3.4, -8), this.scene);
    lamp.intensity = 0.7;
    lamp.diffuse = new Color3(1.0, 0.85, 0.7);

    const gray = new StandardMaterial('gray', this.scene);
    gray.diffuseColor = new Color3(0.22, 0.22, 0.25);
    gray.specularColor = Color3.Black();

    const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 44 }, this.scene);
    ground.position.z = -18;
    ground.material = gray;
    for (const side of [-1, 1]) {
      const wall = MeshBuilder.CreateBox('wall', { width: 0.4, height: 5, depth: 44 }, this.scene);
      wall.position.set(side * 6, 2.5, -18);
      wall.material = gray;
    }
    const backWall = MeshBuilder.CreateBox('back', { width: 12, height: 5, depth: 0.4 }, this.scene);
    backWall.position.set(0, 2.5, -40);
    backWall.material = gray;

    // Recoil moves the GUN, never the prompt.
    this.gunRoot = new TransformNode('gunRoot', this.scene);
    this.gunRoot.parent = this.camera;
    this.gunRoot.position.set(0.45, -0.42, 1.2);
    const gunMat = new StandardMaterial('gunMat', this.scene);
    gunMat.diffuseColor = new Color3(0.12, 0.12, 0.13);
    gunMat.specularColor = new Color3(0.3, 0.3, 0.3);
    const barrel = MeshBuilder.CreateCylinder('barrel', { diameter: 0.07, height: 0.9 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.35;
    barrel.parent = this.gunRoot;
    barrel.material = gunMat;
    const receiver = MeshBuilder.CreateBox('receiver', { width: 0.09, height: 0.14, depth: 0.5 }, this.scene);
    receiver.position.z = -0.1;
    receiver.parent = this.gunRoot;
    receiver.material = gunMat;
    this.pumpGrip = MeshBuilder.CreateBox('pump', { width: 0.1, height: 0.09, depth: 0.22 }, this.scene);
    this.pumpGrip.position.set(0, -0.09, 0.28);
    this.pumpGrip.parent = this.gunRoot;
    this.pumpGrip.material = gunMat;

    this.muzzle = new PointLight('muzzle', new Vector3(0, 0, 0.9), this.scene);
    this.muzzle.parent = this.gunRoot;
    this.muzzle.diffuse = new Color3(1, 0.7, 0.3);
    this.muzzle.intensity = 0;

    this.enemyMat = new StandardMaterial('enemyMat', this.scene);
    this.enemyMat.diffuseColor = new Color3(0.45, 0.28, 0.28);
    this.enemyMat.specularColor = Color3.Black();
    this.activeMat = new StandardMaterial('activeMat', this.scene);
    this.activeMat.diffuseColor = new Color3(0.55, 0.3, 0.3);
    this.activeMat.emissiveColor = new Color3(0.45, 0.08, 0.08);
    this.activeMat.specularColor = Color3.Black();

    this.typing = new TypingEngine(this.tracker, {
      onPress: (pressed) => {
        if (this.robot.running) this.burstObserved += pressed;
      },
      onHit: (char) => {
        deps.audio.tick();
        this.bump(char, true);
        this.correctChars += 1;
        this.deps.keyboard?.flash(char, 'hit');
        // A clean press clears the struggle: the hint is for a key that is
        // genuinely lost, not for one fumbled once.
        if (this.struggleKey === char) this.resetStruggle();
        this.redrawActive();
      },
      onMiss: (expected, pressed) => {
        deps.audio.dryFire();
        this.bump(expected, false);
        this.deps.prompt.flashError(performance.now());
        this.deps.keyboard?.flash(pressed, 'miss');
        this.noteStruggle(expected);
        this.redrawActive();
      },
      onComplete: (token) => {
        this.correctChars += 1;
        this.bump(token[token.length - 1], true);
        this.completed.unshift(token);
        if (this.completed.length > 4) this.completed.pop();
        this.tokensCompleted += 1;
        this.fire();
        this.nextToken();
        this.cb.onTokenComplete?.(token, this.tokensCompleted);
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

  start(source: TokenSource, opts: { spawnEnemies?: boolean } = {}): void {
    this.spawnEnemies = opts.spawnEnemies ?? true;
    this.tracker = new StatsTracker();
    this.typing.setStats(this.tracker);
    this.clearEnemies();
    this.queue = new TokenQueue(source, 4);
    this.completed = [];
    this.attempts = new Map();
    this.tokensCompleted = 0;
    this.correctChars = 0;
    this.activeMs = 0;
    this.spawnTimer = 0;
    this.resetStruggle();
    this.state = 'running';
    this.typing.setEnabled(true);
    if (this.spawnEnemies) {
      this.spawn();
      this.spawn();
    }
    this.setToken(this.queue.current);
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

  /** Retry from checkpoint: same lesson, fresh enemies, keep the token stream. */
  retry(): void {
    this.clearEnemies();
    this.attempts = new Map();
    this.completed = [];
    this.state = 'running';
    this.typing.setEnabled(true);
    if (this.spawnEnemies) {
      this.spawn();
      this.spawn();
    }
    this.redrawQueue();
  }

  get currentState(): EncounterState {
    return this.state;
  }

  get progress(): EncounterProgress {
    return {
      correctChars: this.correctChars,
      activeMs: this.activeMs,
      tokensCompleted: this.tokensCompleted,
      accuracy: this.tracker.totalAccuracy('combat'),
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

  private bump(key: string, correct: boolean): void {
    const row = this.attempts.get(key) ?? { errors: 0, presses: 0 };
    row.presses += 1;
    if (!correct) row.errors += 1;
    this.attempts.set(key, row);
  }

  private setToken(token: string): void {
    this.typing.setToken(token);
    this.typing.markTokenShown(performance.now());
    this.redrawActive();
    this.redrawQueue();
  }

  private nextToken(): void {
    if (!this.queue) return;
    this.queue.advance();
    this.setToken(this.queue.current);
  }

  private redrawActive(): void {
    this.deps.prompt.render(this.typing.currentToken, this.typing.typedCount);
    const token = this.typing.currentToken;
    this.deps.keyboard?.setTarget(
      token[this.typing.typedCount] ?? null,
      token[this.typing.typedCount + 1] ?? this.queue?.upcoming(1)[0]?.[0] ?? null,
    );
  }

  private redrawQueue(): void {
    if (!this.queue) return;
    this.deps.prompt.setUpcoming(this.queue.upcoming(this.deps.lookahead()));
    this.deps.prompt.setCompleted(this.completed);
  }

  private fire(): void {
    const audio = this.deps.audio;
    audio.fire();
    audio.impact();
    audio.pump();
    audio.shell();
    this.recoil = 1;
    this.pumpAnim = 1;
    this.muzzle.intensity = 2.2;
    const target = this.activeEnemy();
    if (target) {
      target.alive = false;
      target.mesh.dispose();
    }
  }

  private spawn(): void {
    if (this.enemies.filter((e) => e.alive).length >= MAX_RENDERED) return;
    const mesh = MeshBuilder.CreateCapsule('enemy', { height: 1.8, radius: 0.35 }, this.scene);
    mesh.position.set((Math.random() - 0.5) * 7, 0.9, -34 - Math.random() * 4);
    mesh.material = this.enemyMat;
    this.enemies.push({ mesh, speed: 0.55 + Math.random() * 0.2, alive: true });
  }

  private clearEnemies(): void {
    for (const e of this.enemies) if (e.alive) e.mesh.dispose();
    this.enemies.length = 0;
  }

  private activeEnemy(): { mesh: Mesh; speed: number; alive: boolean } | null {
    let best: { mesh: Mesh; speed: number; alive: boolean } | null = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!best || e.mesh.position.z > best.mesh.position.z) best = e;
    }
    return best;
  }

  private die(): void {
    this.state = 'dead';
    if (this.robot.running) this.robot.stop();
    this.typing.setEnabled(false);
    const worst = this.worstKey();
    this.cb.onDeath?.(
      worst
        ? `${worst.key.toUpperCase()} was ${Math.round(worst.accuracy * 100)}% this attempt.`
        : 'They were just too close. Try again.',
    );
  }

  private frame(): void {
    const dt = this.engine3d.getDeltaTime() / 1000;
    const now = performance.now();

    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 6);
      this.gunRoot.position.z = 1.2 - this.recoil * 0.18;
      this.gunRoot.rotation.x = -this.recoil * 0.12;
    }
    if (this.pumpAnim > 0) {
      this.pumpAnim = Math.max(0, this.pumpAnim - dt * 3);
      this.pumpGrip.position.z = 0.28 - Math.sin((1 - this.pumpAnim) * Math.PI) * 0.12;
    }
    if (this.muzzle.intensity > 0) this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 30);

    this.deps.prompt.tick(now);
    if (this.state !== 'running') return;
    this.activeMs += this.engine3d.getDeltaTime();

    if (this.spawnEnemies) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = 4 + Math.random() * 3;
      }
      const active = this.activeEnemy();
      for (const e of this.enemies) {
        if (!e.alive) continue;
        e.mesh.position.z += e.speed * dt;
        e.mesh.position.x += Math.sin(now / 400 + e.mesh.position.z) * 0.15 * dt;
        e.mesh.material = e === active ? this.activeMat : this.enemyMat;
        if (e.mesh.position.z >= KILL_LINE_Z) {
          this.die();
          return;
        }
      }
    }

    const p = this.progress;
    const line =
      `WPM ${Math.round(p.wpm)} &nbsp; ACC ${Math.round(p.accuracy * 100)}% &nbsp; ` +
      `FPS ${Math.round(this.engine3d.getFps())}` +
      (this.robot.running ? ` &nbsp; <span style="color:#e8b04a">ROBOT ${this.robot.config.wpm}</span>` : '');
    // Only touch the DOM when the text changes: a per-frame innerHTML write
    // would land in the very burst numbers the robot is measuring.
    if (line !== this.hudLine) {
      this.hudLine = line;
      this.deps.hud.innerHTML = line;
    }
  }
}
