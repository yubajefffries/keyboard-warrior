/**
 * Creature contract tests (PRD 8 art pass, PRD 22 photosensitivity).
 *
 * These run against Babylon's NullEngine: no canvas, no GPU, real scene
 * graph. They pin the contract the encounter relies on -- active-target
 * highlighting, disposal, stable animation -- not how the monsters look.
 * The look is judged by Jeff in a browser, like every art call.
 */
import { describe, it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { buildCreature, makeGarbMaterial, type CreatureMaterials } from '../src/game/creatures';
import type { EnemyKind } from '../src/game/scoring';

const KINDS: EnemyKind[] = ['standard', 'crawler', 'brute'];

function setup(): { scene: Scene; mats: CreatureMaterials } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const base = new StandardMaterial('base', scene);
  base.diffuseColor = new Color3(0.4, 0.3, 0.3);
  const active = new StandardMaterial('active', scene);
  active.emissiveColor = new Color3(0.45, 0.08, 0.08);
  return { scene, mats: { base, active, garb: makeGarbMaterial(scene) } };
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

describe('creature construction', () => {
  it('every kind builds a multi-part body with flesh and garb, nothing pickable', () => {
    for (const kind of KINDS) {
      const { scene, mats } = setup();
      const c = buildCreature(scene, kind, mats);
      const parts = partsOf(scene, c.root);
      expect(parts.length, kind).toBeGreaterThanOrEqual(6);
      expect(parts.some((m) => m.material === mats.base), `${kind} flesh`).toBe(true);
      expect(parts.some((m) => m.material === mats.garb), `${kind} garb`).toBe(true);
      expect(parts.every((m) => !m.isPickable), `${kind} pickable`).toBe(true);
    }
  });

  it('kinds are silhouette-distinct: brute towers over the shambler, crawler stays low', () => {
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
    expect(tops.get('crawler')!).toBeLessThan(1.0);
    expect(tops.get('standard')!).toBeGreaterThan(1.4);
    expect(tops.get('brute')!).toBeGreaterThan(tops.get('standard')!);
  });
});

describe('active-target highlight (PRD 6)', () => {
  it('setActive swaps flesh to the active material and back, garb untouched', () => {
    const { scene, mats } = setup();
    const c = buildCreature(scene, 'standard', mats);
    const parts = partsOf(scene, c.root);
    const fleshCount = parts.filter((m) => m.material === mats.base).length;
    const garbCount = parts.filter((m) => m.material === mats.garb).length;

    c.setActive(true);
    expect(parts.filter((m) => m.material === mats.active).length).toBe(fleshCount);
    expect(parts.filter((m) => m.material === mats.garb).length).toBe(garbCount);

    c.setActive(false);
    expect(parts.filter((m) => m.material === mats.base).length).toBe(fleshCount);
    expect(parts.filter((m) => m.material === mats.active).length).toBe(0);
  });

  it('reset hands back a fresh body for pooled reuse', () => {
    const { scene, mats } = setup();
    const c = buildCreature(scene, 'brute', mats);
    const parts = partsOf(scene, c.root);
    const fleshCount = parts.filter((m) => m.material === mats.base).length;
    c.setActive(true);
    c.stagger();
    c.reset();
    expect(parts.filter((m) => m.material === mats.base).length).toBe(fleshCount);
    expect(parts.filter((m) => m.material === mats.active).length).toBe(0);
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
    expect(scene.materials).toContain(mats.base);
    expect(scene.materials).toContain(mats.active);
    expect(scene.materials).toContain(mats.garb);
  });
});
