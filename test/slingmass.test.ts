import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { lift } from '../src/physics3d/lift';
import { simulate3 } from '../src/physics3d/solver3';
import { build, defaultsFor } from '../src/presets';
import { compile, sanitizeSketch, toSketch } from '../src/sketch';

// The sling's pouch and cords swing with the stone and stay in the sling at release.
describe('funda com massa', () => {
  const p = { ...defaultsFor('hinged'), projMass: 10 };
  const shot = (q: Partial<typeof p>) => simulate(build('hinged', { ...p, ...q }), { afterRelease: 0 });

  it('no vácuo: uma bolsa de 1 kg lança a pedra de 10 kg como uma pedra de 11 kg, mas a energia da bolsa não conta', () => {
    const vac = { airDensity: 0 };
    const pouch = shot({ ...vac, slingMass: 1 }), heavy = shot({ ...vac, projMass: 11 });
    expect(pouch.release!.t).toBeCloseTo(heavy.release!.t, 9);
    expect(pouch.range).toBeCloseTo(heavy.range, 6); // a vacuum flight doesn't depend on the mass
    expect(pouch.efficiency / heavy.efficiency).toBeCloseTo(10 / 11, 9);
    expect(pouch.range).toBeLessThan(shot(vac).range);
  });

  it('no ar: a pedra voa sozinha, então freia mais que uma pedra com a massa da bolsa somada', () => {
    const pouch = shot({ slingMass: 1 }), heavy = shot({ projMass: 11 });
    expect(pouch.release!.speed).toBeCloseTo(heavy.release!.speed, 2); // same swing (the pre-release drag acts on the same stone)
    expect(pouch.range).toBeLessThan(heavy.range);
  });

  it('editor livre: o esboço do preset guarda a bolsa e dá o mesmo tiro, também depois de salvo e lido', () => {
    const m = build('hinged', { ...p, slingMass: 1 });
    const sk = toSketch(m, { troughMu: p.troughMu });
    expect(sk.slingMass).toBe(1);
    expect(sk.bodies[m.projectile].mass).toBeCloseTo(10, 9); // the disk is the stone
    const r = simulate(m, { afterRelease: 0 });
    for (const s of [sk, sanitizeSketch(JSON.parse(JSON.stringify(sk)))]) {
      const c = simulate(compile(s), { afterRelease: 0 });
      expect(Math.abs(c.range - r.range) / r.range).toBeLessThan(0.005);
      expect(c.efficiency).toBeCloseTo(r.efficiency, 3);
    }
  });

  it('o solver 3D faz o mesmo', () => {
    const m = build('hinged', { ...p, slingMass: 1 });
    const [r2, r3] = [simulate(m, { afterRelease: 0 }), simulate3(lift(m), { afterRelease: 0 })];
    expect(Math.abs(r3.range - r2.range) / r2.range).toBeLessThan(0.005);
    expect(Math.abs(r3.efficiency - r2.efficiency)).toBeLessThan(0.005);
  });
});
