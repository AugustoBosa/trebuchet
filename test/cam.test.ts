import { describe, expect, it } from 'vitest';
import { camRope } from '../src/physics/constraints';
import { G, type Cam, type Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor } from '../src/presets';

// Balanced wheel (rod pinned at its center) with a counterweight hanging from a drum on it; a token projectile
// rides along so the solver has one. Constant radius r → Atwood machine: α = M g r / (I + M r²).
function drum(r0: number, r1: number, span: number, floorY = -100): Mechanism {
  const I = 50;
  const M = 100;
  const cam: Cam = { kind: 'cam', a: 1, b: 0, hub: [0, 0], theta0: 0, r0, r1, span, length: 0 };
  cam.length = 10 - 8; // hub y − counterweight y: taut at rest
  return {
    bodies: [
      { name: 'roda', mass: 20, inertia: I, pos: [0, 10], angle: 0, shape: { kind: 'rod', length: 2 } },
      { name: 'contrapeso', mass: M, inertia: 1, pos: [-r0, 8], angle: 0, shape: { kind: 'disk', radius: 0.2 } },
      { name: 'projétil', mass: 1e-3, inertia: 1e-9, pos: [5, 50], angle: 0, shape: { kind: 'disk', radius: 0.01 } },
    ],
    joints: [
      { kind: 'pin', a: 0, pa: [0, 0], b: 'ground', pb: [0, 10] },
      cam,
      { kind: 'floor', a: 1, pa: [0, 0], y: floorY },
      { kind: 'rope', a: 2, pa: [0, 0], b: 'ground', pb: [5, 51], length: 1 }, // parked projectile
    ],
    projectile: 2, counterweight: 1, sling: 3, axle: 0,
    releaseAngle: -Infinity, air: { density: 0, cd: 0 },
  };
}

describe('tambor espiral (MURLIN / roda)', () => {
  it('raio constante = máquina de Atwood: ω(t) = α·t com α = M g r / (I + M r²)', () => {
    const r = 0.5;
    const res = simulate(drum(r, r, 100), { tMax: 1, frameEvery: 1, afterRelease: 0 });
    const alpha = (100 * G * r) / (50 + 100 * r * r);
    const f = res.frames.at(-1)!;
    // θ = −½αt² (turns clockwise); counterweight drops r·|θ|
    expect(-f.q[2]).toBeCloseTo(0.5 * alpha * f.t * f.t, 4);
    expect(8 - f.q[4]).toBeCloseTo(r * -f.q[2], 4);
  });

  it('espiral: queda do contrapeso = ∫r dφ e a energia se conserva', () => {
    const m = drum(1, 0.2, 6);
    const res = simulate(m, { tMax: 1.5, frameEvery: 1, afterRelease: 0 });
    const cam = m.joints[1] as Cam;
    const e0 = res.frames[0].ke + res.frames[0].pe;
    for (const f of res.frames) {
      expect(8 - f.q[4]).toBeCloseTo(camRope(cam, -f.q[2]).F, 3);
      expect(Math.abs(f.ke + f.pe - e0) / (100 * G * 5)).toBeLessThan(1e-4);
    }
    expect(-res.frames.at(-1)!.q[2]).toBeGreaterThan(3); // it really turned well into the spiral
  });

  it('contrapeso pousa: a corda afrouxa e a roda segue girando (não é freada pela corda)', () => {
    // r1 = r0 = 0.5: lands at full speed after 2 m of drop
    const res = simulate(drum(0.5, 0.5, 100, 6.2), { tMax: 2, frameEvery: 1, afterRelease: 0 });
    const ws = res.frames.map((f, i) => (i ? (f.q[2] - res.frames[i - 1].q[2]) / (f.t - res.frames[i - 1].t) : 0));
    const land = res.frames.findIndex((f) => f.q[4] <= 6.2 + 1e-6);
    expect(land).toBeGreaterThan(0);
    expect(Math.abs(ws.at(-1)!)).toBeGreaterThan(0.99 * Math.abs(ws[land - 1])); // frictionless: keeps its speed
    expect(res.frames.at(-1)!.q[4]).toBeCloseTo(6.2, 2); // and the counterweight stays down
  });

  it('com metade do braço, MURLIN e roda vão mais longe que o articulado padrão (afirmação do fabricante)', () => {
    const hinged = simulate(build('hinged', defaults), { afterRelease: 0 }).range;
    for (const k of ['murlin', 'wheel'] as const) {
      const p = defaultsFor(k);
      expect(p.longArm).toBe(defaults.longArm / 2);
      const r = simulate(build(k, p), { afterRelease: 0 });
      expect(r.error, k).toBeUndefined();
      expect(r.range, k).toBeGreaterThan(hinged);
    }
  });
});
