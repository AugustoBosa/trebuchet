import { describe, expect, it } from 'vitest';
import { G, type Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor } from '../src/presets';

describe('mola', () => {
  it('massa pendurada numa mola oscila com período 2π√(m/k)', () => {
    const k = 100, mass = 1, rest = 1;
    const y0 = 10 - rest - (mass * G) / k - 0.05; // 5 cm below equilibrium
    const m: Mechanism = {
      bodies: [
        { name: 'massa', mass, inertia: 1e-3, pos: [0, y0], angle: 0, shape: { kind: 'disk', radius: 0.05 } },
        { name: 'projétil', mass: 1e-3, inertia: 1e-9, pos: [5, 50], angle: 0, shape: { kind: 'disk', radius: 0.01 } },
      ],
      joints: [{ kind: 'rope', a: 1, pa: [0, 0], b: 'ground', pb: [5, 51], length: 1 }], // parked projectile
      springs: [{ body: 0, local: [0, 0], anchor: [0, 10], k, rest }],
      projectile: 1, sling: 0, axle: 0, releaseAngle: -Infinity, air: { density: 0, cd: 0 },
    };
    const T = 2 * Math.PI * Math.sqrt(mass / k);
    const r = simulate(m, { tMax: 2.5 * T, frameEvery: 1 });
    const ys = r.frames.map((f) => f.q[1]);
    const lows = r.frames.filter((f, i) => i > 0 && i < ys.length - 1 && ys[i] < ys[i - 1] && ys[i] <= ys[i + 1]).map((f) => f.t);
    expect(lows[1] - lows[0]).toBeCloseTo(T, 3);
    const e = r.frames.map((f) => f.ke + f.pe); // pe includes the spring's ½k·x²
    expect(Math.max(...e) - Math.min(...e)).toBeLessThan(1e-6);
  });

  it('trebuchet de mola: com a mesma energia do articulado, mais eficiente e mais rápido', () => {
    const s = simulate(build('spring', defaultsFor('spring')), { afterRelease: 0 });
    const h = simulate(build('hinged', defaults), { afterRelease: 0 });
    expect(s.error).toBeUndefined();
    expect(Math.abs(s.inputEnergy - h.inputEnergy) / h.inputEnergy).toBeLessThan(0.05);
    expect(s.efficiency).toBeGreaterThan(h.efficiency);
    expect(s.release!.t).toBeLessThan(0.7 * h.release!.t);
  });
});
