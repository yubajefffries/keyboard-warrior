/**
 * Phase 0 vertical slice. Gray-box room, capsule enemies, screen-space
 * prompt, one weapon (pump shotgun), miss-and-retry, pause on blur.
 * Ugly on purpose; feel is not. PRD Section 3, Phase 0.
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

import { InputPipeline } from '../input/pipeline';
import { TypingEngine } from './engine';
import { StatsTracker } from '../stats/keystats';
import { HomeRowSource } from '../content/sequences';
import { WeaponAudio } from '../audio/sfx';

// ---------- DOM ----------
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const promptEl = document.getElementById('prompt')!;
const hudEl = document.getElementById('hud')!;
const warningsEl = document.getElementById('warnings')!;
const startOverlay = document.getElementById('startOverlay')!;
const pauseOverlay = document.getElementById('pauseOverlay')!;
const pauseReason = document.getElementById('pauseReason')!;
const deathOverlay = document.getElementById('deathOverlay')!;
const diagnosisEl = document.getElementById('diagnosis')!;

// ---------- Babylon scene (gray-box) ----------
const engine3d = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
const scene = new Scene(engine3d);
scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);

const camera = new FreeCamera('cam', new Vector3(0, 1.7, 0), scene);
camera.setTarget(new Vector3(0, 1.5, -10));
camera.inputs.clear(); // rail shooter: no WASD/mouse-look during typing combat

const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
ambient.intensity = 0.25;
ambient.diffuse = new Color3(0.5, 0.55, 0.65);
const lamp = new PointLight('lamp', new Vector3(0, 3.4, -8), scene);
lamp.intensity = 0.7;
lamp.diffuse = new Color3(1.0, 0.85, 0.7);

const gray = new StandardMaterial('gray', scene);
gray.diffuseColor = new Color3(0.22, 0.22, 0.25);
gray.specularColor = Color3.Black();

const ground = MeshBuilder.CreateGround('ground', { width: 12, height: 44 }, scene);
ground.position.z = -18;
ground.material = gray;
for (const side of [-1, 1]) {
  const wall = MeshBuilder.CreateBox('wall', { width: 0.4, height: 5, depth: 44 }, scene);
  wall.position.set(side * 6, 2.5, -18);
  wall.material = gray;
}
const backWall = MeshBuilder.CreateBox('back', { width: 12, height: 5, depth: 0.4 }, scene);
backWall.position.set(0, 2.5, -40);
backWall.material = gray;

// Shotgun: crude boxes parented to the camera. Recoil moves the GUN, never the prompt.
const gunRoot = new TransformNode('gunRoot', scene);
gunRoot.parent = camera;
gunRoot.position.set(0.45, -0.42, 1.2);
const gunMat = new StandardMaterial('gunMat', scene);
gunMat.diffuseColor = new Color3(0.12, 0.12, 0.13);
gunMat.specularColor = new Color3(0.3, 0.3, 0.3);
const barrel = MeshBuilder.CreateCylinder('barrel', { diameter: 0.07, height: 0.9 }, scene);
barrel.rotation.x = Math.PI / 2;
barrel.position.z = 0.35;
barrel.parent = gunRoot;
barrel.material = gunMat;
const receiver = MeshBuilder.CreateBox('receiver', { width: 0.09, height: 0.14, depth: 0.5 }, scene);
receiver.position.z = -0.1;
receiver.parent = gunRoot;
receiver.material = gunMat;
const pumpGrip = MeshBuilder.CreateBox('pump', { width: 0.1, height: 0.09, depth: 0.22 }, scene);
pumpGrip.position.set(0, -0.09, 0.28);
pumpGrip.parent = gunRoot;
pumpGrip.material = gunMat;

let recoil = 0; // 1 at fire, springs back to 0
let pumpAnim = 0;

// Muzzle flash light (2nd dynamic light stays within budget: ambient is hemispheric)
const muzzle = new PointLight('muzzle', new Vector3(0, 0, 0.9), scene);
muzzle.parent = gunRoot;
muzzle.diffuse = new Color3(1, 0.7, 0.3);
muzzle.intensity = 0;

// ---------- Enemies ----------
interface Enemy {
  mesh: Mesh;
  speed: number;
  alive: boolean;
}
const enemyMat = new StandardMaterial('enemyMat', scene);
enemyMat.diffuseColor = new Color3(0.45, 0.28, 0.28);
enemyMat.specularColor = Color3.Black();
const activeMat = new StandardMaterial('activeMat', scene);
activeMat.diffuseColor = new Color3(0.55, 0.3, 0.3);
activeMat.emissiveColor = new Color3(0.45, 0.08, 0.08);
activeMat.specularColor = Color3.Black();

const enemies: Enemy[] = [];
const MAX_RENDERED = 5;
const KILL_LINE_Z = -1.6;

function spawnEnemy(): void {
  if (enemies.filter((e) => e.alive).length >= MAX_RENDERED) return;
  const mesh = MeshBuilder.CreateCapsule('enemy', { height: 1.8, radius: 0.35 }, scene);
  mesh.position.set((Math.random() - 0.5) * 7, 0.9, -34 - Math.random() * 4);
  mesh.material = enemyMat;
  enemies.push({ mesh, speed: 0.55 + Math.random() * 0.2, alive: true });
}

function activeEnemy(): Enemy | null {
  // Nearest remaining enemy (Phase 0 has no Screamers/deadline threats yet).
  let best: Enemy | null = null;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (!best || e.mesh.position.z > best.mesh.position.z) best = e;
  }
  return best;
}

// ---------- Game state ----------
type GameState = 'start' | 'running' | 'paused' | 'dead';
let state: GameState = 'start';
let pausedFrom: GameState = 'running';

const stats = new StatsTracker();
const audio = new WeaponAudio();
const source = new HomeRowSource(Date.now() & 0xffffffff);
const pipeline = new InputPipeline();

let correctChars = 0;
let activeMs = 0; // running time excluding pauses, for WPM
let attemptErrors = new Map<string, { errors: number; presses: number }>();
let errorFlashUntil = 0;

const typing = new TypingEngine(stats, {
  onHit: (char) => {
    audio.tick();
    bumpAttempt(char, true);
    renderPrompt();
    correctChars += 1;
  },
  onMiss: (expected) => {
    audio.dryFire();
    errorFlashUntil = performance.now() + 220;
    promptEl.classList.add('error');
    bumpAttempt(expected, false);
    renderPrompt();
  },
  onComplete: (token) => {
    correctChars += 1;
    bumpAttempt(token[token.length - 1], true);
    fireShotgun();
    nextToken();
  },
});

function bumpAttempt(key: string, correct: boolean): void {
  const row = attemptErrors.get(key) ?? { errors: 0, presses: 0 };
  row.presses += 1;
  if (!correct) row.errors += 1;
  attemptErrors.set(key, row);
}

pipeline.subscribe((record) => {
  if (state === 'paused' && record.type === 'down' && record.key === ' ') {
    resume();
    return;
  }
  if (state !== 'running') return;
  typing.handle(record);
});

pipeline.onWarnings((w) => {
  const msgs: string[] = [];
  if (w.capsLockOn) msgs.push('CAPS LOCK is on');
  if (w.stuckShift) msgs.push('Shift looks stuck down');
  warningsEl.textContent = msgs.join(' | ');
  warningsEl.style.display = msgs.length ? 'block' : 'none';
});

function nextToken(): void {
  typing.setToken(source.next());
  typing.markTokenShown(performance.now());
  renderPrompt();
}

function renderPrompt(): void {
  const token = typing.currentToken;
  const done = token.slice(0, typing.typedCount);
  const current = token[typing.typedCount] ?? '';
  const rest = token.slice(typing.typedCount + 1);
  promptEl.innerHTML =
    `<span class="done">${escapeHtml(done)}</span>` +
    `<span class="current">${escapeHtml(current)}</span>` +
    `<span>${escapeHtml(rest)}</span>` +
    `<span class="errIcon">&#10006;</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fireShotgun(): void {
  audio.fire();
  audio.impact();
  audio.pump();
  audio.shell();
  recoil = 1;
  pumpAnim = 1;
  muzzle.intensity = 2.2;
  const target = activeEnemy();
  if (target) {
    target.alive = false;
    target.mesh.dispose();
  }
}

// ---------- Overlays / state transitions ----------
function pause(reason: string): void {
  if (state !== 'running') return;
  pausedFrom = state;
  state = 'paused';
  typing.setEnabled(false);
  pauseReason.textContent = reason;
  pauseOverlay.style.display = 'flex';
}

function resume(): void {
  if (state !== 'paused') return;
  state = pausedFrom;
  typing.setEnabled(true);
  pauseOverlay.style.display = 'none';
}

function die(): void {
  state = 'dead';
  typing.setEnabled(false);
  let worst: { key: string; acc: number; presses: number } | null = null;
  for (const [key, row] of attemptErrors) {
    if (row.presses < 3) continue;
    const acc = (row.presses - row.errors) / row.presses;
    if (!worst || acc < worst.acc) worst = { key, acc, presses: row.presses };
  }
  diagnosisEl.textContent = worst
    ? `${worst.key.toUpperCase()} was ${Math.round(worst.acc * 100)}% this attempt.`
    : 'They were just too close. Try again.';
  deathOverlay.style.display = 'flex';
}

function resetEncounter(): void {
  for (const e of enemies) if (e.alive) e.mesh.dispose();
  enemies.length = 0;
  attemptErrors = new Map();
  spawnEnemy();
  spawnEnemy();
  nextToken();
}

document.getElementById('startBtn')!.addEventListener('click', () => {
  audio.ensureStarted();
  startOverlay.style.display = 'none';
  state = 'running';
  typing.setEnabled(true);
  resetEncounter();
});
document.getElementById('resumeBtn')!.addEventListener('click', () => {
  audio.ensureStarted();
  resume();
});
document.getElementById('retryBtn')!.addEventListener('click', () => {
  deathOverlay.style.display = 'none';
  state = 'running';
  typing.setEnabled(true);
  resetEncounter();
});
document.getElementById('exportBtn')!.addEventListener('click', () => {
  const blob = new Blob([stats.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'keyboard-warrior-stats.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// Pause on blur (PRD: force pause on blur, resume is explicit).
window.addEventListener('blur', () => pause('Window lost focus.'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause('Tab hidden.');
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) pause('Left fullscreen.');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state === 'running') pause('Paused.');
});

pipeline.attach(window);

// ---------- Per-frame ----------
let spawnTimer = 0;
scene.onBeforeRenderObservable.add(() => {
  const dt = engine3d.getDeltaTime() / 1000;

  // Gun spring-back; prompt is DOM and never moves.
  if (recoil > 0) {
    recoil = Math.max(0, recoil - dt * 6);
    gunRoot.position.z = 1.2 - recoil * 0.18;
    gunRoot.rotation.x = -recoil * 0.12;
  }
  if (pumpAnim > 0) {
    pumpAnim = Math.max(0, pumpAnim - dt * 3);
    const phase = Math.sin((1 - pumpAnim) * Math.PI);
    pumpGrip.position.z = 0.28 - phase * 0.12;
  }
  if (muzzle.intensity > 0) muzzle.intensity = Math.max(0, muzzle.intensity - dt * 30);

  if (state !== 'running') return;
  activeMs += engine3d.getDeltaTime();

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnEnemy();
    spawnTimer = 4 + Math.random() * 3;
  }

  const active = activeEnemy();
  for (const e of enemies) {
    if (!e.alive) continue;
    e.mesh.position.z += e.speed * dt;
    // Shamble: slight sway so capsules read as alive.
    e.mesh.position.x += Math.sin(performance.now() / 400 + e.mesh.position.z) * 0.15 * dt;
    e.mesh.material = e === active ? activeMat : enemyMat;
    if (e.mesh.position.z >= KILL_LINE_Z) {
      die();
      break;
    }
  }

  if (performance.now() > errorFlashUntil) promptEl.classList.remove('error');

  const acc = Math.round(stats.totalAccuracy('combat') * 100);
  const wpm = Math.round(StatsTracker.wpm(correctChars, activeMs));
  hudEl.innerHTML = `WPM ${wpm} &nbsp; ACC ${acc}% &nbsp; FPS ${Math.round(engine3d.getFps())}`;
});

engine3d.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine3d.resize());
