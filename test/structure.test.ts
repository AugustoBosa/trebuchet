import { describe, expect, it } from 'vitest';
import { BAR_MATS, barMat, section } from '../src/materials';
import { G, type Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { build, defaultsFor } from '../src/presets';
import { assess, byPart, ropeBreaking, strength } from '../src/structure';

describe('seções', () => {
  it('retângulo, tubo retangular e tubo redondo contra contas à mão', () => {
    const r = section({ shape: 'rect', b: 0.06, h: 0.16 });
    expect(r.A).toBeCloseTo(0.0096, 10);
    expect(r.W).toBeCloseTo((0.06 * 0.16 ** 2) / 6, 12);
    expect(r.Imin).toBeCloseTo((0.16 * 0.06 ** 3) / 12, 14);
    const t = section({ shape: 'rtube', b: 0.05, h: 0.05, t: 0.002 });
    expect(t.A).toBeCloseTo(0.05 ** 2 - 0.046 ** 2, 12);
    expect(t.I).toBeCloseTo((0.05 ** 4 - 0.046 ** 4) / 12, 14);
    const c = section({ shape: 'ctube', d: 0.0483, t: 0.003 });
    expect(c.A).toBeCloseTo((Math.PI * (0.0483 ** 2 - 0.0423 ** 2)) / 4, 12);
    expect(section({ shape: 'round', d: 0.1 }).W).toBeCloseTo((Math.PI * 0.1 ** 3) / 32, 12);
  });

  it('nomes antigos de material viram o equivalente brasileiro', () => {
    expect(barMat('d40')).toBe(BAR_MATS['euc-citriodora']);
    expect(barMat('s235')).toBe(BAR_MATS['aco-a36']);
  });
});

describe('verificação estrutural', () => {
  const p = defaultsFor('hinged');
  const m = build('hinged', p);
  const r = simulate(m, { loadEvery: 2 });

  it('critério de projeto: razão fixa contra a ruptura na flexão da madeira', () => {
    const spec = { arm: { mat: 'jatoba', shape: 'rect' as const, b: 0.12, h: 0.3 } };
    const rup = assess(m, r, spec, 'rupture').checks.find((c) => c.label === 'Braço: flexão + normal')!;
    const des = assess(m, r, spec, 'design').checks.find((c) => c.label === 'Braço: flexão + normal')!;
    const j = BAR_MATS.jatoba;
    expect(des.u / rup.u).toBeCloseTo((1.4 * j.fm) / ((0.88 * 0.7 * j.fc0) / 1.4), 6);
  });

  it('um sarrafo de 2,5 × 10 cm quebra no articulado padrão, no braço, antes da soltura', () => {
    const a = assess(m, r, { arm: { mat: 'cupiuba', shape: 'rect', b: 0.025, h: 0.1 } }, 'rupture');
    expect(a.failure?.id).toBe('arm');
    expect(a.failure!.fail.t).toBeLessThan(r.release!.t);
    expect(a.failure!.fail.detail).toMatch(/σ = .* > /);
  });

  it('funda: carga do catálogo substitui a estimativa', () => {
    expect(ropeBreaking({ mat: 'nylon', d: 0.012 })).toBeCloseTo((250e6 * Math.PI * 0.012 ** 2) / 4, 3);
    const a = assess(m, r, { sling: { F: r.peakForce[m.sling] / 2 } }, 'rupture');
    expect(byPart(a).get('sling')!.u).toBeCloseTo(2, 1);
  });
});

describe('pórtico', () => {
  // a 2 m, 100 kg rod balanced on its center: the frame carries m·g straight down, split over 2 A-frames × 2 legs
  const m: Mechanism = {
    bodies: [
      { name: 'barra', mass: 100, inertia: (100 * 4) / 12, pos: [0, 3], angle: 0, shape: { kind: 'rod', length: 2 } },
      { name: 'pedra', mass: 1, inertia: 1e-3, pos: [0, 100], angle: 0, shape: { kind: 'disk', radius: 0.05 } },
    ],
    joints: [{ kind: 'pin', a: 0, pa: [0, 0], b: 'ground', pb: [0, 3], friction: { mu: 0, radius: 0.02 } }],
    projectile: 1, sling: 0, axle: 0, releaseAngle: -Infinity, air: { density: 0, cd: 0 },
  };
  it('cada perna comprime m·g·√1,25/4; flambagem pela carga de Euler', () => {
    const r = simulate(m, { tMax: 0.003, loadEvery: 1 });
    const frame = { mat: 'pinus-elliottii', shape: 'rect' as const, b: 0.05, h: 0.05 };
    const a = assess(m, r, { frame }, 'rupture');
    const comp = a.checks.find((c) => c.label === 'Pórtico: compressão (perna de trás)')!;
    const N = (100 * G * Math.sqrt(1.25)) / 4, sec = section(frame), mat = BAR_MATS['pinus-elliottii'];
    expect(comp.u).toBeCloseTo(N / sec.A / strength(mat, 'comp', 'rupture'), 6);
    const buck = a.checks.find((c) => c.label === 'Pórtico: flambagem (perna de trás)')!;
    expect(buck.u).toBeCloseTo(N / ((Math.PI ** 2 * mat.E * sec.Imin) / (3 * Math.sqrt(1.25)) ** 2), 6);
  });
});
