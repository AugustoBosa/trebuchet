import { describe, expect, it } from 'vitest';
import { G, type Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { lift } from '../src/physics3d/lift';
import { simulate3 } from '../src/physics3d/solver3';

// a block sliding on the floor at 3 m/s with μ = 0.3 stops after v0²/(2μg)
const block: Mechanism = {
  bodies: [{ name: 'bloco', mass: 2, inertia: 0.01, pos: [0, 0.1], angle: 0, shape: { kind: 'disk', radius: 0.1 } }],
  joints: [{ kind: 'floor', a: 0, pa: [0, 0], y: 0.1, mu: 0.3 }],
  projectile: 0, sling: 0, axle: 0, releaseAngle: -Infinity, air: { density: 0, cd: 0 },
};
const stop = (9 / (2 * 0.3 * G));

describe('atrito resolvido junto com as restrições', () => {
  it('bloco deslizando para em v0²/(2μg), nos dois solvers', () => {
    const r2 = simulate(block, { tMax: 1.5, frameEvery: 100, v0: Float64Array.from([3, 0, 0]) });
    const r3 = simulate3(lift(block), { tMax: 1.5, frameEvery: 100, v0: Float64Array.from([3, 0, 0, 0, 0, 0]) });
    expect(r2.frames.at(-1)!.q[0]).toBeCloseTo(stop, 2);
    expect(r3.frames.at(-1)!.q[0]).toBeCloseTo(r2.frames.at(-1)!.q[0], 9);
  });
});
