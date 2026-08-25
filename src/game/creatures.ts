/**
 * The infected. PRD Sections 8, 14 (Phase 2 creature art pass).
 *
 * Same laws as the laboratory (environment.ts): everything is procedural
 * Babylon primitives with StandardMaterials -- no textures, no fetched
 * assets -- so the repo stays fully redistributable. Creatures move, so
 * nothing here can be frozen; the budget is held instead by part count
 * (7-10 low-tessellation meshes per creature, at most 5 creatures alive)
 * and by animating with rotations only, which never recomputes geometry.
 *
 * Materials are OWNED BY THE CALLER and shared across every creature of a
 * kind. That is what keeps setEffects working unchanged: intensity 'low'
 * repaints the shared materials once and every walking body dims to a
 * silhouette. Each creature splits its parts into "flesh" (swapped to the
 * red active-target material while engaged) and "garb" (clothing, claws --
 * stays dark so the highlight reads as a lit body, not a painted statue).
 *
 * No flicker, deliberately: PRD 22 photosensitivity. Everything animates on
 * smooth sinusoids -- a shamble, a skitter, a heavy sway -- never a strobe.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { EnemyKind } from './scoring';

export interface CreatureMaterials {
  /** Flesh at rest, one per kind. Caller repaints these for intensity. */
  base: StandardMaterial;
  /** Flesh while this creature is the active target (shared red glow). */
  active: StandardMaterial;
  /** Rags, claws, hair. Never swapped, never repainted: dark is dark. */
  garb: StandardMaterial;
}

/** The dark clothing/claw material, built once per scene. */
export function makeGarbMaterial(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('creature.garb', scene);
  m.diffuseColor = new Color3(0.09, 0.09, 0.1);
  m.specularColor = Color3.Black();
  m.freeze(); // nothing ever repaints it
  return m;
}

export interface Creature {
  /** Ground-level anchor. The encounter moves and reads only this. */
  root: TransformNode;
  kind: EnemyKind;
  /** Swap flesh between base and the red active-target material. */
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
  private mats: CreatureMaterials;
  private walkPhase: number;
  private strideHz: number;
  private staggerT = 0;

  constructor(scene: Scene, kind: EnemyKind, mats: CreatureMaterials) {
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

    for (const m of this.flesh) m.material = mats.base;
  }

  // ---------- part helpers ----------
  private part(
    scene: Scene,
    shape: 'box' | 'sphere' | 'capsule',
    name: string,
    size: { w?: number; h?: number; d?: number; dia?: number },
    parent: TransformNode,
    flesh: boolean,
  ): Mesh {
    const mesh =
      shape === 'box'
        ? MeshBuilder.CreateBox(name, { width: size.w, height: size.h, depth: size.d }, scene)
        : shape === 'sphere'
          ? MeshBuilder.CreateSphere(name, { diameter: size.dia, segments: 6 }, scene)
          : MeshBuilder.CreateCapsule(name, { height: size.h, radius: (size.dia ?? 0.2) / 2, tessellation: 8, subdivisions: 1 }, scene);
    mesh.parent = parent;
    mesh.isPickable = false;
    if (flesh) this.flesh.push(mesh);
    else mesh.material = this.mats.garb;
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

  // ---------- the standard infected: a shambler ----------
  // Hunched forward, arms half-raised and reaching, dragging step. The
  // classic outline reads at 30 units through fog, which is the whole test.
  private buildStandard(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 1.02;
    this.torso = torso;
    this.torsoRest = 0.28; // the hunch
    torso.rotation.x = this.torsoRest;
    this.swayAmp = 0.06;

    // Ragged shirt over flesh: chest is garb, head/arms/legs are flesh.
    const chest = this.part(scene, 'box', 'chest', { w: 0.42, h: 0.6, d: 0.26 }, torso, false);
    chest.position.y = 0.32;
    const hips = this.part(scene, 'box', 'hips', { w: 0.36, h: 0.24, d: 0.24 }, torso, false);
    hips.position.y = -0.06;

    const head = this.part(scene, 'sphere', 'head', { dia: 0.3 }, torso, true);
    head.position.set(0, 0.74, 0.1); // jutting forward off the hunch
    head.rotation.x = 0.35;

    for (const side of [-1, 1]) {
      // Arms reach for the player: pivot at the shoulder, forearm from the elbow.
      const shoulder = this.joint(
        scene, 'shoulder', new Vector3(side * 0.26, 0.52, 0.06), torso,
        0.18, side > 0 ? 0 : Math.PI, new Vector3(-1.15, 0, side * -0.12),
      );
      const upper = this.part(scene, 'capsule', 'upperarm', { h: 0.42, dia: 0.11 }, shoulder, true);
      upper.position.y = -0.2;
      const elbow = this.joint(
        scene, 'elbow', new Vector3(0, -0.4, 0), shoulder,
        0.12, side > 0 ? 1.1 : 1.1 + Math.PI, new Vector3(-0.35, 0, 0),
      );
      const fore = this.part(scene, 'capsule', 'forearm', { h: 0.38, dia: 0.09 }, elbow, true);
      fore.position.y = -0.18;
      const hand = this.part(scene, 'sphere', 'hand', { dia: 0.11 }, elbow, true);
      hand.position.y = -0.4;

      // Legs: one drags. The asymmetry (different amp per side) IS the limp.
      const hip = this.joint(
        scene, 'hip', new Vector3(side * 0.13, -0.18, 0), torso,
        side > 0 ? 0.5 : 0.28, side > 0 ? 0 : Math.PI, new Vector3(-this.torsoRest, 0, 0),
      );
      const thigh = this.part(scene, 'capsule', 'thigh', { h: 0.46, dia: 0.15 }, hip, true);
      thigh.position.y = -0.22;
      // Torn trousers below the knee.
      const shin = this.part(scene, 'capsule', 'shin', { h: 0.44, dia: 0.12 }, hip, false);
      shin.position.y = -0.62;
    }
  }

  // ---------- the crawler: fast, low, wrong ----------
  // A human frame moving on all fours faster than it should. Body slung
  // horizontal, head craned up to face the player, limbs splayed wide and
  // skittering. Its silhouette must never be mistaken for the shambler's.
  private buildCrawler(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 0.42;
    this.torso = torso;
    this.torsoRest = 0;
    this.swayAmp = 0.1; // frantic little roll

    const body = this.part(scene, 'capsule', 'body', { h: 0.95, dia: 0.34 }, torso, true);
    body.rotation.x = Math.PI / 2; // slung horizontal, spine toward the player

    const head = this.part(scene, 'sphere', 'head', { dia: 0.26 }, torso, true);
    head.position.set(0, 0.14, 0.55); // craned up off the front of the body
    const jaw = this.part(scene, 'box', 'jaw', { w: 0.14, h: 0.08, d: 0.16 }, torso, false);
    jaw.position.set(0, 0.04, 0.62);

    // Four limbs, splayed like a spider wearing a person. Diagonal pairs
    // move together (a trot), which is what reads as skittering.
    for (const front of [1, -1]) {
      for (const side of [-1, 1]) {
        const diag = front * side > 0 ? 0 : Math.PI;
        const limb = this.joint(
          scene, 'limb', new Vector3(side * 0.22, -0.04, front * 0.32), torso,
          0.55, diag, new Vector3(0.35 * front, 0, side * 0.85),
        );
        const seg = this.part(scene, 'capsule', 'limbseg', { h: 0.5, dia: 0.1 }, limb, true);
        seg.position.y = -0.22;
        const claw = this.part(scene, 'box', 'claw', { w: 0.09, h: 0.1, d: 0.16 }, limb, false);
        claw.position.y = -0.46;
      }
    }
  }

  // ---------- the brute: a door in the shape of a man ----------
  // Massive trapezoidal torso, arms like girders ending in garb-dark fists,
  // head sunk between the shoulders. Moves slowly; the sway is the weight.
  private buildBrute(scene: Scene): void {
    const torso = new TransformNode('torso', scene);
    torso.parent = this.root;
    torso.position.y = 1.45;
    this.torso = torso;
    this.torsoRest = 0.12;
    torso.rotation.x = this.torsoRest;
    this.swayAmp = 0.14; // side-to-side mass, slow

    const chest = this.part(scene, 'box', 'chest', { w: 0.95, h: 0.85, d: 0.5 }, torso, true);
    chest.position.y = 0.42;
    const gut = this.part(scene, 'box', 'gut', { w: 0.78, h: 0.5, d: 0.44 }, torso, true);
    gut.position.y = -0.15;
    // Armour plates / slabbed shoulders: garb, so the red highlight shows a
    // body under the bulk instead of painting the whole wall.
    for (const side of [-1, 1]) {
      const pauldron = this.part(scene, 'box', 'pauldron', { w: 0.34, h: 0.3, d: 0.55 }, torso, false);
      pauldron.position.set(side * 0.62, 0.78, 0);
    }

    const head = this.part(scene, 'sphere', 'head', { dia: 0.32 }, torso, true);
    head.position.set(0, 0.92, 0.14); // sunk low, pushed forward

    for (const side of [-1, 1]) {
      const shoulder = this.joint(
        scene, 'shoulder', new Vector3(side * 0.68, 0.6, 0), torso,
        0.3, side > 0 ? Math.PI : 0, new Vector3(-0.25, 0, side * -0.18),
      );
      const arm = this.part(scene, 'capsule', 'arm', { h: 0.85, dia: 0.26 }, shoulder, true);
      arm.position.y = -0.4;
      const fist = this.part(scene, 'box', 'fist', { w: 0.3, h: 0.3, d: 0.3 }, shoulder, false);
      fist.position.y = -0.95;

      const hip = this.joint(
        scene, 'hip', new Vector3(side * 0.28, -0.42, 0), torso,
        0.32, side > 0 ? 0 : Math.PI, new Vector3(-this.torsoRest, 0, 0),
      );
      const leg = this.part(scene, 'capsule', 'leg', { h: 0.95, dia: 0.3 }, hip, true);
      leg.position.y = -0.45;
    }
  }

  // ---------- behaviour ----------
  setActive(on: boolean): void {
    const mat = on ? this.mats.active : this.mats.base;
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

export function buildCreature(scene: Scene, kind: EnemyKind, mats: CreatureMaterials): Creature {
  return new CreatureImpl(scene, kind, mats);
}
