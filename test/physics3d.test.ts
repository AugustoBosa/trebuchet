import { describe, expect, it } from 'vitest';
import { G } from '../src/physics/model';
import { fly3 } from '../src/physics3d/ballistics3';
import { dot, norm, rotate, rotateInv, sub, type Mechanism3, type V3 } from '../src/physics3d/model3';
import { simulate3 } from '../src/physics3d/solver3';

const still = { projectile: 0, sling: 0, axle: 0, releaseAngle: -Infinity, air: { density: 0, cd: 0 } };

describe('motor 3D', () => {
  it('pêndulo cônico: altura constante e período 2π√(L·cosα/g)', () => {
    const L = 2, a = 0.6, top: V3 = [0, 10, 0];
    const r = L * Math.sin(a);
    const m: Mechanism3 = {
      ...still,
      bodies: [{ name: 'bob', mass: 1, inertia: [1e-6, 1e-6, 1e-6], pos: [r, 10 - L * Math.cos(a), 0], quat: [1, 0, 0, 0], shape: { kind: 'disk', radius: 0.001 } }],
      joints: [{ kind: 'rope', a: 0, pa: [0, 0, 0], b: 'ground', pb: top, length: L }],
    };
    const v = Math.sqrt(G * r * Math.tan(a)); // centripetal = g·tanα
    const T = 2 * Math.PI * Math.sqrt((L * Math.cos(a)) / G);
    const res = simulate3(m, { tMax: 1.1 * T, frameEvery: 1, v0: Float64Array.from([0, 0, v, 0, 0, 0]) });
    const ys = res.frames.map((f) => f.q[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-6);
    // back to x > 0, z crossing 0 upward after one turn
    const back = res.frames.find((f, i) => f.t > T / 2 && res.frames[i - 1].q[2] < 0 && f.q[2] >= 0)!;
    expect(back.t).toBeCloseTo(T, 2);
  });

  it('corpo livre: conserva energia e momento angular, e vira em torno do eixo intermediário (Dzhanibekov)', () => {
    const I: V3 = [1, 2, 3];
    const m: Mechanism3 = { ...still, bodies: [{ name: 'porca', mass: 1, inertia: I, pos: [0, 100, 0], quat: [1, 0, 0, 0], shape: { kind: 'disk', radius: 0.1 } }], joints: [] };
    const res = simulate3(m, { tMax: 6, frameEvery: 1, v0: Float64Array.from([0, 0, 0, 0.01, 5, 0]) }); // spin about the intermediate axis
    const w = (f: (typeof res.frames)[number]): V3 => [f.v[3], f.v[4], f.v[5]];
    const L = (f: (typeof res.frames)[number]): V3 => { // world angular momentum R·I·Rᵀ·ω
      const l = rotateInv(f.q, 3, w(f));
      return rotate(f.q, 3, [l[0] * I[0], l[1] * I[1], l[2] * I[2]]);
    };
    const L0 = L(res.frames[0]);
    const erot = (f: (typeof res.frames)[number]) => 0.5 * dot(w(f), L(f));
    for (const f of res.frames) {
      expect(norm(sub(L(f), L0))).toBeLessThan(1e-6 * norm(L0));
      expect(Math.abs(erot(f) - erot(res.frames[0]))).toBeLessThan(1e-6 * erot(res.frames[0]));
    }
    const wy = res.frames.map((f) => rotateInv(f.q, 3, w(f))[1]); // spin seen from the body
    expect(Math.min(...wy)).toBeLessThan(-4); // it flipped over
  });

  it('vento lateral empurra o voo para o lado do vento; sem vento, nada', () => {
    const v0: V3 = [40, 40, 0];
    expect(fly3([0, 5, 0], v0, 0.002).lateral).toBe(0);
    const w = fly3([0, 5, 0], v0, 0.002, [0, 0, 5]);
    expect(w.lateral).toBeGreaterThan(1);
    expect(fly3([0, 5, 0], v0, 0.002, [0, 0, -5]).lateral).toBeCloseTo(-w.lateral, 9);
  });
});
