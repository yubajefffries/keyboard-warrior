/**
 * Creature viewer: the three enemy kinds side by side, close up, under the
 * game's lighting mood, walking in place. Exists so the models can be art-
 * tuned without grinding a lesson to Stage 3 -- and it renders synchronously
 * on load, so it shows a correct frame even in a throttled background tab.
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
import {
  applyCreatureIntensity,
  buildCreature,
  makeCreatureMaterialSet,
  type Creature,
} from '../game/creatures';
import type { EnemyKind } from '../game/scoring';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.015, 0.025, 0.022, 1);

// The game's lighting mood: cold ambient plus one lamp (encounter.ts values).
const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
ambient.intensity = 0.32;
ambient.diffuse = new Color3(0.45, 0.58, 0.55);
ambient.groundColor = new Color3(0.08, 0.1, 0.09);
const lamp = new PointLight('lamp', new Vector3(0, 3.6, -1), scene);
lamp.intensity = 0.65;
lamp.diffuse = new Color3(0.75, 0.9, 0.8);

const camera = new FreeCamera('cam', new Vector3(0, 1.7, 3.8), scene);
camera.setTarget(new Vector3(0, 1.2, -2));
camera.inputs.clear();

const ground = MeshBuilder.CreateGround('ground', { width: 14, height: 14 }, scene);
const groundMat = new StandardMaterial('groundMat', scene);
groundMat.diffuseColor = new Color3(0.13, 0.15, 0.14);
groundMat.specularColor = Color3.Black();
ground.material = groundMat;

// The encounter's material set, verbatim, so what is tuned here is what ships.
const mats = makeCreatureMaterialSet(scene);

const KINDS: EnemyKind[] = ['standard', 'crawler', 'brute'];
const X: Record<EnemyKind, number> = { standard: -1.6, crawler: 0, brute: 1.7 };
const creatures: Creature[] = KINDS.map((kind) => {
  const c = buildCreature(scene, kind, mats);
  c.root.position.set(X[kind], 0, -1.6);
  return c;
});

const checkbox = (id: string) => document.getElementById(id) as HTMLInputElement;
const applyToggles = () => {
  applyCreatureIntensity(mats, checkbox('low').checked);
  for (const c of creatures) c.setActive(checkbox('active').checked);
};
for (const id of ['active', 'low', 'reduce', 'walk']) {
  checkbox(id).addEventListener('change', () => {
    applyToggles();
    step(1 / 60);
  });
}

function step(dt: number): void {
  const motion = checkbox('reduce').checked ? 0.25 : 1;
  if (checkbox('walk').checked) for (const c of creatures) c.animate(dt, motion);
  scene.render();
}

// Settle into a mid-stride pose and paint immediately, no rAF required.
applyToggles();
for (let i = 0; i < 30; i++) step(1 / 60);

engine.runRenderLoop(() => step(Math.min(engine.getDeltaTime() / 1000, 0.25)));
window.addEventListener('resize', () => engine.resize());
