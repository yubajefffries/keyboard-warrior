import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ballistics } from '../src/game/ballistics';

describe('rapid-fire effect lifecycle', () => {
  it('keeps geometry bounded under 1000 shots and clears every effect for low intensity', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const fx = new Ballistics(scene);
    const count = scene.meshes.length;
    for (let i = 0; i < 1000; i++) {
      fx.fire(new Vector3(0, 1, 0), new Vector3(1, 1, -20), i % 3 === 0);
      fx.tick(0.01, 1);
    }
    expect(scene.meshes.length).toBe(count);
    expect(scene.meshes.some(m => m.isEnabled())).toBe(true);
    fx.clear();
    expect(scene.meshes.every(m => !m.isEnabled())).toBe(true);
    engine.dispose();
  });
  it('lets overlapping impacts finish and expires all geometry', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const fx = new Ballistics(scene);
    fx.fire(Vector3.Zero(), new Vector3(0, 1, -10), true);
    fx.tick(0.06, 0.25);
    fx.fire(Vector3.Zero(), new Vector3(2, 1, -10));
    expect(scene.meshes.filter(m => m.isEnabled()).length).toBeGreaterThan(6);
    fx.tick(0.5, 0.25);
    expect(scene.meshes.every(m => !m.isEnabled())).toBe(true);
    engine.dispose();
  });
});
