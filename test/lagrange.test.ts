// The article (learn.html) derives the equations of motion by hand with Lagrange.
// These tests check those formulas against the generic constraint engine at t = 0.
import { describe, expect, it } from 'vitest';
import { G } from '../src/physics/model';
import { accelerations, initialState } from '../src/physics/solver';
import { build, defaults } from '../src/presets';

const p = { ...defaults, axleMu: 0, troughMu: 0, airDensity: 0 };
const { longArm: L1, shortArm: L2, armMass: mb, cwMass: M, projMass: m, slingLength: Ls } = p;
const d = (L1 - L2) / 2;

function setup() {
  const mech = build('fixed', p);
  mech.joints = mech.joints.filter((j) => j.kind !== 'floor'); // projectile hanging free from the sling
  const s = initialState(mech);
  const cw = mech.bodies[mech.counterweight!];
  const Icw = cw.inertia; // the article's point-mass CW plus its own spin inertia
  const IO = M * L2 * L2 + Icw + mb * ((L1 + L2) ** 2 / 12 + d * d);
  return { mech, s, IO, th: s.q[2] };
}

describe('equações de Lagrange do artigo × motor genérico', () => {
  it('alavanca rígida (projétil soldado na ponta): I_O θ̈ = −g cosθ (m L₁ + m_b d − M L₂)', () => {
    const { mech, IO, th } = setup();
    // weld the projectile to the arm tip instead of a sling
    const tip: [number, number] = [L1 - d, 0];
    mech.bodies[mech.projectile].pos = [L1 * Math.cos(th), p.pivotHeight + L1 * Math.sin(th)];
    mech.joints[mech.sling] = { kind: 'weld', a: mech.projectile, pa: [0, 0], b: 0, pb: tip, angle: -th };
    const s2 = initialState(mech);
    const Ip = mech.bodies[mech.projectile].inertia;
    const thdd = (-G * Math.cos(th) * (m * L1 + mb * d - M * L2)) / (IO + m * L1 * L1 + Ip);
    expect(accelerations(mech, s2, mech.joints.map(() => true)).a[2]).toBeCloseTo(thdd, 6);
  });

  it('com funda: sistema 2×2 em (θ̈, ψ̈) bate com o motor', () => {
    const { mech, s, IO, th } = setup();
    const P = 3 * mech.projectile;
    const tipW = [L1 * Math.cos(th), p.pivotHeight + L1 * Math.sin(th)];
    const psi = Math.atan2(s.q[P + 1] - tipW[1], s.q[P] - tipW[0]);
    const c = Math.cos(th - psi);
    // at rest (θ̇ = ψ̇ = 0):
    // (I_O + m L1²) θ̈ + m L1 Ls cos(θ−ψ) ψ̈ = −g cosθ (m_b d − M L2 + m L1)
    // m L1 Ls cos(θ−ψ) θ̈ + m Ls² ψ̈        = −m g Ls cosψ
    const a11 = IO + m * L1 * L1;
    const a12 = m * L1 * Ls * c;
    const a22 = m * Ls * Ls;
    const b1 = -G * Math.cos(th) * (mb * d - M * L2 + m * L1);
    const b2 = -m * G * Ls * Math.cos(psi);
    const thdd = (b1 * a22 - a12 * b2) / (a11 * a22 - a12 * a12);
    expect(accelerations(mech, s, mech.joints.map(() => true)).a[2]).toBeCloseTo(thdd, 6);
  });
});
