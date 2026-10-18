import { jointRows, point, type State } from './constraints';
import { G, type Joint, type Mechanism, type Vec } from './model';

// Bending moment along a rod (the throwing arm), from the forces acting on it at one instant.
// Cut the rod at x_s (local coordinate along it, from its center): the internal moment there is the moment, about the
// cut, of everything on the far side: joint reactions (Jᵀλ, applied at the joint's anchor, plus any couple), crew
// pulls and springs, and the rod's own weight and inertia (D'Alembert, rigid-body acceleration field
// a(x) = a_c + α k×e·x − ω² e·x, uniform mass per length μ). With e along the rod, only gravity, a_c and α bend it:
//   M_dist(x_s) = μ [ (e×(g − a_c))_z · I1 − α · I2 ],  I1 = ∫(x − x_s)dx,  I2 = ∫(x − x_s)·x dx over [x_s, L/2].
// ponytail: friction forces/couples are left out (≲ μ_journal × reaction, small next to the reactions)
export const SECTIONS = 41;

// where a joint grips body b, in b's frame (undefined: it doesn't touch b)
export function anchor(m: Mechanism, s: State, j: Joint, b: number): Vec | undefined {
  const local = (w: Vec): Vec => { // world point → b's frame, projected onto the rod's line
    const i = 3 * b, c = Math.cos(s.q[i + 2]), sn = Math.sin(s.q[i + 2]);
    return [c * (w[0] - s.q[i]) + sn * (w[1] - s.q[i + 1]), 0];
  };
  switch (j.kind) {
    case 'pin': case 'weld': case 'rope':
      return j.a === b ? j.pa : j.b === b ? j.pb : undefined;
    case 'floor': case 'foot': case 'spike': case 'slider':
      return j.a === b ? j.pa : undefined;
    case 'roller':
      return j.a === b ? local(j.at) : undefined;
    case 'stop': // a body lying on the arm: its couple acts where that body rests
      return j.b === b ? local(point(s, j.a, [0, 0]).p) : j.a === b ? [0, 0] : undefined;
    case 'cam':
      return j.b === b ? j.hub : j.a === b ? [0, 0] : undefined;
  }
}

// Internal forces at SECTIONS cuts along rod b (local x from -L/2 to L/2): N (along the rod, + = tension), V (across),
// M (bending), each the resultant on the far side of the cut (x > x_s) of the joint reactions, crew pulls, springs and
// the rod's own weight and inertia. Same D'Alembert field as M: with n = k×e,
//   (g − a(x))·e = (g − a_c)·e + ω²x,   (g − a(x))·n = (g − a_c)·n − αx.
export function rodLoads(m: Mechanism, s: State, active: boolean[], a: Float64Array, lambda: number[][], b: number) {
  const body = m.bodies[b];
  if (body.shape.kind !== 'rod') return undefined;
  const L = body.shape.length, mu = body.mass / L;
  const i = 3 * b, e: Vec = [Math.cos(s.q[i + 2]), Math.sin(s.q[i + 2])], n: Vec = [-e[1], e[0]];
  const c: Vec = [s.q[i], s.q[i + 1]];
  // point loads: [local x along the rod, world point, force, extra couple]
  const loads: { x: number; p: Vec; F: Vec; C: number }[] = [];
  const add = (loc: Vec, F: Vec, tau: number) => {
    const P = point(s, b, loc);
    loads.push({ x: loc[0], p: P.p, F, C: tau - (P.r[0] * F[1] - P.r[1] * F[0]) });
  };
  m.joints.forEach((j, ji) => {
    if (!active[ji] || !lambda[ji].length) return;
    const loc = anchor(m, s, j, b);
    if (!loc) return;
    const F: Vec = [0, 0];
    let tau = 0;
    jointRows(s, j, m.bodies.length).forEach((r, k) => {
      const l = lambda[ji][k] ?? 0;
      (F[0] += r.J[i] * l), (F[1] += r.J[i + 1] * l), (tau += r.J[i + 2] * l);
    });
    add(loc, F, tau);
  });
  for (const pl of m.pulls ?? []) if (pl.body === b && point(s, b, pl.local).p[1] > pl.untilY) add(pl.local, [0, -pl.force], -point(s, b, pl.local).r[0] * pl.force);
  for (const sp of m.springs ?? []) {
    if (sp.body !== b) continue;
    const P = point(s, b, sp.local), d: Vec = [sp.anchor[0] - P.p[0], sp.anchor[1] - P.p[1]], Ld = Math.hypot(...d);
    if (Ld > sp.rest) {
      const F: Vec = [(sp.k * (Ld - sp.rest) * d[0]) / Ld, (sp.k * (Ld - sp.rest) * d[1]) / Ld];
      add(sp.local, F, P.r[0] * F[1] - P.r[1] * F[0]);
    }
  }
  const ga: Vec = [-a[i], -G - a[i + 1]]; // g − a_c
  const Ge = ga[0] * e[0] + ga[1] * e[1], Gz = ga[0] * n[0] + ga[1] * n[1]; // Gz = (e×(g − a_c))_z
  const alpha = a[i + 2], w2 = s.v[i + 2] ** 2, h = L / 2;
  const x = new Float64Array(SECTIONS), N = new Float64Array(SECTIONS), V = new Float64Array(SECTIONS), M = new Float64Array(SECTIONS);
  for (let k = 0; k < SECTIONS; k++) {
    const xs = -h + (L * k) / (SECTIONS - 1);
    const ps: Vec = [c[0] + e[0] * xs, c[1] + e[1] * xs];
    let Nk = mu * (Ge * (h - xs) + (w2 * (h * h - xs * xs)) / 2), Vk = mu * (Gz * (h - xs) - (alpha * (h * h - xs * xs)) / 2);
    let Mk = mu * (Gz * ((h - xs) ** 2 / 2) - alpha * (h ** 3 / 3 - (xs * h * h) / 2 + xs ** 3 / 6));
    for (const ld of loads)
      if (ld.x > xs + 1e-9) (Nk += ld.F[0] * e[0] + ld.F[1] * e[1]), (Vk += ld.F[0] * n[0] + ld.F[1] * n[1]), (Mk += (ld.p[0] - ps[0]) * ld.F[1] - (ld.p[1] - ps[1]) * ld.F[0] + ld.C);
    (x[k] = xs), (N[k] = Nk), (V[k] = Vk), (M[k] = Mk);
  }
  return { x, N, V, M };
}

export function bendingPeak(m: Mechanism, s: State, active: boolean[], a: Float64Array, lambda: number[][], b: number) {
  const r = rodLoads(m, s, active, a, lambda, b);
  if (!r) return undefined;
  let best = { moment: 0, x: 0 };
  r.M.forEach((M, k) => Math.abs(M) > best.moment && (best = { moment: Math.abs(M), x: r.x[k] }));
  return best;
}
