/**
 * The abandoned laboratory. PRD Sections 7, 8 (Phase 1b environment pass).
 *
 * Every rule here comes from the performance budget: quality from lighting
 * mood, atmosphere, and fog, never from asset density. The whole set is
 * procedural Babylon primitives with StandardMaterials -- no textures, no
 * fetched assets, so the repo stays fully redistributable -- and the light
 * count stays at what the gray-box already used: one hemispheric ambient,
 * one point lamp, plus the muzzle flash. The "lighting" the room appears to
 * have comes from emissive materials, which cost nothing.
 *
 * Everything built here is static: world matrices and materials are frozen
 * after placement so the per-frame cost of the dressing is as close to zero
 * as Babylon allows. Props keep out of the enemy lane (|x| < 3.5) so the
 * capsules never clip through a bench.
 *
 * No flicker anywhere, deliberately: PRD 22 photosensitivity. The lab is
 * unsettling because it is dim and green, not because it strobes.
 */

import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

function mat(scene: Scene, name: string, diffuse: Color3, emissive?: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = diffuse;
  m.specularColor = Color3.Black();
  if (emissive) m.emissiveColor = emissive;
  m.freeze();
  return m;
}

function freeze(mesh: Mesh): Mesh {
  mesh.freezeWorldMatrix();
  mesh.isPickable = false;
  return mesh;
}

export function buildLaboratory(scene: Scene): void {
  // ---------- Palette: cold, dim, institutional ----------
  const floorMat = mat(scene, 'lab.floor', new Color3(0.13, 0.15, 0.14));
  const wallMat = mat(scene, 'lab.wall', new Color3(0.16, 0.19, 0.18));
  const panelMat = mat(scene, 'lab.panel', new Color3(0.11, 0.13, 0.13));
  const trimMat = mat(scene, 'lab.trim', new Color3(0.25, 0.22, 0.16)); // old brass/rust
  const darkMat = mat(scene, 'lab.dark', new Color3(0.07, 0.08, 0.08));
  const benchMat = mat(scene, 'lab.bench', new Color3(0.2, 0.22, 0.23));
  const barrelMat = mat(scene, 'lab.barrel', new Color3(0.2, 0.16, 0.1));
  // Emissives read as light sources without costing a light.
  const stripMat = mat(scene, 'lab.strip', new Color3(0.1, 0.12, 0.11), new Color3(0.35, 0.5, 0.42));
  const deadStripMat = mat(scene, 'lab.deadstrip', new Color3(0.09, 0.1, 0.1), new Color3(0.04, 0.05, 0.045));
  const screenMat = mat(scene, 'lab.screen', new Color3(0.05, 0.08, 0.06), new Color3(0.05, 0.16, 0.08));
  const doorMat = mat(scene, 'lab.door', new Color3(0.03, 0.035, 0.035));

  // ---------- Shell: floor, walls, ceiling ----------
  const ground = MeshBuilder.CreateGround('lab.ground', { width: 12, height: 44 }, scene);
  ground.position.z = -18;
  ground.material = floorMat;
  freeze(ground);

  for (const side of [-1, 1]) {
    const wall = MeshBuilder.CreateBox('lab.sidewall', { width: 0.4, height: 5, depth: 44 }, scene);
    wall.position.set(side * 6, 2.5, -18);
    wall.material = wallMat;
    freeze(wall);
    // Recessed panel rhythm down the corridor, so the walls read as a place
    // rather than a plane.
    for (let i = 0; i < 6; i++) {
      const panel = MeshBuilder.CreateBox('lab.panel', { width: 0.12, height: 2.6, depth: 3.2 }, scene);
      panel.position.set(side * 5.75, 1.9, -4 - i * 6.4);
      panel.material = panelMat;
      freeze(panel);
    }
    // A pipe run along each wall, sagging height between brackets skipped:
    // one straight cylinder reads fine at this poly budget.
    const pipe = MeshBuilder.CreateCylinder('lab.pipe', { diameter: 0.16, height: 42, tessellation: 8 }, scene);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 5.6, 3.9, -18);
    pipe.material = trimMat;
    freeze(pipe);
  }

  const ceiling = MeshBuilder.CreateBox('lab.ceiling', { width: 12, height: 0.3, depth: 44 }, scene);
  ceiling.position.set(0, 5.1, -18);
  ceiling.material = darkMat;
  freeze(ceiling);

  // ---------- The far end: the doorway they come out of ----------
  const backWall = MeshBuilder.CreateBox('lab.back', { width: 12, height: 5, depth: 0.4 }, scene);
  backWall.position.set(0, 2.5, -40);
  backWall.material = wallMat;
  freeze(backWall);
  // A black opening with a trim frame: enemies emerge from somewhere, not
  // from a wall. Sits just proud of the back wall.
  const doorway = MeshBuilder.CreateBox('lab.doorway', { width: 4.2, height: 3.6, depth: 0.1 }, scene);
  doorway.position.set(0, 1.8, -39.7);
  doorway.material = doorMat;
  freeze(doorway);
  for (const side of [-1, 1]) {
    const jamb = MeshBuilder.CreateBox('lab.jamb', { width: 0.25, height: 3.8, depth: 0.3 }, scene);
    jamb.position.set(side * 2.2, 1.9, -39.6);
    jamb.material = trimMat;
    freeze(jamb);
  }
  const lintel = MeshBuilder.CreateBox('lab.lintel', { width: 4.7, height: 0.25, depth: 0.3 }, scene);
  lintel.position.set(0, 3.85, -39.6);
  lintel.material = trimMat;
  freeze(lintel);

  // ---------- Ceiling light strips: most alive, some dead ----------
  // Static emissives, no flicker (PRD 22). The dead ones are what say
  // "abandoned"; the live ones keep the lane readable.
  const strips: { z: number; dead: boolean }[] = [
    { z: -6, dead: false },
    { z: -14, dead: true },
    { z: -22, dead: false },
    { z: -30, dead: true },
    { z: -37, dead: false },
  ];
  for (const s of strips) {
    const strip = MeshBuilder.CreateBox('lab.strip', { width: 3.4, height: 0.08, depth: 0.5 }, scene);
    strip.position.set(0, 4.92, s.z);
    strip.material = s.dead ? deadStripMat : stripMat;
    freeze(strip);
  }

  // ---------- Props: benches, barrels, a dead terminal ----------
  // All outside the enemy lane. Boxes and cylinders only.
  const benchAt = (x: number, z: number, rot: number): void => {
    const top = MeshBuilder.CreateBox('lab.benchtop', { width: 2.2, height: 0.1, depth: 0.8 }, scene);
    top.position.set(x, 0.95, z);
    top.rotation.y = rot;
    top.material = benchMat;
    freeze(top);
    const base = MeshBuilder.CreateBox('lab.benchbase', { width: 2.0, height: 0.9, depth: 0.7 }, scene);
    base.position.set(x, 0.45, z);
    base.rotation.y = rot;
    base.material = darkMat;
    freeze(base);
  };
  benchAt(-4.6, -9, 0.12);
  benchAt(4.7, -16, -0.08);
  benchAt(-4.5, -26, -0.15);

  const barrelAt = (x: number, z: number, h = 1.0): void => {
    const barrel = MeshBuilder.CreateCylinder('lab.barrel', { diameter: 0.7, height: h, tessellation: 10 }, scene);
    barrel.position.set(x, h / 2, z);
    barrel.material = barrelMat;
    freeze(barrel);
  };
  barrelAt(4.9, -7.5);
  barrelAt(4.4, -8.1, 0.8);
  barrelAt(-5, -33);
  barrelAt(-4.3, -33.6, 0.75);

  // One terminal with a faint green screen: the only thing still "on".
  const term = MeshBuilder.CreateBox('lab.term', { width: 0.9, height: 1.4, depth: 0.6 }, scene);
  term.position.set(4.8, 0.7, -22.5);
  term.rotation.y = -0.3;
  term.material = darkMat;
  freeze(term);
  const screen = MeshBuilder.CreateBox('lab.screen', { width: 0.55, height: 0.4, depth: 0.05 }, scene);
  screen.position.set(4.55, 1.05, -22.28);
  screen.rotation.y = -0.3;
  screen.material = screenMat;
  freeze(screen);

  // ---------- Atmosphere ----------
  // Depth fog: enemies emerge from the murk at the doorway and resolve as
  // they close. Tuned so a spawn at 34 units is ~60% visible -- present, not
  // hidden -- and everything inside 10 units is effectively clear. The
  // legibility harness stays the check on worst-case fog + prompt.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.021;
  scene.fogColor = new Color3(0.015, 0.025, 0.022);
}
