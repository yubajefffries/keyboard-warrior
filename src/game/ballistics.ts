import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

/** Fixed-size pools: fast typing never allocates geometry or drops the previous shot. */
export class Ballistics {
  private cursor = 0;
  private shots;
  constructor(scene: Scene) {
    const material = new StandardMaterial('ballistics.amber', scene);
    material.disableLighting = true;
    material.emissiveColor = new Color3(1, 0.64, 0.18);
    material.freeze();
    this.shots = Array.from({ length: 12 }, (_, index) => {
      const beam = MeshBuilder.CreateBox(`round.${index}`, { width: 0.025, height: 0.025, depth: 1 }, scene);
      const sparks = Array.from({ length: 5 }, (_, i) => {
        const mesh = MeshBuilder.CreateBox(`spark.${index}.${i}`, { size: 0.045 }, scene);
        mesh.material = material;
        mesh.isPickable = false;
        mesh.setEnabled(false);
        return mesh;
      });
      beam.material = material;
      beam.isPickable = false;
      beam.setEnabled(false);
      return { beam, sparks, age: -1, from: new Vector3(), to: new Vector3(), lethal: false };
    });
  }
  fire(from: Vector3, to: Vector3, lethal = false): void {
    const shot = this.shots[this.cursor++ % this.shots.length];
    shot.from.copyFrom(from);
    shot.to.copyFrom(to);
    shot.age = 0;
    shot.lethal = lethal;
    shot.beam.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5);
    const direction = to.subtract(from);
    shot.beam.scaling.z = direction.length();
    shot.beam.setDirection(direction.normalize());
    shot.beam.setEnabled(true);
    for (const spark of shot.sparks) {
      spark.position.copyFrom(to);
      spark.setEnabled(true);
    }
  }
  tick(dt: number, motion: number): void {
    for (const shot of this.shots) {
      if (shot.age < 0) continue;
      shot.age += dt;
      shot.beam.setEnabled(shot.age < 0.055);
      const duration = shot.lethal ? 0.42 : 0.2;
      for (let i = 0; i < shot.sparks.length; i++) {
        const spark = shot.sparks[i];
        const angle = i * Math.PI * 2 / shot.sparks.length;
        const travel = shot.age * (shot.lethal ? 4 : 1.8) * motion;
        spark.position.set(shot.to.x + Math.cos(angle) * travel, shot.to.y + Math.sin(angle) * travel - shot.age * shot.age * 3, shot.to.z + travel * 0.5);
        spark.scaling.setAll(Math.max(0, 1 - shot.age / duration) * (shot.lethal ? 2.5 : 1));
        spark.setEnabled(shot.age < duration);
      }
      if (shot.age >= duration) shot.age = -1;
    }
  }
  clear(): void {
    for (const shot of this.shots) {
      shot.age = -1;
      shot.beam.setEnabled(false);
      for (const spark of shot.sparks) spark.setEnabled(false);
    }
  }
}
