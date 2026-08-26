/**
 * The abandoned robotics facility. PRD Sections 7, 8 (Phase 1b environment
 * pass; detail pass 2026-08-25 toward the reference art in
 * docs/reference-art: a dark industrial corridor, cold teal murk, and red
 * accents burning through it).
 *
 * Every rule here comes from the performance budget: quality from lighting
 * mood, atmosphere, and fog, never from asset density. The whole set is
 * procedural Babylon primitives with StandardMaterials -- the one texture
 * is the sector sign, drawn into a DynamicTexture in code -- so the repo
 * stays fully redistributable. The light count stays at what the gray-box
 * already used: one hemispheric ambient, one point lamp, plus the muzzle
 * flash. The "lighting" the corridor appears to have comes from emissive
 * materials, which cost nothing.
 *
 * Everything built here is static: world matrices and materials are frozen
 * after placement so the per-frame cost of the dressing is as close to zero
 * as Babylon allows. Props keep out of the enemy lane (|x| < 3.5) so the
 * machines never clip through a bench.
 *
 * No flicker anywhere, deliberately: PRD 22 photosensitivity. Every glow
 * is steady. The facility is unsettling because it is dim and red-lit,
 * not because it strobes.
 */

import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
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

export function buildFacility(scene: Scene): void {
  // ---------- Palette: cold, dim, industrial, with red burning through ----------
  const floorMat = mat(scene, 'fac.floor', new Color3(0.13, 0.15, 0.14));
  const wallMat = mat(scene, 'fac.wall', new Color3(0.16, 0.19, 0.18));
  const panelMat = mat(scene, 'fac.panel', new Color3(0.11, 0.13, 0.13));
  const trimMat = mat(scene, 'fac.trim', new Color3(0.25, 0.22, 0.16)); // old brass/rust
  const darkMat = mat(scene, 'fac.dark', new Color3(0.07, 0.08, 0.08));
  const benchMat = mat(scene, 'fac.bench', new Color3(0.2, 0.22, 0.23));
  const barrelMat = mat(scene, 'fac.barrel', new Color3(0.2, 0.16, 0.1));
  const grimeMat = mat(scene, 'fac.grime', new Color3(0.045, 0.05, 0.048));
  const cableMat = mat(scene, 'fac.cable', new Color3(0.05, 0.05, 0.055));
  // Emissives read as light sources without costing a light.
  const stripMat = mat(scene, 'fac.strip', new Color3(0.1, 0.12, 0.11), new Color3(0.35, 0.5, 0.42));
  const deadStripMat = mat(scene, 'fac.deadstrip', new Color3(0.09, 0.1, 0.1), new Color3(0.04, 0.05, 0.045));
  const screenMat = mat(scene, 'fac.screen', new Color3(0.05, 0.08, 0.06), new Color3(0.05, 0.16, 0.08));
  const doorMat = mat(scene, 'fac.door', new Color3(0.03, 0.035, 0.035));
  // The red family: warning accents, banner emblems, tank glow. All steady.
  const redGlowMat = mat(scene, 'fac.redglow', new Color3(0.15, 0.02, 0.02), new Color3(0.5, 0.05, 0.04));
  const redDimMat = mat(scene, 'fac.reddim', new Color3(0.12, 0.02, 0.02), new Color3(0.22, 0.03, 0.025));
  const bannerMat = mat(scene, 'fac.banner', new Color3(0.06, 0.05, 0.055));

  // ---------- Shell: floor, walls, ceiling ----------
  const ground = MeshBuilder.CreateGround('fac.ground', { width: 12, height: 44 }, scene);
  ground.position.z = -18;
  ground.material = floorMat;
  freeze(ground);

  // Grime patches: near-black slabs a hair off the floor, angled at random-
  // looking fixed rotations. Old spills and scorch marks, three vertices each.
  const grimeAt = (x: number, z: number, w: number, d: number, rot: number): void => {
    const patch = MeshBuilder.CreateGround('fac.grimepatch', { width: w, height: d }, scene);
    patch.position.set(x, 0.006, z);
    patch.rotation.y = rot;
    patch.material = grimeMat;
    freeze(patch);
  };
  grimeAt(-2.1, -8, 2.4, 1.6, 0.5);
  grimeAt(2.8, -13.5, 1.8, 2.6, 1.2);
  grimeAt(-0.6, -20, 3.2, 2.0, 2.3);
  grimeAt(1.9, -27, 2.2, 1.5, 0.9);
  grimeAt(-3.0, -33, 2.8, 2.2, 1.7);

  // A central drainage channel down the corridor: two trim rails and a dark
  // grate line, the detail that makes the floor read as a floor.
  for (const side of [-1, 1]) {
    const rail = MeshBuilder.CreateBox('fac.rail', { width: 0.08, height: 0.03, depth: 42 }, scene);
    rail.position.set(side * 0.55, 0.015, -18);
    rail.material = trimMat;
    freeze(rail);
  }
  const grate = MeshBuilder.CreateBox('fac.grate', { width: 1.0, height: 0.015, depth: 42 }, scene);
  grate.position.set(0, 0.008, -18);
  grate.material = darkMat;
  freeze(grate);

  for (const side of [-1, 1]) {
    const wall = MeshBuilder.CreateBox('fac.sidewall', { width: 0.4, height: 5, depth: 44 }, scene);
    wall.position.set(side * 6, 2.5, -18);
    wall.material = wallMat;
    freeze(wall);
    // Recessed panel rhythm down the corridor, so the walls read as a place
    // rather than a plane.
    for (let i = 0; i < 6; i++) {
      const panel = MeshBuilder.CreateBox('fac.panel', { width: 0.12, height: 2.6, depth: 3.2 }, scene);
      panel.position.set(side * 5.75, 1.9, -4 - i * 6.4);
      panel.material = panelMat;
      freeze(panel);
    }
    // Structural ribs between the panels: the corridor's skeleton showing.
    for (let i = 0; i < 7; i++) {
      const rib = MeshBuilder.CreateBox('fac.rib', { width: 0.18, height: 4.6, depth: 0.22 }, scene);
      rib.position.set(side * 5.8, 2.3, -0.8 - i * 6.4);
      rib.material = darkMat;
      freeze(rib);
    }
    // Two pipe runs along each wall at different heights; the lower one has
    // sagged out of its brackets by a few degrees.
    const pipe = MeshBuilder.CreateCylinder('fac.pipe', { diameter: 0.16, height: 42, tessellation: 8 }, scene);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 5.6, 3.9, -18);
    pipe.material = trimMat;
    freeze(pipe);
    const lowPipe = MeshBuilder.CreateCylinder('fac.lowpipe', { diameter: 0.11, height: 42, tessellation: 8 }, scene);
    lowPipe.rotation.x = Math.PI / 2;
    lowPipe.rotation.z = side * 0.012;
    lowPipe.position.set(side * 5.55, 3.5, -18);
    lowPipe.material = darkMat;
    freeze(lowPipe);
    // A red warning stripe running low along each wall: the facility's own
    // hazard paint, glowing faintly where it survived.
    const stripe = MeshBuilder.CreateBox('fac.hazard', { width: 0.05, height: 0.1, depth: 42 }, scene);
    stripe.position.set(side * 5.78, 0.55, -18);
    stripe.material = redDimMat;
    freeze(stripe);
  }

  const ceiling = MeshBuilder.CreateBox('fac.ceiling', { width: 12, height: 0.3, depth: 44 }, scene);
  ceiling.position.set(0, 5.1, -18);
  ceiling.material = darkMat;
  freeze(ceiling);

  // Cross-beams overhead: a gantry every ten meters, one with cables coming
  // off it. They break the ceiling into bays the way the panels break walls.
  for (const z of [-9, -19, -29]) {
    const beam = MeshBuilder.CreateBox('fac.beam', { width: 12, height: 0.35, depth: 0.5 }, scene);
    beam.position.set(0, 4.7, z);
    beam.material = darkMat;
    freeze(beam);
  }
  // Hanging cables: dead wiring pulled loose, angled slightly, none of it
  // in the lane's sight line to the prompt.
  const cableAt = (x: number, z: number, len: number, tilt: number): void => {
    const cable = MeshBuilder.CreateCylinder('fac.cabledrop', { diameter: 0.035, height: len, tessellation: 6 }, scene);
    cable.position.set(x, 5.0 - len / 2, z);
    cable.rotation.z = tilt;
    cable.material = cableMat;
    freeze(cable);
  };
  cableAt(-4.6, -9.2, 1.4, 0.18);
  cableAt(-4.2, -9.0, 0.9, -0.1);
  cableAt(4.5, -19.3, 1.7, -0.22);
  cableAt(5.0, -28.7, 1.2, 0.14);
  cableAt(-4.9, -29.1, 2.0, -0.08);

  // ---------- The far end: the doorway they come out of ----------
  const backWall = MeshBuilder.CreateBox('fac.back', { width: 12, height: 5, depth: 0.4 }, scene);
  backWall.position.set(0, 2.5, -40);
  backWall.material = wallMat;
  freeze(backWall);
  // A black opening with a trim frame: machines emerge from somewhere, not
  // from a wall. Sits just proud of the back wall.
  const doorway = MeshBuilder.CreateBox('fac.doorway', { width: 4.2, height: 3.6, depth: 0.1 }, scene);
  doorway.position.set(0, 1.8, -39.7);
  doorway.material = doorMat;
  freeze(doorway);
  for (const side of [-1, 1]) {
    const jamb = MeshBuilder.CreateBox('fac.jamb', { width: 0.25, height: 3.8, depth: 0.3 }, scene);
    jamb.position.set(side * 2.2, 1.9, -39.6);
    jamb.material = trimMat;
    freeze(jamb);
    // Red marker lights flanking the doorway, the way the reference art
    // frames its gate. Steady, not blinking.
    const marker = MeshBuilder.CreateBox('fac.marker', { width: 0.12, height: 0.5, depth: 0.08 }, scene);
    marker.position.set(side * 2.55, 2.0, -39.5);
    marker.material = redGlowMat;
    freeze(marker);
  }
  const lintel = MeshBuilder.CreateBox('fac.lintel', { width: 4.7, height: 0.25, depth: 0.3 }, scene);
  lintel.position.set(0, 3.85, -39.6);
  lintel.material = trimMat;
  freeze(lintel);

  // The sector sign above the gate: the one texture in the game, drawn in
  // code. Cold teal like the reference art's stage sign -- the red is
  // reserved for things that want you dead.
  const signTex = new DynamicTexture('fac.signtex', { width: 512, height: 128 }, scene, false);
  signTex.drawText('SECTOR 07', null, 92, 'bold 84px monospace', '#9ff0dc', '#04120d', true);
  const signMat = new StandardMaterial('fac.sign', scene);
  signMat.diffuseColor = Color3.Black();
  signMat.emissiveTexture = signTex;
  signMat.specularColor = Color3.Black();
  signMat.freeze();
  const sign = MeshBuilder.CreatePlane('fac.signplane', { width: 2.8, height: 0.7 }, scene);
  sign.position.set(0, 4.35, -39.45);
  sign.material = signMat;
  freeze(sign);

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
    const strip = MeshBuilder.CreateBox('fac.strip', { width: 3.4, height: 0.08, depth: 0.5 }, scene);
    strip.position.set(0, 4.92, s.z);
    strip.material = s.dead ? deadStripMat : stripMat;
    freeze(strip);
  }

  // ---------- Banners: the occupying force marks its corridor ----------
  // Dark hangings with a red emblem burning in the middle, like the skull
  // banners in the reference art. Emblem is a simple emissive diamond.
  const bannerAt = (side: number, z: number): void => {
    const cloth = MeshBuilder.CreateBox('fac.bannercloth', { width: 1.1, height: 2.4, depth: 0.05 }, scene);
    cloth.position.set(side * 5.6, 2.8, z);
    cloth.material = bannerMat;
    freeze(cloth);
    const rod = MeshBuilder.CreateCylinder('fac.bannerrod', { diameter: 0.07, height: 1.4, tessellation: 6 }, scene);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(side * 5.55, 4.05, z);
    rod.material = trimMat;
    freeze(rod);
    const emblem = MeshBuilder.CreateBox('fac.emblem', { width: 0.5, height: 0.5, depth: 0.03 }, scene);
    emblem.position.set(side * 5.52, 2.9, z);
    emblem.rotation.z = Math.PI / 4; // a diamond, not a screen
    emblem.material = redGlowMat;
    freeze(emblem);
  };
  bannerAt(-1, -12);
  bannerAt(1, -24);
  bannerAt(-1, -35);

  // ---------- Containment tanks: where the machines were grown ----------
  // Tall cylinders lit red from inside, a dormant frame silhouetted in
  // each -- the reference art's specimen tubes. Static, steady, outside
  // the lane.
  const tankAt = (x: number, z: number): void => {
    const glass = MeshBuilder.CreateCylinder('fac.tank', { diameter: 1.0, height: 2.6, tessellation: 12 }, scene);
    glass.position.set(x, 1.4, z);
    glass.material = redDimMat;
    freeze(glass);
    const cap = MeshBuilder.CreateCylinder('fac.tankcap', { diameter: 1.15, height: 0.25, tessellation: 12 }, scene);
    cap.position.set(x, 2.8, z);
    cap.material = darkMat;
    freeze(cap);
    const base = MeshBuilder.CreateCylinder('fac.tankbase', { diameter: 1.2, height: 0.35, tessellation: 12 }, scene);
    base.position.set(x, 0.18, z);
    base.material = darkMat;
    freeze(base);
    // The occupant: a dark torso shape hanging in the glow.
    const husk = MeshBuilder.CreateBox('fac.husk', { width: 0.4, height: 1.1, depth: 0.3 }, scene);
    husk.position.set(x, 1.35, z);
    husk.rotation.y = 0.4;
    husk.material = doorMat;
    freeze(husk);
  };
  tankAt(-5.1, -18.5);
  tankAt(5.1, -31);

  // ---------- Props: benches, barrels, debris, a dead terminal ----------
  // All outside the enemy lane. Boxes and cylinders only.
  const benchAt = (x: number, z: number, rot: number): void => {
    const top = MeshBuilder.CreateBox('fac.benchtop', { width: 2.2, height: 0.1, depth: 0.8 }, scene);
    top.position.set(x, 0.95, z);
    top.rotation.y = rot;
    top.material = benchMat;
    freeze(top);
    const base = MeshBuilder.CreateBox('fac.benchbase', { width: 2.0, height: 0.9, depth: 0.7 }, scene);
    base.position.set(x, 0.45, z);
    base.rotation.y = rot;
    base.material = darkMat;
    freeze(base);
  };
  benchAt(-4.6, -9, 0.12);
  benchAt(4.7, -16, -0.08);
  benchAt(-4.5, -26, -0.15);

  const barrelAt = (x: number, z: number, h = 1.0): void => {
    const barrel = MeshBuilder.CreateCylinder('fac.barrel', { diameter: 0.7, height: h, tessellation: 10 }, scene);
    barrel.position.set(x, h / 2, z);
    barrel.material = barrelMat;
    freeze(barrel);
  };
  barrelAt(4.9, -7.5);
  barrelAt(4.4, -8.1, 0.8);
  barrelAt(-5, -33);
  barrelAt(-4.3, -33.6, 0.75);
  // One barrel on its side: something happened here.
  const tipped = MeshBuilder.CreateCylinder('fac.tippedbarrel', { diameter: 0.7, height: 1.0, tessellation: 10 }, scene);
  tipped.rotation.z = Math.PI / 2;
  tipped.rotation.y = 0.5;
  tipped.position.set(4.6, 0.35, -25.5);
  tipped.material = barrelMat;
  freeze(tipped);

  // Debris: broken plate and machine scrap along the wall bases.
  const debrisAt = (x: number, z: number, w: number, rotY: number, rotZ = 0): void => {
    const chunk = MeshBuilder.CreateBox('fac.debris', { width: w, height: 0.12, depth: w * 0.7 }, scene);
    chunk.position.set(x, 0.06, z);
    chunk.rotation.y = rotY;
    chunk.rotation.z = rotZ;
    chunk.material = panelMat;
    freeze(chunk);
  };
  debrisAt(-4.9, -6.2, 0.7, 0.8);
  debrisAt(-4.4, -6.6, 0.4, 2.1, 0.15);
  debrisAt(5.2, -12.8, 0.6, 1.4);
  debrisAt(4.6, -21.5, 0.8, 0.3, -0.1);
  debrisAt(-5.3, -30.4, 0.5, 1.9);
  // A fallen wall panel leaning where it landed.
  const fallen = MeshBuilder.CreateBox('fac.fallenpanel', { width: 1.6, height: 0.1, depth: 2.2 }, scene);
  fallen.position.set(-4.8, 0.55, -14.5);
  fallen.rotation.z = 0.5;
  fallen.rotation.y = 0.3;
  fallen.material = panelMat;
  freeze(fallen);

  // One terminal with a faint green screen: the only thing still watching.
  const term = MeshBuilder.CreateBox('fac.term', { width: 0.9, height: 1.4, depth: 0.6 }, scene);
  term.position.set(4.8, 0.7, -22.5);
  term.rotation.y = -0.3;
  term.material = darkMat;
  freeze(term);
  const screen = MeshBuilder.CreateBox('fac.screen', { width: 0.55, height: 0.4, depth: 0.05 }, scene);
  screen.position.set(4.55, 1.05, -22.28);
  screen.rotation.y = -0.3;
  screen.material = screenMat;
  freeze(screen);

  // ---------- Atmosphere ----------
  // Depth fog: machines emerge from the murk at the doorway and resolve as
  // they close. Tuned so a spawn at 34 units is ~60% visible -- present, not
  // hidden -- and everything inside 10 units is effectively clear. The
  // legibility harness stays the check on worst-case fog + prompt.
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.021;
  scene.fogColor = new Color3(0.015, 0.025, 0.022);
}
