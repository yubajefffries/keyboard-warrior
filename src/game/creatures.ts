/**
 * The machines. PRD Sections 8, 14 (Phase 2 creature art pass; robot
 * redesign 2026-08-25 -- the infected are out, the facility's own security
 * machines are in).
 *
 * Same laws as the facility (environment.ts): everything is procedural
 * Babylon primitives with StandardMaterials -- no textures, no fetched
 * assets -- so the repo stays fully redistributable. Machines move, so
 * their meshes can't be frozen; the budget is held instead by part count
 * (15-25 low-tessellation meshes per machine, at most 5 machines alive,
 * all pooled) and by animating with rotations only, which never recomputes
 * geometry.
 *
 * What makes them read as machines rather than toys, in order of cheapness
 * per unit of menace: hard boxy silhouettes with visible dark joints
 * between armor plates, steady red sensor eyes, a glowing power core that
 * says "this thing is running", and purposeful asymmetry (a cannon where
 * one hand should be, a bent antenna, uneven armor). All of it is five
 * shared materials and a few extra primitives.
 *
 * Materials are OWNED BY THE CALLER and shared across every machine.
 * That is what keeps setEffects working: intensity 'low' repaints the
 * shared set once (applyCreatureIntensity) and every walking machine dims
 * to a silhouette, sensor eyes included. Each machine splits its parts:
 * "hull" (armor plating) swaps to the red active-target material while
 * engaged; frame (joints, hydraulics, feet), core (power cells, vents),
 * and eyes stay put, so the highlight reads as a lit machine, not a
 * painted statue.
 *
 * No flicker, deliberately: PRD 22 photosensitivity. Everything animates
 * on smooth sinusoids -- a servo gait, a skitter, a heavy stomping sway --
 * never a strobe. The eyes and cores glow steadily; they never blink or
 * pulse.
 *
 * Kind mapping (the internal ids predate the redesign and are threaded
 * through scoring, pacing, and survival, so they stay):
 *   standard -> the HOUND, a four-legged patrol robot. Two words to kill.
 *   crawler  -> the SPIDER, a low fast eight-legged drone. One word.
 *   brute    -> the MECH, a heavy humanoid war machine. Three words.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { EnemyKind } from './scoring';

/** Every material a machine can wear, shared across all machines. */
export interface CreatureMaterialSet {
  /** Hull plating at rest, one finish per kind: steel, bronze, olive. */
  standard: StandardMaterial;
  crawler: StandardMaterial;
  brute: StandardMaterial;
  /** Hull while this machine is the active target (shared red glow). */
  active: StandardMaterial;
  /** Joints, hydraulics, feet, weapon barrels. Never swapped, never repainted. */
  frame: StandardMaterial;
  /** Power cores and vents: steady red emissive. Never swapped, never repainted. */
  core: StandardMaterial;
  /** Sensor eyes: steady red glow, dimmed by low intensity. */
  eye: StandardMaterial;
  /** Health bar housing above a wounded machine. Never repainted. */
  barBack: StandardMaterial;
  /** Health bar fill: amber status glow, scaled by remaining words. */
  barFill: StandardMaterial;
}

const HULL: Record<EnemyKind, Color3> = {
  standard: new Color3(0.4, 0.44, 0.5), // cold gunmetal steel
  crawler: new Color3(0.38, 0.32, 0.22), // scorched bronze
  brute: new Color3(0.36, 0.4, 0.34), // military olive-gray
};
const HULL_LOW: Record<EnemyKind, Color3> = {
  standard: new Color3(0.24, 0.25, 0.27),
  crawler: new Color3(0.25, 0.23, 0.19),
  brute: new Color3(0.22, 0.24, 0.21),
};
const EYE_GLOW = new Color3(0.85, 0.1, 0.08);
const EYE_GLOW_LOW = new Color3(0.06, 0.01, 0.01);

/** Build the whole shared set. The encounter and the harness both use this. */
export function makeCreatureMaterialSet(scene: Scene): CreatureMaterialSet {
  const paint = (name: string, c: Color3) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = c;
    m.specularColor = new Color3(0.18, 0.18, 0.2); // metal catches a little light
    return m;
  };
  const active = paint('machine.active', new Color3(0.55, 0.3, 0.3));
  active.emissiveColor = new Color3(0.45, 0.08, 0.08);
  const frame = paint('machine.frame', new Color3(0.07, 0.07, 0.08));
  frame.specularColor = new Color3(0.1, 0.1, 0.1);
  frame.freeze(); // nothing ever repaints it
  const core = paint('machine.core', new Color3(0.18, 0.03, 0.03));
  core.emissiveColor = new Color3(0.62, 0.07, 0.05); // steady, never pulses
  core.freeze();
  const eye = paint('machine.eye', new Color3(0.05, 0.02, 0.02));
  eye.emissiveColor = EYE_GLOW; // repainted by intensity: cannot freeze
  // The health bar reads by emissive alone, so it stays legible in the fog
  // and in low intensity without ever being repainted.
  const barBack = paint('machine.barback', new Color3(0.02, 0.02, 0.025));
  barBack.emissiveColor = new Color3(0.05, 0.05, 0.06);
  barBack.freeze();
  const barFill = paint('machine.barfill', new Color3(0.1, 0.07, 0.01));
  barFill.emissiveColor = new Color3(0.75, 0.5, 0.1); // amber status glow, steady
  barFill.freeze();
  return {
    standard: paint('machine.hull.standard', HULL.standard),
    crawler: paint('machine.hull.crawler', HULL.crawler),
    brute: paint('machine.hull.brute', HULL.brute),
    active,
    frame,
    core,
    eye,
    barBack,
    barFill,
  };
}

/**
 * Intensity 'low' (PRD 21/22): machines dim to silhouettes, the red target
 * glow drops to a murmur, and the sensor eyes go almost out. One repaint of
 * the shared set covers every machine alive and pooled.
 */
export function applyCreatureIntensity(set: CreatureMaterialSet, low: boolean): void {
  for (const kind of ['standard', 'crawler', 'brute'] as const) {
    set[kind].diffuseColor = low ? HULL_LOW[kind] : HULL[kind];
  }
  set.active.diffuseColor = low ? new Color3(0.3, 0.22, 0.22) : new Color3(0.55, 0.3, 0.3);
  set.active.emissiveColor = low ? new Color3(0.1, 0.02, 0.02) : new Color3(0.45, 0.08, 0.08);
  set.eye.emissiveColor = low ? EYE_GLOW_LOW : EYE_GLOW;
}

export interface Creature {
  /** Ground-level anchor. The encounter moves and reads only this. */
  root: TransformNode;
  kind: EnemyKind;
  /** Swap hull plating between base finish and the red active-target material. */
  setActive(on: boolean): void;
  /** Advance the gait cycle. `motion` is the motion-reduction scale (0.25|1). */
  animate(dt: number, motion: number): void;
  /** The machine took a non-fatal hit: a visible lurch on top of the knockback. */
  stagger(): void;
  /**
   * Remaining armor as a fraction of words carried at spawn. The bar above
   * the machine appears at the first hit (fraction < 1) and depletes per
   * shot; 1 or less-than-or-equal-to 0 hides it. Camera-facing, emissive,
   * steady -- it informs, it does not flash.
   */
  setHealth(fraction: number): void;
  /**
   * Back to a fresh body for pooled reuse: highlight off, stagger cleared,
   * a new random stride phase so the recycled walker is not in step with
   * the one it used to be.
   */
  reset(): void;
  dispose(): void;
}

interface Limb {
  node: TransformNode;
  /** Radians of swing at full motion. */
  amp: number;
  /** Phase offset within the stride, so limbs alternate. */
  phase: number;
  /** Resting rotation the swing is added to. */
  rest: Vector3;
}

type PartCat = 'hull' | 'frame' | 'core' | 'eye';

/** Strides per second at each kind's walk speed. [REVIEW] tune by eye. */
const STRIDE_HZ: Record<EnemyKind, number> = { standard: 1.5, crawler: 2.8, brute: 0.5 };

/**
 * Health bar height above the ground anchor, clear of each silhouette.
 * (The silhouette contract test bounds these too: the spider's bar must
 * stay low, the hound's below head height of a person.)
 */
const BAR_Y: Record<EnemyKind, number> = { standard: 1.32, crawler: 0.72, brute: 2.85 };
const BAR_W = 0.9;
const FILL_W = 0.84;

class CreatureImpl implements Creature {
  root: TransformNode;
  kind: EnemyKind;
  private hull: Mesh[] = [];
  private limbs: Limb[] = [];
  private torso: TransformNode | null = null;
  private torsoRest = 0;
  private swayAmp = 0;
  private mats: CreatureMaterialSet;
  private walkPhase: number;
  private strideHz: number;
  private staggerT = 0;
  private barBack: Mesh;
  private barFill: Mesh;

  constructor(scene: Scene, kind: EnemyKind, mats: CreatureMaterialSet) {
    this.kind = kind;
    this.mats = mats;
    this.root = new TransformNode(`machine.${kind}`, scene);
    // Same body, different starting foot: five identical machines walking
    // in perfect sync is the one thing that breaks the illusion instantly.
    this.walkPhase = Math.random() * Math.PI * 2;
    this.strideHz = STRIDE_HZ[kind];

    if (kind === 'crawler') this.buildSpider(scene);
    else if (kind === 'brute') this.buildMech(scene);
    else this.buildHound(scene);

    // The armor readout: a camera-facing bar above the machine, hidden
    // until the first hit lands. The fill is a child of the housing so the
    // billboard turns them as one; depleting scales the fill toward its
    // left edge, the direction every health bar in every game depletes.
    this.barBack = MeshBuilder.CreatePlane(
      'healthbar', { width: BAR_W, height: 0.09, sideOrientation: 2 /* DOUBLESIDE */ }, scene,
    );
    this.barBack.parent = this.root;
    this.barBack.position.y = BAR_Y[kind];
    this.barBack.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    this.barBack.isPickable = false;
    this.barBack.material = mats.barBack;
    this.barFill = MeshBuilder.CreatePlane(
      'healthfill', { width: FILL_W, height: 0.055, sideOrientation: 2 }, scene,
    );
    this.barFill.parent = this.barBack;
    this.barFill.position.z = -0.012; // just proud of the housing, camera side
    this.barFill.isPickable = false;
    this.barFill.material = mats.barFill;
    this.barBack.setEnabled(false);

    for (const m of this.hull) m.material = mats[kind];
  }

  // ---------- part helpers ----------
  private part(
    scene: Scene,
    shape: 'box' | 'sphere' | 'capsule' | 'cone' | 'cylinder',
    name: string,
    size: { w?: number; h?: number; d?: number; dia?: number },
    parent: TransformNode,
    cat: PartCat,
  ): Mesh {
    const mesh =
      shape === 'box'
        ? MeshBuilder.CreateBox(name, { width: size.w, height: size.h, depth: size.d }, scene)
        : shape === 'sphere'
          ? MeshBuilder.CreateSphere(name, { diameter: size.dia, segments: 6 }, scene)
          : shape === 'cone'
            ? MeshBuilder.CreateCylinder(name, { diameterTop: 0, diameterBottom: size.dia, height: size.h, tessellation: 6 }, scene)
            : shape === 'cylinder'
              ? MeshBuilder.CreateCylinder(name, { diameter: size.dia, height: size.h, tessellation: 8 }, scene)
              : MeshBuilder.CreateCapsule(name, { height: size.h, radius: (size.dia ?? 0.2) / 2, tessellation: 8, subdivisions: 1 }, scene);
    mesh.parent = parent;
    mesh.isPickable = false;
    if (cat === 'hull') this.hull.push(mesh);
    else mesh.material = this.mats[cat];
    return mesh;
  }

  /** A pivot at the joint; the mesh hangs below/along it so rotation swings it. */
  private joint(scene: Scene, name: string, at: Vector3, parent: TransformNode, amp: number, phase: number, rest: Vector3): TransformNode {
    const node = new TransformNode(name, scene);
    node.parent = parent;
    node.position = at;
    node.rotation = rest.clone();
    this.limbs.push({ node, amp, phase, rest });
    return node;
  }

  /** Two red sensor eyes on a head pivot. They never swap and never blink. */
  private eyes(scene: Scene, head: TransformNode, spread: number, y: number, z: number, dia = 0.05): void {
    for (const side of [-1, 1]) {
      const e = this.part(scene, 'sphere', 'eye', { dia }, head, 'eye');
      e.position.set(side * spread, y, z);
    }
  }

  // ---------- the standard machine: the HOUND ----------
  // A four-legged patrol robot: boxy chassis slung between piston legs, a
  // wedge head craned forward with two sensor eyes, a whip antenna where a
  // tail would be. Diagonal legs trot together, the way a dog's do. It
  // takes two words to put down, and the first hit staggers it.
  private buildHound(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 0.62;
    this.torso = torso;
    this.torsoRest = 0.04; // nose-down, hunting
    torso.rotation.x = this.torsoRest;
    this.swayAmp = 0.05;

    // Chassis: armor hull over a dark underbelly of machinery.
    const chassis = this.part(scene, 'box', 'chassis', { w: 0.46, h: 0.3, d: 0.92 }, torso, 'hull');
    chassis.position.y = 0.06;
    const belly = this.part(scene, 'box', 'belly', { w: 0.34, h: 0.16, d: 0.7 }, torso, 'frame');
    belly.position.y = -0.14;
    // Spine plate riding on top, slightly off-square: patched armor.
    const plate = this.part(scene, 'box', 'plate', { w: 0.36, h: 0.06, d: 0.6 }, torso, 'hull');
    plate.position.set(0.02, 0.24, -0.06);
    plate.rotation.y = 0.06;
    // The power cell glows through a vent on each flank.
    for (const side of [-1, 1]) {
      const vent = this.part(scene, 'box', 'vent', { w: 0.03, h: 0.1, d: 0.3 }, torso, 'core');
      vent.position.set(side * 0.24, 0.04, -0.1);
    }

    // Head on its own pivot: a wedge craned forward, jaw underneath.
    const head = new TransformNode('head', scene);
    head.parent = torso;
    head.position.set(0, 0.26, 0.56);
    head.rotation.x = 0.18;
    const skull = this.part(scene, 'box', 'skull', { w: 0.26, h: 0.2, d: 0.36 }, head, 'hull');
    skull.position.z = 0.05;
    const snout = this.part(scene, 'box', 'snout', { w: 0.16, h: 0.12, d: 0.2 }, head, 'hull');
    snout.position.set(0, -0.04, 0.3);
    const jaw = this.part(scene, 'box', 'jaw', { w: 0.14, h: 0.05, d: 0.26 }, head, 'frame');
    jaw.position.set(0, -0.13, 0.22);
    jaw.rotation.x = 0.35; // hanging open: it bites
    this.eyes(scene, head, 0.08, 0.05, 0.24);
    // One ear antenna, bent: the asymmetry that reads as field damage.
    const ear = this.part(scene, 'cone', 'ear', { dia: 0.05, h: 0.18 }, head, 'frame');
    ear.position.set(0.09, 0.16, -0.02);
    ear.rotation.z = -0.4;

    // Tail antenna, angled up and off-center.
    const tail = this.part(scene, 'cylinder', 'tail', { dia: 0.03, h: 0.4 }, torso, 'frame');
    tail.position.set(-0.04, 0.24, -0.5);
    tail.rotation.x = -0.9;

    // Four piston legs: hull thigh, dark lower strut, boxy foot. Diagonal
    // pairs share a phase -- the trot is what makes it read as a dog.
    for (const front of [1, -1]) {
      for (const side of [-1, 1]) {
        const diag = front * side > 0 ? 0 : Math.PI;
        const hip = this.joint(
          scene, 'hip', new Vector3(side * 0.24, -0.02, front * 0.34), torso,
          0.55, diag, new Vector3(front * 0.12, 0, 0),
        );
        const thigh = this.part(scene, 'capsule', 'thigh', { h: 0.32, dia: 0.12 }, hip, 'hull');
        thigh.position.y = -0.14;
        const knee = this.joint(
          scene, 'knee', new Vector3(0, -0.28, 0), hip,
          0.3, diag + 0.9, new Vector3(front * -0.2, 0, 0),
        );
        const strut = this.part(scene, 'capsule', 'strut', { h: 0.32, dia: 0.07 }, knee, 'frame');
        strut.position.y = -0.14;
        const foot = this.part(scene, 'box', 'foot', { w: 0.09, h: 0.05, d: 0.14 }, knee, 'frame');
        foot.position.set(0, -0.31, 0.02);
      }
    }
  }

  // ---------- the crawler: the SPIDER ----------
  // A low eight-legged drone, all legs and lens. The abdomen is a squat
  // bronze pod with a red core glowing on top like a warning lamp; the legs
  // bend spider-fashion, knees above the body, and move in alternating
  // fours, which is what reads as skittering. Its silhouette must never be
  // mistaken for the hound's.
  private buildSpider(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 0.34;
    this.torso = torso;
    this.torsoRest = 0;
    this.swayAmp = 0.09; // frantic little roll

    const pod = this.part(scene, 'sphere', 'pod', { dia: 0.44 }, torso, 'hull');
    pod.scaling.set(1, 0.62, 1.25);
    // The core sits on top of the pod: a red lamp seen over cover.
    const lamp = this.part(scene, 'sphere', 'lamp', { dia: 0.12 }, torso, 'core');
    lamp.position.set(0, 0.16, -0.08);
    // Sensor head craned up off the front.
    const head = new TransformNode('head', scene);
    head.parent = torso;
    head.position.set(0, 0.04, 0.3);
    head.rotation.x = -0.3; // craned up at the player
    const lens = this.part(scene, 'box', 'lens', { w: 0.16, h: 0.1, d: 0.12 }, head, 'frame');
    lens.position.z = 0.03;
    this.eyes(scene, head, 0.05, 0.01, 0.1, 0.045);

    // Eight legs, two segments each: femur up-and-out (hull), tibia
    // stabbing down (frame). Alternating tetrapod gait: every other leg
    // around the body shares a phase.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = 0.24 - i * 0.16;
        const splay = 0.5 - i * 0.32; // front legs reach forward, rear rake back
        const phase = (i + (side > 0 ? 0 : 1)) % 2 === 0 ? 0 : Math.PI;
        const hip = this.joint(
          scene, 'hip', new Vector3(side * 0.18, 0.05, z), torso,
          0.45, phase, new Vector3(splay * 0.4, 0, side * 2.05),
        );
        const femur = this.part(scene, 'capsule', 'femur', { h: 0.3, dia: 0.07 }, hip, 'hull');
        femur.position.y = -0.13;
        const knee = this.joint(
          scene, 'knee', new Vector3(0, -0.26, 0), hip,
          0.22, phase + Math.PI, new Vector3(0, 0, side * -2.5),
        );
        const tibia = this.part(scene, 'cone', 'tibia', { dia: 0.055, h: 0.36 }, knee, 'frame');
        tibia.position.y = -0.16;
        tibia.rotation.x = Math.PI; // point stabs at the floor
      }
    }
  }

  // ---------- the brute: the MECH ----------
  // A door in the shape of a machine: slab chest over a glowing reactor,
  // pauldrons like anvils, one arm ending in a cannon and one in a
  // hydraulic claw, legs that could hold up a bridge. Moves slowly; the
  // sway is the tonnage. Three words of armor.
  private buildMech(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 1.62;
    this.torso = torso;
    this.torsoRest = 0.08; // leaning into the walk
    torso.rotation.x = this.torsoRest;
    this.swayAmp = 0.13; // side-to-side mass, slow

    const chest = this.part(scene, 'box', 'chest', { w: 1.0, h: 0.8, d: 0.55 }, torso, 'hull');
    chest.position.y = 0.42;
    // Two armor plates angled off the chest so the front catches light in
    // facets instead of reading as one flat refrigerator plane.
    for (const side of [-1, 1]) {
      const plate = this.part(scene, 'box', 'plate', { w: 0.42, h: 0.5, d: 0.12 }, torso, 'hull');
      plate.position.set(side * 0.26, 0.48, 0.28);
      plate.rotation.y = side * 0.3;
      plate.rotation.x = -0.1;
    }
    // The reactor: a red core burning between the chest plates.
    const reactor = this.part(scene, 'box', 'reactor', { w: 0.18, h: 0.34, d: 0.08 }, torso, 'core');
    reactor.position.set(0, 0.45, 0.31);
    // Abdomen of dark machinery under the armor, then armored pelvis.
    const abdomen = this.part(scene, 'box', 'abdomen', { w: 0.62, h: 0.34, d: 0.4 }, torso, 'frame');
    abdomen.position.y = -0.08;
    const pelvis = this.part(scene, 'box', 'pelvis', { w: 0.74, h: 0.28, d: 0.46 }, torso, 'hull');
    pelvis.position.y = -0.34;
    // Exhaust stacks over the left shoulder; heat vent glows on the back.
    for (const [x, h] of [[-0.34, 0.34], [-0.18, 0.26]] as const) {
      const stack = this.part(scene, 'cylinder', 'stack', { dia: 0.1, h }, torso, 'frame');
      stack.position.set(x, 0.86 + h / 2 - 0.1, -0.22);
    }
    const vent = this.part(scene, 'box', 'vent', { w: 0.3, h: 0.1, d: 0.04 }, torso, 'core');
    vent.position.set(0.1, 0.55, -0.3);

    // Pauldrons: anvil slabs. Hull, so the whole machine lights when targeted.
    for (const side of [-1, 1]) {
      const pauldron = this.part(scene, 'box', 'pauldron', { w: 0.38, h: 0.3, d: 0.58 }, torso, 'hull');
      pauldron.position.set(side * 0.66, 0.8, 0);
    }

    // Head sunk between the shoulders: a sensor block under an armored brow,
    // eyes glowing from underneath it.
    const head = new TransformNode('head', scene);
    head.parent = torso;
    head.position.set(0, 0.95, 0.18);
    head.rotation.x = 0.1;
    const skull = this.part(scene, 'box', 'skull', { w: 0.3, h: 0.24, d: 0.3 }, head, 'frame');
    skull.position.y = 0.02;
    const brow = this.part(scene, 'box', 'brow', { w: 0.34, h: 0.08, d: 0.2 }, head, 'hull');
    brow.position.set(0, 0.14, 0.06);
    brow.rotation.x = -0.12;
    this.eyes(scene, head, 0.08, 0.0, 0.14, 0.05);

    for (const side of [-1, 1]) {
      // Asymmetry with a purpose: the right arm IS a cannon, the left ends
      // in a hydraulic claw. Nobody mistakes this for a mannequin.
      const gunArm = side > 0;
      const shoulder = this.joint(
        scene, 'shoulder', new Vector3(side * 0.72, 0.62, 0), torso,
        0.28, gunArm ? Math.PI : 0, new Vector3(gunArm ? -0.45 : -0.22, 0, side * -0.16),
      );
      const arm = this.part(scene, 'capsule', 'arm', { h: 0.8, dia: 0.24 }, shoulder, 'hull');
      arm.position.y = -0.38;
      if (gunArm) {
        const cannon = this.part(scene, 'cylinder', 'cannon', { dia: 0.16, h: 0.55 }, shoulder, 'frame');
        cannon.position.set(0, -0.9, 0.12);
        cannon.rotation.x = Math.PI / 2 - 0.35; // bore toward the player
      } else {
        const claw = this.part(scene, 'box', 'claw', { w: 0.3, h: 0.3, d: 0.3 }, shoulder, 'frame');
        claw.position.y = -0.92;
        for (const fx of [-0.09, 0.09]) {
          const finger = this.part(scene, 'cone', 'finger', { dia: 0.08, h: 0.2 }, shoulder, 'frame');
          finger.position.set(fx, -1.12, 0.04);
          finger.rotation.x = Math.PI;
        }
      }

      const hip = this.joint(
        scene, 'hip', new Vector3(side * 0.3, -0.46, 0), torso,
        0.3, side > 0 ? 0 : Math.PI, new Vector3(-this.torsoRest, 0, 0),
      );
      const thigh = this.part(scene, 'capsule', 'thigh', { h: 0.6, dia: 0.28 }, hip, 'hull');
      thigh.position.y = -0.28;
      const shin = this.part(scene, 'box', 'shin', { w: 0.24, h: 0.55, d: 0.28 }, hip, 'frame');
      shin.position.y = -0.78;
      const foot = this.part(scene, 'box', 'foot', { w: 0.32, h: 0.12, d: 0.46 }, hip, 'frame');
      foot.position.set(0, -1.1, 0.08);
    }
  }

  // ---------- behaviour ----------
  setActive(on: boolean): void {
    const mat = on ? this.mats.active : this.mats[this.kind];
    for (const m of this.hull) m.material = mat;
  }

  animate(dt: number, motion: number): void {
    this.walkPhase += dt * this.strideHz * Math.PI * 2;
    const p = this.walkPhase;
    if (this.staggerT > 0) this.staggerT = Math.max(0, this.staggerT - dt * 2.5);

    for (const l of this.limbs) {
      l.node.rotation.x = l.rest.x + Math.sin(p + l.phase) * l.amp * motion;
      l.node.rotation.z = l.rest.z;
    }
    if (this.torso) {
      // The body rolls with the stride; the stagger folds it back briefly.
      const lurch = Math.sin(this.staggerT * Math.PI) * 0.3;
      this.torso.rotation.z = Math.sin(p) * this.swayAmp * motion;
      this.torso.rotation.x = this.torsoRest + Math.sin(p * 2) * 0.03 * motion - lurch * motion;
    }
  }

  stagger(): void {
    this.staggerT = 1;
  }

  setHealth(fraction: number): void {
    if (fraction >= 1 || fraction <= 0) {
      this.barBack.setEnabled(false);
      return;
    }
    this.barBack.setEnabled(true);
    this.barFill.scaling.x = fraction;
    // Scaling shrinks toward the center; shifting by half the lost width
    // pins the fill's left edge so the bar drains rightward.
    this.barFill.position.x = -((1 - fraction) * FILL_W) / 2;
  }

  reset(): void {
    this.staggerT = 0;
    this.walkPhase = Math.random() * Math.PI * 2;
    this.setActive(false);
    this.setHealth(1);
  }

  dispose(): void {
    // Recurses through every part; shared materials are left alone.
    this.root.dispose(false, false);
  }
}

export function buildCreature(scene: Scene, kind: EnemyKind, mats: CreatureMaterialSet): Creature {
  return new CreatureImpl(scene, kind, mats);
}
