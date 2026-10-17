import { describe, expect, it } from 'vitest';
import { G, type Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';

// a 2 m, 10 kg rod lying horizontal from x = 0 to 2, held at x = 0 (weld: cantilever; pin: released from rest)
const rod = (hold: 'weld' | 'pin'): Mechanism => ({
  bodies: [
    { name: 'barra', mass: 10, inertia: (10 * 4) / 12, pos: [1, 5], angle: 0, shape: { kind: 'rod', length: 2 } },
    { name: 'pedra', mass: 1, inertia: 1e-3, pos: [0, 100], angle: 0, shape: { kind: 'disk', radius: 0.05 } }, // unused, far away
  ],
  joints: [hold === 'weld' ? { kind: 'weld', a: 0, pa: [-1, 0], b: 'ground', pb: [0, 5], angle: 0 } : { kind: 'pin', a: 0, pa: [-1, 0], b: 'ground', pb: [0, 5] }],
  projectile: 1, sling: 0, axle: 0, releaseAngle: -Infinity, air: { density: 0, cd: 0 },
});

describe('flexão no braço', () => {
  it('balanço parado: momento na raiz = m·g·L/2', () => {
    const r = simulate(rod('weld'), { tMax: 0.01, frameEvery: 1 });
    expect(r.peakBending!.moment).toBeCloseTo((10 * G * 2) / 2, 1);
    expect(r.peakBending!.fromAxle).toBeCloseTo(0, 6);
  });

  it('barra articulada solta da horizontal: máximo m·g·L/27, a L/3 do pino', () => {
    const r = simulate(rod('pin'), { tMax: 0.002, frameEvery: 1 });
    expect(r.peakBending!.moment).toBeCloseTo((10 * G * 2) / 27, 1);
    expect(r.peakBending!.fromAxle).toBeCloseTo(2 / 3, 1);
  });
});
