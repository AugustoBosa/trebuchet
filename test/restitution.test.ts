import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { lift } from '../src/physics3d/lift';
import { simulate3 } from '../src/physics3d/solver3';

// a ball dropped on the floor: rebound height e²·h (2D and 3D solvers)
const drop = (e: number): Mechanism => ({
  bodies: [{ name: 'bola', mass: 1, inertia: 0.004, pos: [0, 1.1], angle: 0, shape: { kind: 'disk', radius: 0.1 } }],
  joints: [{ kind: 'floor', a: 0, pa: [0, 0], y: 0.1 }],
  projectile: 0, sling: 0, axle: 0, releaseAngle: -Infinity, air: { density: 0, cd: 0 }, restitution: e,
});
const apex = (ys: number[]) => {
  const hit = ys.findIndex((y, i) => i > 0 && y < ys[i - 1] && y <= ys[i + 1]); // first landing: the first lowest point
  return Math.max(...ys.slice(hit + 1)) - 0.1; // highest point after the first landing (the rebound; 1.2 s is too short for a second one to top it)
};

describe('restituição nos impactos', () => {
  it.each([0, 0.5, 0.8])('bola caindo 1 m com e = %s sobe de volta e²·h', (e) => {
    const r2 = simulate(drop(e), { tMax: 1.2, frameEvery: 1, dt: 1e-4 });
    const r3 = simulate3(lift(drop(e)), { tMax: 1.2, frameEvery: 1, dt: 1e-4 });
    const h2 = apex(r2.frames.map((f) => f.q[1]));
    const h3 = apex(r3.frames.map((f) => f.q[1]));
    expect(h2).toBeCloseTo(e * e, 2);
    expect(h3).toBeCloseTo(h2, 9);
  });
});
