import { describe, expect, it } from 'vitest';
import { buildFiffer } from '../src/fiffer';
import { simulate } from '../src/physics/solver';
import { defaultsFor } from '../src/presets';

// Reference: the inventors' own simulator (treygreer/treb, first_in_fright_2013.py), run with a rigid frame, 2026
// configuration: 4581 lb counterweight, 8 lb pumpkin, 11 oz sling, 9 oz at the tip, sling 9.54 ft, release at 30°.
// It releases at t = 0.6783 s with the pumpkin at 119.3 m/s. (With the original's soft damped front foot it loses
// ~8 % of the energy and reads 0.6835 s / 116.0 m/s / ~2,170 ft, the README's numbers.)
describe('Fiffer contra o simulador dos inventores', () => {
  const p = { ...defaultsFor('fiffer'), projMass: 8 * 0.45359, slingLength: 9.54 * 0.3048, releaseDeg: 30 };
  const m = buildFiffer(p, { slingLB: 11 / 16, pinLB: 9, tipLB: 9 / 16 });
  const r = simulate(m, { afterRelease: 0, frameEvery: 1 });

  it('massa e inércia do braço, e o contrapeso, como no original', () => {
    const [a, , s, cw] = m.bodies, ramp = m.bodies[7];
    expect(a.mass + s.mass).toBeCloseTo(90.58, 1);
    expect(cw.mass + ramp.mass).toBeCloseTo(p.cwMass, 6); // the box + its 5 kg ramp = the counterweight
    expect(p.cwMass).toBeCloseTo(2077.9, 1);
  });

  it('solta no mesmo instante e com a mesma velocidade', () => {
    expect(r.error).toBeUndefined();
    expect(r.release!.t).toBeGreaterThan(0.6783 * 0.995);
    expect(r.release!.t).toBeLessThan(0.6783 * 1.005);
    expect(Math.abs(r.release!.speed - 119.3) / 119.3).toBeLessThan(0.02);
  });

  it('a energia total se conserva (≤ 1 %)', () => {
    const e0 = r.frames[0].ke + r.frames[0].pe, e1 = r.frames.at(-1)!.ke + r.frames.at(-1)!.pe;
    expect(Math.abs(e1 - e0) / (r.inputEnergy + 1)).toBeLessThan(0.02);
    expect(r.dissipated / r.inputEnergy).toBeLessThan(0.02);
  });
});

describe('Fiffer, preset', () => {
  it('2012 de fábrica: alcance entre 1.900 e 2.500 pés, no ponto certo do braço', () => {
    const r = simulate(buildFiffer(defaultsFor('fiffer')), { afterRelease: 0 });
    expect(r.error).toBeUndefined();
    expect(r.range / 0.3048).toBeGreaterThan(1900);
    expect(r.range / 0.3048).toBeLessThan(2500);
  });
});
