/**
 * The infected. PRD Sections 8, 14 (Phase 2 creature art pass).
 *
 * Same laws as the laboratory (environment.ts): everything is procedural
 * Babylon primitives with StandardMaterials -- no textures, no fetched
 * assets -- so the repo stays fully redistributable. Creatures move, so
 * their meshes can't be frozen; the budget is held instead by part count
 * (15-25 low-tessellation meshes per creature, at most 5 creatures alive,
 * all pooled) and by animating with rotations only, which never recomputes
 * geometry.
 *
 * What makes them read as monsters rather than mannequins, in order of
 * cheapness per unit of dread: sickly skin tones (pallid green-gray, not
 * clean plastic), glowing ember eyes, a hanging or gaping jaw, asymmetry
 * (tilted head, uneven shoulders, one arm that hangs wrong), and wounds.
 * All of it is five shared materials and a few extra primitives.
 *
 * Materials are OWNED BY THE CALLER and shared across every creature.
 * That is what keeps setEffects working: intensity 'low' repaints the
 * shared set once (applyCreatureIntensity) and every walking body dims to
 * a silhouette, ember eyes included. Each creature splits its parts:
 * "flesh" swaps to the red active-target material while engaged; garb
 * (clothing, claws, bone), gore (wounds, raw mouths), and eyes stay put,
 * so the highlight reads as a lit body, not a painted statue.
 *
 * No flicker, deliberately: PRD 22 photosensitivity. Everything animates
 * on smooth sinusoids -- a shamble, a skitter, a heavy sway -- never a
 * strobe. The eyes glow steadily; they never blink or pulse.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { EnemyKind } from './scoring';

/** Every material a creature can wear, shared across all creatures. */
export interface CreatureMaterialSet {
  /** Skin at rest, one tone per kind: pallid, jaundiced, bruised. */
  standard: StandardMaterial;
  crawler: StandardMaterial;
  brute: StandardMaterial;
  /** Skin while this creature is the active target (shared red glow). */
  active: StandardMaterial;
  /** Rags, boots, claws, bone ridges. Never swapped, never repainted. */
  garb: StandardMaterial;
  /** Open wounds and raw mouths. Never swapped, never repainted. */
  gore: StandardMaterial;
  /** Ember eyes: steady emissive glow, dimmed by low intensity. */
  eye: StandardMaterial;
}

const SKIN: Record<EnemyKind, Color3> = {
  standard: new Color3(0.47, 0.5, 0.4), // pallid green-gray
  crawler: new Color3(0.52, 0.46, 0.29), // jaundiced
  brute: new Color3(0.46, 0.39, 0.49), // bruised gray-violet
};
const SKIN_LOW: Record<EnemyKind, Color3> = {
  standard: new Color3(0.27, 0.26, 0.24),
  crawler: new Color3(0.28, 0.26, 0.22),
  brute: new Color3(0.24, 0.22, 0.26),
};
const EYE_GLOW = new Color3(0.72, 0.5, 0.12);
const EYE_GLOW_LOW = new Color3(0.05, 0.04, 0.01);

/** Build the whole shared set. The encounter and the harness both use this. */
export function makeCreatureMaterialSet(scene: Scene): CreatureMaterialSet {
  const skin = (name: string, c: Color3) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = c;
    m.specularColor = Color3.Black();
    return m;
  };
  const active = skin('creature.active', new Color3(0.55, 0.3, 0.3));
  active.emissiveColor = new Color3(0.45, 0.08, 0.08);
  const garb = skin('creature.garb', new Color3(0.09, 0.09, 0.1));
  garb.freeze(); // nothing ever repaints it
  const gore = skin('creature.gore', new Color3(0.28, 0.04, 0.04));
  gore.freeze();
  const eye = skin('creature.eye', new Color3(0.05, 0.03, 0.01));
  eye.emissiveColor = EYE_GLOW; // repainted by intensity: cannot freeze
  return {
    standard: skin('creature.skin.standard', SKIN.standard),
    crawler: skin('creature.skin.crawler', SKIN.crawler),
    brute: skin('creature.skin.brute', SKIN.brute),
    active,
    garb,
    gore,
    eye,
  };
}

/**
 * Intensity 'low' (PRD 21/22): bodies dim to silhouettes, the red target
 * glow drops to a murmur, and the ember eyes go almost out. One repaint of
 * the shared set covers every creature alive and pooled.
 */
export function applyCreatureIntensity(set: CreatureMaterialSet, low: boolean): void {
  for (const kind of ['standard', 'crawler', 'brute'] as const) {
    set[kind].diffuseColor = low ? SKIN_LOW[kind] : SKIN[kind];
  }
  set.active.diffuseColor = low ? new Color3(0.3, 0.22, 0.22) : new Color3(0.55, 0.3, 0.3);
  set.active.emissiveColor = low ? new Color3(0.1, 0.02, 0.02) : new Color3(0.45, 0.08, 0.08);
  set.eye.emissiveColor = low ? EYE_GLOW_LOW : EYE_GLOW;
}

export interface Creature {
  /** Ground-level anchor. The encounter moves and reads only this. */
  root: TransformNode;
  kind: EnemyKind;
  /** Swap flesh between base skin and the red active-target material. */
  setActive(on: boolean): void;
  /** Advance the walk cycle. `motion` is the motion-reduction scale (0.25|1). */
  animate(dt: number, motion: number): void;
  /** The brute took a hit: a visible lurch on top of the knockback. */
  stagger(): void;
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

type PartCat = 'flesh' | 'garb' | 'gore' | 'eye';

/** Strides per second at each kind's walk speed. [REVIEW] tune by eye. */
const STRIDE_HZ: Record<EnemyKind, number> = { standard: 0.9, crawler: 2.6, brute: 0.55 };

class CreatureImpl implements Creature {
  root: TransformNode;
  kind: EnemyKind;
  private flesh: Mesh[] = [];
  private limbs: Limb[] = [];
  private torso: TransformNode | null = null;
  private torsoRest = 0;
  private swayAmp = 0;
  private mats: CreatureMaterialSet;
  private walkPhase: number;
  private strideHz: number;
  private staggerT = 0;

  constructor(scene: Scene, kind: EnemyKind, mats: CreatureMaterialSet) {
    this.kind = kind;
    this.mats = mats;
    this.root = new TransformNode(`creature.${kind}`, scene);
    // Same body, different starting foot: five identical shamblers walking
    // in perfect sync is the one thing that breaks the illusion instantly.
    this.walkPhase = Math.random() * Math.PI * 2;
    this.strideHz = STRIDE_HZ[kind];

    if (kind === 'crawler') this.buildCrawler(scene);
    else if (kind === 'brute') this.buildBrute(scene);
    else this.buildStandard(scene);

    for (const m of this.flesh) m.material = mats[kind];
  }

  // ---------- part helpers ----------
  private part(
    scene: Scene,
    shape: 'box' | 'sphere' | 'capsule' | 'cone',
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
            ? MeshBuilder.CreateCylinder(name, { diameterTop: 0, diameterBottom: size.dia, height: size.h, tessellation: 5 }, scene)
            : MeshBuilder.CreateCapsule(name, { height: size.h, radius: (size.dia ?? 0.2) / 2, tessellation: 8, subdivisions: 1 }, scene);
    mesh.parent = parent;
    mesh.isPickable = false;
    if (cat === 'flesh') this.flesh.push(mesh);
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

  /** Two ember eyes on a head pivot. They never swap and never blink. */
  private eyes(scene: Scene, head: TransformNode, spread: number, y: number, z: number, dia = 0.05): void {
    for (const side of [-1, 1]) {
      const e = this.part(scene, 'sphere', 'eye', { dia }, head, 'eye');
      e.position.set(side * spread, y, z);
    }
  }

  // ---------- the standard infected: a shambler ----------
  // Hunched forward, head lolled to one side, jaw hanging, arms reaching --
  // one raised and grasping, one hanging wrong. A wound in the chest where
  // the shirt is torn open. The classic outline reads at 30 units through
  // fog, which is the whole test; the eyes read further than that.
  private buildStandard(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 1.02;
    this.torso = torso;
    this.torsoRest = 0.3; // the hunch
    torso.rotation.x = this.torsoRest;
    this.swayAmp = 0.06;

    // Ragged shirt over flesh, torn open over a wound.
    const chest = this.part(scene, 'box', 'chest', { w: 0.42, h: 0.6, d: 0.26 }, torso, 'garb');
    chest.position.y = 0.32;
    const wound = this.part(scene, 'box', 'wound', { w: 0.16, h: 0.22, d: 0.04 }, torso, 'gore');
    wound.position.set(0.09, 0.36, 0.13);
    wound.rotation.z = 0.2;
    const hips = this.part(scene, 'box', 'hips', { w: 0.36, h: 0.24, d: 0.24 }, torso, 'garb');
    hips.position.y = -0.06;
    // Two hanging strips of torn shirt, angled apart.
    for (const [x, tilt] of [[-0.12, 0.25], [0.14, -0.18]] as const) {
      const strip = this.part(scene, 'box', 'rag', { w: 0.09, h: 0.22, d: 0.02 }, torso, 'garb');
      strip.position.set(x, -0.05, 0.12);
      strip.rotation.z = tilt;
    }

    // Head on its own pivot so the loll carries the face, jaw, and eyes.
    const head = new TransformNode('head', scene);
    head.parent = torso;
    head.position.set(0.02, 0.72, 0.1);
    head.rotation.set(0.3, 0, 0.22); // tilted down and lolled sideways
    const skull = this.part(scene, 'sphere', 'skull', { dia: 0.3 }, head, 'flesh');
    skull.scaling.set(0.85, 1.1, 0.92);
    const jaw = this.part(scene, 'box', 'jaw', { w: 0.12, h: 0.1, d: 0.12 }, head, 'flesh');
    jaw.position.set(0, -0.13, 0.08);
    jaw.rotation.x = 0.55; // hanging open
    const maw = this.part(scene, 'box', 'maw', { w: 0.09, h: 0.05, d: 0.06 }, head, 'gore');
    maw.position.set(0, -0.08, 0.1);
    this.eyes(scene, head, 0.065, 0.03, 0.12);

    for (const side of [-1, 1]) {
      // One arm raised and grasping, one hanging low and wrong: the
      // asymmetry is what separates "zombie" from "sleepwalker".
      const raised = side > 0;
      const shoulder = this.joint(
        scene, 'shoulder', new Vector3(side * 0.26, raised ? 0.54 : 0.46, 0.06), torso,
        0.18, raised ? 0 : Math.PI, new Vector3(raised ? -1.35 : -0.55, 0, side * -0.12),
      );
      const upper = this.part(scene, 'capsule', 'upperarm', { h: 0.42, dia: 0.11 }, shoulder, 'flesh');
      upper.position.y = -0.2;
      const elbow = this.joint(
        scene, 'elbow', new Vector3(0, -0.4, 0), shoulder,
        0.12, raised ? 1.1 : 1.1 + Math.PI, new Vector3(raised ? -0.3 : -0.15, 0, 0),
      );
      const fore = this.part(scene, 'capsule', 'forearm', { h: 0.38, dia: 0.09 }, elbow, 'flesh');
      fore.position.y = -0.18;
      const hand = this.part(scene, 'sphere', 'hand', { dia: 0.1 }, elbow, 'flesh');
      hand.position.y = -0.4;
      // Grasping claws off the hand.
      for (const fx of [-0.03, 0.03]) {
        const claw = this.part(scene, 'cone', 'claw', { dia: 0.035, h: 0.11 }, elbow, 'garb');
        claw.position.set(fx, -0.46, 0.02);
        claw.rotation.x = Math.PI; // point down/forward off the hand
      }

      // Legs: one drags. The asymmetry (different amp per side) IS the limp.
      const hip = this.joint(
        scene, 'hip', new Vector3(side * 0.13, -0.18, 0), torso,
        side > 0 ? 0.5 : 0.28, side > 0 ? 0 : Math.PI, new Vector3(-this.torsoRest, 0, 0),
      );
      const thigh = this.part(scene, 'capsule', 'thigh', { h: 0.46, dia: 0.15 }, hip, 'flesh');
      thigh.position.y = -0.22;
      // Torn trousers below the knee.
      const shin = this.part(scene, 'capsule', 'shin', { h: 0.44, dia: 0.12 }, hip, 'garb');
      shin.position.y = -0.62;
    }
  }

  // ---------- the crawler: fast, low, wrong ----------
  // A human frame moving on all fours faster than it should, spine ridge
  // showing through the skin, head craned up with a gaping raw mouth.
  // Spider-bent limbs: knees above the body. Its silhouette must never be
  // mistaken for the shambler's.
  private buildCrawler(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 0.46;
    this.torso = torso;
    this.torsoRest = 0;
    this.swayAmp = 0.1; // frantic little roll

    const body = this.part(scene, 'capsule', 'body', { h: 1.0, dia: 0.32 }, torso, 'flesh');
    body.rotation.x = Math.PI / 2; // slung horizontal, spine toward the player
    // Vertebrae pushing through the skin along the back.
    for (let i = 0; i < 4; i++) {
      const vert = this.part(scene, 'box', 'vertebra', { w: 0.07, h: 0.06, d: 0.07 }, torso, 'garb');
      vert.position.set(0, 0.17, -0.28 + i * 0.15);
      vert.rotation.x = 0.2;
    }

    // Head craned up off the front, jaw dropped into a raw gape.
    const head = new TransformNode('head', scene);
    head.parent = torso;
    head.position.set(0, 0.17, 0.56);
    head.rotation.x = -0.35; // craned up at the player
    const skull = this.part(scene, 'sphere', 'skull', { dia: 0.26 }, head, 'flesh');
    skull.scaling.set(0.9, 0.92, 1.12);
    const maw = this.part(scene, 'box', 'maw', { w: 0.1, h: 0.07, d: 0.1 }, head, 'gore');
    maw.position.set(0, -0.08, 0.08);
    const jaw = this.part(scene, 'box', 'jaw', { w: 0.12, h: 0.05, d: 0.13 }, head, 'flesh');
    jaw.position.set(0, -0.13, 0.07);
    jaw.rotation.x = 0.5;
    this.eyes(scene, head, 0.06, 0.04, 0.11, 0.045);

    // Four limbs bent like a spider's: upper segment up-and-out, knee above
    // the spine, lower segment stabbing down to a claw. Diagonal pairs move
    // together (a trot), which is what reads as skittering.
    for (const front of [1, -1]) {
      for (const side of [-1, 1]) {
        const diag = front * side > 0 ? 0 : Math.PI;
        const hip = this.joint(
          scene, 'hip', new Vector3(side * 0.16, 0.04, front * 0.3), torso,
          0.5, diag, new Vector3(0.3 * front, 0, side * 1.95),
        );
        const upper = this.part(scene, 'capsule', 'limbupper', { h: 0.36, dia: 0.09 }, hip, 'flesh');
        upper.position.y = -0.16;
        const knee = this.joint(
          scene, 'knee', new Vector3(0, -0.32, 0), hip,
          0.2, diag + Math.PI, new Vector3(0, 0, side * -2.45),
        );
        const lower = this.part(scene, 'capsule', 'limblower', { h: 0.42, dia: 0.07 }, knee, 'flesh');
        lower.position.y = -0.18;
        const claw = this.part(scene, 'cone', 'claw', { dia: 0.05, h: 0.12 }, knee, 'garb');
        claw.position.y = -0.44;
        claw.rotation.x = Math.PI;
      }
    }
  }

  // ---------- the brute: a door in the shape of a man ----------
  // Massive trapezoidal torso split open down the sternum, one arm grown
  // bigger than the other, bone spurs breaking through the hunched back,
  // ember eyes under a heavy brow. Moves slowly; the sway is the weight.
  private buildBrute(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 1.45;
    this.torso = torso;
    this.torsoRest = 0.16;
    torso.rotation.x = this.torsoRest;
    this.swayAmp = 0.14; // side-to-side mass, slow

    const chest = this.part(scene, 'box', 'chest', { w: 0.95, h: 0.85, d: 0.5 }, torso, 'flesh');
    chest.position.y = 0.42;
    // Two slabs of muscle angled off the box so the front catches the light
    // in facets instead of reading as one flat plane.
    for (const side of [-1, 1]) {
      const pec = this.part(scene, 'box', 'pec', { w: 0.4, h: 0.42, d: 0.12 }, torso, 'flesh');
      pec.position.set(side * 0.25, 0.52, 0.24);
      pec.rotation.y = side * 0.28;
      pec.rotation.x = -0.12;
    }
    // The sternum split: a raw seam torn down the middle of the chest.
    const seam = this.part(scene, 'box', 'seam', { w: 0.16, h: 0.75, d: 0.06 }, torso, 'gore');
    seam.position.set(0, 0.38, 0.27);
    const gut = this.part(scene, 'box', 'gut', { w: 0.78, h: 0.5, d: 0.44 }, torso, 'flesh');
    gut.position.y = -0.15;
    // A gouge dragged across the gut.
    const gouge = this.part(scene, 'box', 'gouge', { w: 0.5, h: 0.09, d: 0.04 }, torso, 'gore');
    gouge.position.set(-0.08, -0.1, 0.23);
    gouge.rotation.z = 0.25;
    // The hunch: a mass of scar tissue rising behind the head, with bone
    // spurs broken through it.
    const hump = this.part(scene, 'sphere', 'hump', { dia: 0.62 }, torso, 'flesh');
    hump.position.set(-0.06, 0.82, -0.16);
    hump.scaling.set(1.15, 0.75, 0.9);
    for (const [x, z, tilt] of [[-0.18, -0.2, -0.35], [0.02, -0.28, -0.15], [0.2, -0.18, 0.2]] as const) {
      const spur = this.part(scene, 'cone', 'spur', { dia: 0.1, h: 0.26 }, torso, 'garb');
      spur.position.set(x, 1.0, z);
      spur.rotation.z = tilt;
      spur.rotation.x = -0.3;
    }
    // Slabbed shoulder plates: garb, so the red highlight shows a body
    // under the bulk instead of painting the whole wall.
    for (const side of [-1, 1]) {
      const pauldron = this.part(scene, 'box', 'pauldron', { w: 0.34, h: 0.3, d: 0.55 }, torso, 'garb');
      pauldron.position.set(side * 0.62, 0.78, 0);
    }

    // Head sunk between the shoulders under a heavy garb brow; the eyes
    // glow from underneath it.
    const head = new TransformNode('head', scene);
    head.parent = torso;
    head.position.set(0, 0.97, 0.2);
    head.rotation.x = 0.15;
    const skull = this.part(scene, 'sphere', 'skull', { dia: 0.34 }, head, 'flesh');
    skull.scaling.set(1, 0.85, 0.95);
    const brow = this.part(scene, 'box', 'brow', { w: 0.3, h: 0.07, d: 0.18 }, head, 'garb');
    brow.position.set(0, 0.08, 0.08);
    brow.rotation.x = -0.15;
    this.eyes(scene, head, 0.08, 0.01, 0.13, 0.05);

    for (const side of [-1, 1]) {
      // One arm has grown past the other. Both end in garb-dark fists that
      // hang at knuckle height.
      const big = side > 0;
      const scale = big ? 1.18 : 0.92;
      const shoulder = this.joint(
        scene, 'shoulder', new Vector3(side * 0.68, 0.6, 0), torso,
        0.3, big ? Math.PI : 0, new Vector3(-0.28, 0, side * -0.2),
      );
      const arm = this.part(scene, 'capsule', 'arm', { h: 0.85 * scale, dia: 0.26 * scale }, shoulder, 'flesh');
      arm.position.y = -0.4 * scale;
      const fist = this.part(scene, 'box', 'fist', { w: 0.3 * scale, h: 0.3 * scale, d: 0.3 * scale }, shoulder, 'garb');
      fist.position.y = -0.95 * scale;

      const hip = this.joint(
        scene, 'hip', new Vector3(side * 0.28, -0.42, 0), torso,
        0.32, side > 0 ? 0 : Math.PI, new Vector3(-this.torsoRest, 0, 0),
      );
      const leg = this.part(scene, 'capsule', 'leg', { h: 0.95, dia: 0.3 }, hip, 'flesh');
      leg.position.y = -0.45;
    }
  }

  // ---------- behaviour ----------
  setActive(on: boolean): void {
    const mat = on ? this.mats.active : this.mats[this.kind];
    for (const m of this.flesh) m.material = mat;
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

  reset(): void {
    this.staggerT = 0;
    this.walkPhase = Math.random() * Math.PI * 2;
    this.setActive(false);
  }

  dispose(): void {
    // Recurses through every part; shared materials are left alone.
    this.root.dispose(false, false);
  }
}

export function buildCreature(scene: Scene, kind: EnemyKind, mats: CreatureMaterialSet): Creature {
  return new CreatureImpl(scene, kind, mats);
}
