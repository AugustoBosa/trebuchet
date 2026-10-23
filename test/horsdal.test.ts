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

function horsdal(m: number, l4 = 0.87, friction = true, air = false): Mechanism {
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
  Object.assign(arm, { inertia: IB - MB * LCM * LCM, shape: { kind: 'rod', length: 2 * (L1 - LCM) }, pos: [LCM * Math.cos(arm.angle), p.pivotHeight + LCM * Math.sin(arm.angle)] });
  Object.assign(cw, { shape: { kind: 'disk', radius: 0.05 } });
  mech.joints = mech.joints.map((j): Joint => {
    const c = { ...j } as any;
    if (c.a === 0 && c.pa) c.pa = [c.pa[0] + shift, c.pa[1]];
    if (c.b === 0 && c.pb) c.pb = [c.pb[0] + shift, c.pb[1]];
    if (c.kind === 'pin' && c.a === mech.counterweight && friction) c.friction = { mu: 0.35, radius: 0.0025 }; // hinge
    return c;
  });
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
