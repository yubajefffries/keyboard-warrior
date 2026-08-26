/**
 * Machine contract tests (PRD 8 art pass, PRD 22 photosensitivity).
 *
 * These run against Babylon's NullEngine: no canvas, no GPU, real scene
 * graph. They pin the contract the encounter relies on -- active-target
 * highlighting, disposal, stable animation, intensity repaint -- not how
 * the machines look. The look is judged by Jeff in a browser (the
 * /harness/creatures.html viewer), like every art call.
 */
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import {
  applyCreatureIntensity,
  buildCreature,
  makeCreatureMaterialSet,
  type CreatureMaterialSet,
} from '../src/game/creatures';
import type { EnemyKind } from '../src/game/scoring';

const KINDS: EnemyKind[] = ['standard', 'crawler', 'brute'];

function setup(): { scene: Scene; mats: CreatureMaterialSet } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { scene, mats: makeCreatureMaterialSet(scene) };
}

function partsOf(scene: Scene, root: { name: string }): Mesh[] {
  return scene.meshes.filter((m) => {
    let n = m.parent;
    while (n) {
      if (n.name === root.name) return true;
      n = n.parent;
    }
    return false;
  }) as Mesh[];
}

describe('machine construction', () => {
  it('every kind has hull, frame, a glowing core, and glowing eyes; nothing pickable', () => {
    for (const kind of KINDS) {
      const { scene, mats } = setup();
      const c = buildCreature(scene, kind, mats);
      const parts = partsOf(scene, c.root);
      expect(parts.length, kind).toBeGreaterThanOrEqual(10);
      expect(parts.some((m) => m.material === mats[kind]), `${kind} hull`).toBe(true);
      expect(parts.some((m) => m.material === mats.frame), `${kind} frame`).toBe(true);
      expect(parts.some((m) => m.material === mats.core), `${kind} core`).toBe(true);
      expect(parts.filter((m) => m.material === mats.eye).length, `${kind} eyes`).toBe(2);
      expect(parts.every((m) => !m.isPickable), `${kind} pickable`).toBe(true);
    }
  });

  it('kinds are silhouette-distinct: the mech towers over the hound, the spider stays low', () => {
    const { scene, mats } = setup();
    const tops = new Map<EnemyKind, number>();
    for (const kind of KINDS) {
      const c = buildCreature(scene, kind, mats);
      c.animate(0.016, 1); // settle rotations off rest pose
      let top = 0;
      for (const m of partsOf(scene, c.root)) {
        m.computeWorldMatrix(true);
        top = Math.max(top, m.getBoundingInfo().boundingBox.maximumWorld.y);
      }
      tops.set(kind, top);
      c.dispose();
    }
    expect(tops.get('crawler')!).toBeLessThan(0.9); // the spider hugs the floor
    expect(tops.get('standard')!).toBeGreaterThan(tops.get('crawler')!); // the hound stands over it
    expect(tops.get('standard')!).toBeLessThan(1.8); // but stays dog-sized
    expect(tops.get('brute')!).toBeGreaterThan(2.0); // the mech is a wall
    expect(tops.get('brute')!).toBeGreaterThan(tops.get('standard')!);
  });
});

describe('active-target highlight (PRD 6)', () => {
  it('setActive swaps hull to the active material and back; frame, core, eyes untouched', () => {
    const { scene, mats } = setup();
    const c = buildCreature(scene, 'standard', mats);
    const parts = partsOf(scene, c.root);
    const hullCount = parts.filter((m) => m.material === mats.standard).length;
    const fixedCount = parts.filter(
      (m) => m.material === mats.frame || m.material === mats.core || m.material === mats.eye,
    ).length;

    c.setActive(true);
    expect(parts.filter((m) => m.material === mats.active).length).toBe(hullCount);
    expect(
      parts.filter((m) => m.material === mats.frame || m.material === mats.core || m.material === mats.eye).length,
    ).toBe(fixedCount);

    c.setActive(false);
    expect(parts.filter((m) => m.material === mats.standard).length).toBe(hullCount);
    expect(parts.filter((m) => m.material === mats.active).length).toBe(0);
  });

  it('reset hands back a fresh body for pooled reuse', () => {
    const { scene, mats } = setup();
    const c = buildCreature(scene, 'brute', mats);
    const parts = partsOf(scene, c.root);
    const hullCount = parts.filter((m) => m.material === mats.brute).length;
    c.setActive(true);
    c.stagger();
    c.reset();
    expect(parts.filter((m) => m.material === mats.brute).length).toBe(hullCount);
    expect(parts.filter((m) => m.material === mats.active).length).toBe(0);
  });
});

describe('health bar (armor readout)', () => {
  it('hidden at full, shows and depletes per hit, hides on death and reset', () => {
    const { scene, mats } = setup();
    const c = buildCreature(scene, 'brute', mats);
    const parts = partsOf(scene, c.root);
    const back = parts.find((m) => m.material === mats.barBack)!;
    const fill = parts.find((m) => m.material === mats.barFill)!;
    expect(back).toBeDefined();
    expect(fill).toBeDefined();
    expect(back.isEnabled(false)).toBe(false); // untouched machines wear no bar

    c.setHealth(2 / 3); // the mech takes its first of three words
    expect(back.isEnabled(false)).toBe(true);
    expect(fill.scaling.x).toBeCloseTo(2 / 3);
    c.setHealth(1 / 3);
    expect(fill.scaling.x).toBeCloseTo(1 / 3);
    // Depleting must pin the left edge (drain rightward), not shrink centered.
    expect(fill.position.x).toBeLessThan(0);

    c.setHealth(0); // dead: the bar goes with it
    expect(back.isEnabled(false)).toBe(false);
    c.setHealth(0.5);
    c.reset(); // pooled reuse hands back a fresh, unhurt machine
    expect(back.isEnabled(false)).toBe(false);
  });

  it('the highlight swap never touches the bar', () => {
    const { scene, mats } = setup();
    const c = buildCreature(scene, 'standard', mats);
    c.setHealth(0.5);
    c.setActive(true);
    const parts = partsOf(scene, c.root);
    expect(parts.some((m) => m.material === mats.barFill)).toBe(true);
    expect(parts.some((m) => m.material === mats.barBack)).toBe(true);
  });
});

describe('intensity (PRD 21/22)', () => {
  it('low intensity dims hull, target glow, and the sensor eyes; full restores them', () => {
    const { mats } = setup();
    const fullEye = mats.eye.emissiveColor.clone();
    const fullHull = mats.standard.diffuseColor.clone();
    const fullGlow = mats.active.emissiveColor.clone();

    applyCreatureIntensity(mats, true);
    expect(mats.eye.emissiveColor.r).toBeLessThan(fullEye.r / 5);
    expect(mats.standard.diffuseColor.g).toBeLessThan(fullHull.g);
    expect(mats.active.emissiveColor.r).toBeLessThan(fullGlow.r);

    applyCreatureIntensity(mats, false);
    expect(mats.eye.emissiveColor.r).toBeCloseTo(fullEye.r);
    expect(mats.standard.diffuseColor.g).toBeCloseTo(fullHull.g);
    expect(mats.active.emissiveColor.r).toBeCloseTo(fullGlow.r);
  });
});

describe('animation (PRD 22: smooth, never a strobe)', () => {
  it('limbs move over time and every rotation stays finite', () => {
    for (const kind of KINDS) {
      const { scene, mats } = setup();
      const c = buildCreature(scene, kind, mats);
      const nodes = scene.transformNodes.filter((n) => n !== c.root);
      const before = nodes.map((n) => n.rotation.x);

      // Simulate 10 seconds at 60fps, including a stagger partway through.
      let moved = false;
      for (let i = 0; i < 600; i++) {
        if (i === 300) c.stagger();
        c.animate(1 / 60, 1);
        nodes.forEach((n, j) => {
          expect(Number.isFinite(n.rotation.x), `${kind} rot.x`).toBe(true);
          expect(Number.isFinite(n.rotation.z), `${kind} rot.z`).toBe(true);
          if (Math.abs(n.rotation.x - before[j]) > 0.01) moved = true;
        });
      }
      expect(moved, `${kind} should animate`).toBe(true);
    }
  });

  it('motion reduction scales the swing down, not off-balance', () => {
    const { scene, mats } = setup();
    const full = buildCreature(scene, 'standard', mats);
    const reduced = buildCreature(scene, 'standard', mats);
    const swing = (c: typeof full, motion: number): number => {
      const nodes = scene.transformNodes.filter((n) => {
        let p = n.parent;
        while (p) {
          if (p === c.root) return true;
          p = p.parent;
        }
        return false;
      });
      const rest = nodes.map((n) => n.rotation.x);
      let max = 0;
      for (let i = 0; i < 240; i++) {
        c.animate(1 / 60, motion);
        nodes.forEach((n, j) => (max = Math.max(max, Math.abs(n.rotation.x - rest[j]))));
      }
      return max;
    };
    expect(swing(reduced, 0.25)).toBeLessThan(swing(full, 1));
  });
});

describe('disposal', () => {
  it('dispose removes every part and leaves the shared materials alone', () => {
    const { scene, mats } = setup();
    const before = scene.meshes.length;
    const c = buildCreature(scene, 'brute', mats);
    expect(scene.meshes.length).toBeGreaterThan(before);
    c.dispose();
    expect(scene.meshes.length).toBe(before);
    expect(scene.materials).toContain(mats.brute);
    expect(scene.materials).toContain(mats.active);
    expect(scene.materials).toContain(mats.frame);
    expect(scene.materials).toContain(mats.eye);
  });
});
