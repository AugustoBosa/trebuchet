import { describe, expect, it } from 'vitest';
import type { Joint, Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { build, defaultsFor } from '../src/presets';

// Reference: Horsdal, Johnsen & Rasmussen (Aarhus), "The swinging counterweight trebuchet", arXiv:2502.19442. A small
// hinged-counterweight machine with rotation sensors on beam, counterweight and sling; their table 1 gives every parameter.
// Beam: long L1 = 0.975 m, short L2 = 0.25 m, 4.86 kg, center of mass 0.465 m from the axle toward the sling, I = 1.85 kg·m²
// about the axle. Hanger L3 = 0.515 m, counterweight 53.9 kg, axle 0.831 m high, beam starts 0.55 rad off the vertical
// (long end on the ground), sling L4 = 0.87 m, stone 3 g/cm³. Energy put in: ΔU = 204 J. Axle friction µ = 0.35 at R = 1.7 cm,
// hinge friction µ = 0.35 at R = 0.25 cm (their fit, eq. 8).
const L1 = 0.975, L2 = 0.25, LCM = 0.465, IB = 1.85, MB = 4.86, DU = 204;

// ib: beam inertia about the axle; trestle: the fulcrum rides on a sliding mass held by springs (the paper's flexible-trestle idea)
function horsdal(m: number, l4 = 0.87, friction = true, air = false, ib = IB, trestle?: { mass: number; k: number }): Mechanism {
  const p = {
    ...defaultsFor('hinged'), pivotHeight: L1 * Math.cos(0.55), longArm: L1, shortArm: L2, armMass: MB, cwMass: 53.9, hingeLength: 0.515,
    projMass: m, projRadius: Math.cbrt(m / 3000 / ((4 / 3) * Math.PI)), slingLength: l4, airDensity: air ? 1.225 : 0, dragCd: 0.5,
    axleMu: friction ? 0.35 : 0, axleRadius: 0.017, troughMu: 0,
  };
  const mech = build('hinged', p);
  const [arm, cw] = [mech.bodies[0], mech.bodies[mech.counterweight!]];
  // the beam is not uniform: move its center of mass and fix its inertia; the rod shape only sets the extent for the ground
  // check (long end stays at L1), and the flat stack of discs hangs 0.066 m above the ground at release, so shrink its disk
  const shift = (L1 - L2) / 2 - LCM; // locals are measured from the beam's center of mass
  Object.assign(arm, { inertia: ib - MB * LCM * LCM, shape: { kind: 'rod', length: 2 * (L1 - LCM) }, pos: [LCM * Math.cos(arm.angle), p.pivotHeight + LCM * Math.sin(arm.angle)] });
  Object.assign(cw, { shape: { kind: 'disk', radius: 0.05 } });
  mech.joints = mech.joints.map((j): Joint => {
    const c = { ...j } as any;
    if (c.a === 0 && c.pa) c.pa = [c.pa[0] + shift, c.pa[1]];
    if (c.b === 0 && c.pb) c.pb = [c.pb[0] + shift, c.pb[1]];
    if (c.kind === 'pin' && c.a === mech.counterweight && friction) c.friction = { mu: 0.35, radius: 0.0025 }; // hinge
    return c;
  });
  if (trestle) {
    const piv: [number, number] = [0, p.pivotHeight], T = mech.bodies.length;
    mech.bodies.push({ name: 'cavalete', mass: trestle.mass, inertia: 1e3, pos: piv, angle: 0, shape: { kind: 'disk', radius: 0.01 } });
    mech.joints = mech.joints.map((j): Joint => (j.kind === 'pin' && j.b === 'ground' && j.a === 0 ? { ...j, b: T, pb: [0, 0] } : j));
    mech.joints.push({ kind: 'slider', a: T, pa: [0, 0], origin: piv, dir: [1, 0] });
    // one spring each side, both unstretched at rest: whichever way it moves, the far one pulls it back
    mech.springs = [-1, 1].map((side) => ({ body: T, local: [0, 0] as [number, number], anchor: [side, piv[1]] as [number, number], k: trestle.k, rest: 1 }));
  }
  return mech;
}

// the paper's "longest range": release at the best moment (here: the best velocity angle)
function best(mk: () => Mechanism, from = 36, to = 43) {
  let b: { range: number; deg: number; t: number; p: number[]; peak: number; dissipated: number } | undefined;
  for (let deg = from; deg <= to; deg++) {
    const m = mk();
    m.releaseAngle = (deg * Math.PI) / 180;
    const r = simulate(m, { afterRelease: 0 });
    if (!r.error && (!b || r.range > b.range)) b = { range: r.range, deg, t: r.release!.t, p: r.release!.p, peak: r.peakForce[m.axle] / 9.81, dissipated: r.dissipated };
  }
  return b!;
}

describe('Horsdal et al. (2025), trebuchet instrumentado', () => {
  it('aceleração inicial do braço: 19,2 rad/s² sem projétil, 16,0 com 717 g', () => {
    for (const [m, want] of [[0.001, 19.2], [0.717, 16.0]] as const) {
      const fr = simulate(horsdal(m), { afterRelease: 0, frameEvery: 1, tMax: 0.25 }).frames.filter((f) => f.t <= 0.2);
      // same fit as the paper's eq. 3: θ = ½·θ̈·t² + c·t³
      let s22 = 0, s23 = 0, s33 = 0, b2 = 0, b3 = 0;
      for (const f of fr) {
        const y = Math.abs(f.q[2] - fr[0].q[2]);
        (s22 += f.t ** 4), (s23 += f.t ** 5), (s33 += f.t ** 6), (b2 += y * f.t ** 2), (b3 += y * f.t ** 3);
      }
      const acc = (2 * (b2 * s33 - b3 * s23)) / (s22 * s33 - s23 * s23);
      expect(Math.abs(acc - want) / want).toBeLessThan(0.04);
    }
  });

  it('sem atrito, no vácuo: o alcance máximo do cálculo ab initio do artigo (42,8 m e 32,2 m)', () => {
    for (const [m, want] of [[0.717, 42.8], [1.011, 32.2]] as const) {
      const b = best(() => horsdal(m, 0.87, false));
      expect(Math.abs(b.range - want) / want).toBeLessThan(0.03);
      expect(b.dissipated / DU).toBeLessThan(0.01); // energy is conserved
    }
  });

  it('ponto de soltura do melhor alcance (717 g): subida 39,5°, altura 2,39 m, 0,76 m atrás do eixo, t = 0,593 s', () => {
    const b = best(() => horsdal(0.717));
    expect(Math.abs(b.deg - 39.5)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b.p[1] - 2.39)).toBeLessThan(0.05);
    expect(Math.abs(-b.p[0] - 0.76)).toBeLessThan(0.1);
    expect(Math.abs(b.t - 0.593)).toBeLessThan(0.02);
  });

  it('atrito dos mancais: a dissipação do solver é a integral da eq. (8) do artigo, e perde ~5% da energia', () => {
    const m = horsdal(0.717);
    m.releaseAngle = (39 * Math.PI) / 180;
    const r = simulate(m, { afterRelease: 0, frameEvery: 1 });
    const cw = 3 * m.counterweight! + 2;
    let Q = 0; // Pf = µp·|FP|·RP·|θ̇| + µH·|FH|·RH·|θ̇ − ψ̇|, forces from the solver's own reactions
    for (let i = 1; i < r.frames.length; i++) {
      const [a, f] = [r.frames[i - 1], r.frames[i]];
      const w = (k: number) => (f.q[k] - a.q[k]) / (f.t - a.t);
      Q += (0.35 * f.forces[m.axle] * 0.017 * Math.abs(w(2)) + 0.35 * f.forces[m.axle + 1] * 0.0025 * Math.abs(w(cw) - w(2))) * (f.t - a.t);
    }
    expect(Math.abs(Q - r.dissipated) / r.dissipated).toBeLessThan(0.05);
    expect(r.dissipated / DU).toBeGreaterThan(0.04); // the paper: ≃ 5 % at the release of longest range
    expect(r.dissipated / DU).toBeLessThan(0.08);
  });

  it('força no eixo: pico perto de 3·M·g (~160 kg), abaixo de 200 kg com a pedra de 717 g', () => {
    const peak = best(() => horsdal(0.717)).peak;
    expect(peak).toBeGreaterThan(130);
    expect(peak).toBeLessThan(200);
  });

  // The paper's own friction-free ab initio ranges in air (39.5 m, 30.6 m) sit ~4σ above its field shots (34.4 ± 1.5 m,
  // 24.9 ± 1.5 m); friction explains ~5 % of that, and it blames unmodelled degrees of freedom (a flexible trestle, beam
  // bending) for the rest. This model has the same rigid-body limit: with friction and air it lands just under the ab initio
  // numbers and 8–18 % over the field.
  it('no ar, com atrito: logo abaixo do ab initio e acima do campo, como o rígido do artigo', () => {
    for (const [m, ab, field] of [[0.717, 39.5, 34.4], [1.011, 30.6, 24.9]] as const) {
      const r = best(() => horsdal(m, 0.87, true, true)).range;
      expect(r).toBeLessThan(ab);
      expect(r).toBeGreaterThan(ab * 0.93);
      expect(r).toBeGreaterThan(field);
      expect(r).toBeLessThan(field * 1.25);
    }
  });

  it('funda mais longa (0,93 m contra 0,87 m): alcance sobe, como no campo (+9 ± 6%)', () => {
    const gain = best(() => horsdal(0.7, 0.93, true, true)).range / best(() => horsdal(0.7, 0.87, true, true)).range;
    expect(gain).toBeGreaterThan(1.0);
    expect(gain).toBeLessThan(1.15);
  });
});

// The paper's optimized designs (table 4 of the 2025 paper; uniform beam, θi = 0.55 rad, vacuum, no friction): lengths in cm,
// M in kg, m in g, mb in kg, then the range R (m), energy at target T (J) and efficiency ε (%) the authors computed ab initio.
const TABLE4: [string, number[], number, number, number, number, number, number][] = [
  ['mesma capacidade, 25 % maior e 50 % mais leve', [128, 36.2, 63.9, 111], 26.3, 697, 2.16, 36.6, 141, 91],
  ['50 m com 25 J', [97.2, 21.3, 55.0, 88.0], 7.88, 95, 0.5, 50, 25, 93],
  ['50 m com 350 J', [157, 42.7, 80.4, 137], 55.4, 1281, 4.51, 50, 350, 91],
];
function optimized([l1, l2, l3, l4]: number[], M: number, mg: number, mb: number, s = 1): Mechanism {
  const m = mg / 1000, L1 = l1 / 100, L2 = l2 / 100;
  const p = {
    ...defaultsFor('hinged'), pivotHeight: L1 * Math.cos(0.55) * s, longArm: L1 * s, shortArm: L2 * s, armMass: mb * s ** 3, cwMass: M * s ** 3, hingeLength: (l3 / 100) * s,
    projMass: m * s ** 3, projRadius: 0.02 * s, slingLength: (l4 / 100) * s, airDensity: 0, axleMu: 0, troughMu: 0,
  };
  const mech = build('hinged', p);
  Object.assign(mech.bodies[mech.counterweight!], { shape: { kind: 'disk', radius: 0.02 * s } }); // the discs clear the ground; only the check sees this
  return mech;
}

describe('Horsdal et al.: as três máquinas otimizadas da tabela 4 (cálculo ab initio deles)', () => {
  for (const [nome, len, M, mg, mb, R, T, eps] of TABLE4)
    it(`${nome}: alcance ${R} m, energia ${T} J, eficiência ${eps} %`, () => {
      const [L1, L2] = [len[0] / 100, len[1] / 100];
      const dU = (M * L2 - mb * ((L1 - L2) / 2)) * 9.81 * (1 + Math.cos(0.55));
      const b = best(() => optimized(len, M, mg, mb), 34, 46);
      const m = optimized(len, M, mg, mb);
      m.releaseAngle = (b.deg * Math.PI) / 180;
      const r = simulate(m, { afterRelease: 0 });
      const Tt = 0.5 * (mg / 1000) * r.release!.speed ** 2 + (mg / 1000) * 9.81 * r.release!.p[1]; // the paper's T: kinetic + potential at release
      expect(Math.abs(b.range - R) / R).toBeLessThan(0.02);
      expect(Math.abs(Tt - T) / T).toBeLessThan(0.03);
      expect(Math.abs((100 * Tt) / dU - eps)).toBeLessThan(2.5);
    });
});

describe('semelhança dinâmica (a premissa de escala do artigo)', () => {
  it('comprimentos ×2 e massas ×8, sem atrito e no vácuo: alcance ×2 e tempos ×√2', () => {
    const [, len, M, mg, mb] = TABLE4[0];
    const shot = (s: number) => { const m = optimized(len, M, mg, mb, s); m.releaseAngle = (40 * Math.PI) / 180; return simulate(m, { afterRelease: 0 }); };
    const [a, b] = [shot(1), shot(2)];
    expect(b.range / a.range).toBeCloseTo(2, 2);
    expect(b.release!.t / a.release!.t).toBeCloseTo(Math.SQRT2, 2);
    expect(b.release!.speed / a.release!.speed).toBeCloseTo(Math.SQRT2, 2);
  });
});

// The authors blame the 8 % between their friction-corrected ab initio range and their measured kinematics on missing
// degrees of freedom. Two candidates this model can test, and cannot confirm: the beam's inertia is known to ±0.15 kg·m²,
// and a flexible trestle (their own model: "very little influence on range").
describe('Horsdal et al.: o que não explica a diferença contra o campo', () => {
  it('a incerteza de ±0,15 kg·m² na inércia da viga move o alcance menos de 3 %', () => {
    const r = (ib: number) => best(() => horsdal(0.717, 0.87, true, false, ib)).range;
    expect(Math.abs(r(IB + 0.15) / r(IB) - 1)).toBeLessThan(0.03);
    expect(Math.abs(r(IB - 0.15) / r(IB) - 1)).toBeLessThan(0.03);
  });

  it('um cavalete que cede (100 kg em molas de 50 kN/m) muda o alcance menos de 0,5 %', () => {
    const rigid = best(() => horsdal(0.717)).range;
    const soft = best(() => horsdal(0.717, 0.87, true, false, IB, { mass: 100, k: 5e4 })).range;
    expect(Math.abs(soft / rigid - 1)).toBeLessThan(0.005);
  });
});
