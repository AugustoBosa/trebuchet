import { G } from '../physics/model';
import { jointRows3, omega, point3, worldAxis, type State3 } from './constraints3';
import { add, cross, dot, norm, rotateInv, scale, sub, type Joint3, type Mechanism3, type V3 } from './model3';

// 3D twin of physics/bending.ts. The moment at a cut is a vector: its part across the rod bends it (reported), the
// part along it twists it. Distributed load over the far side [x_s, L/2] (a = a_c + α×e·x + ω×(ω×e·x)):
//   M_dist = μ [ e×(g − a_c)·I1 − (α⊥ + (e×ω)(ω·e))·I2 ]
const SECTIONS = 41;

export function anchor3(s: State3, j: Joint3, b: number): V3 | undefined {
  const onRod = (w: V3): V3 => [rotateInv(s.q, 7 * b + 3, sub(w, [s.q[7 * b], s.q[7 * b + 1], s.q[7 * b + 2]]))[0], 0, 0];
  switch (j.kind) {
    case 'pin': case 'weld': case 'rope':
      return j.a === b ? j.pa : j.b === b ? j.pb : undefined;
    case 'floor': case 'foot': case 'spike': case 'slider':
      return j.a === b ? j.pa : undefined;
    case 'roller':
      return j.a === b ? onRod(j.at) : undefined;
    case 'stop':
      return j.b === b ? onRod(point3(s, j.a, [0, 0, 0]).p) : j.a === b ? [0, 0, 0] : undefined;
    case 'cam':
      return j.b === b ? j.hub : j.a === b ? [0, 0, 0] : undefined;
  }
}

// Internal forces at SECTIONS cuts along rod b, as physics/bending.ts rodLoads plus the out-of-plane parts. The far-side
// resultant is a vector: N along the rod; shear V across it (V = in the throw plane, Vl = along world z); moment M
// across it (M = about z, the plane's bending; Ml = about an axis in the plane, the sideways bending).
export function rodLoads3(m: Mechanism3, s: State3, active: boolean[], a: Float64Array, lambda: number[][], b: number) {
  const body = m.bodies[b];
  if (body.shape.kind !== 'rod') return undefined;
  const L = body.shape.length, mu = body.mass / L, h = L / 2, k6 = 6 * b;
  const e = worldAxis(s, b, [1, 0, 0]);
  const c: V3 = [s.q[7 * b], s.q[7 * b + 1], s.q[7 * b + 2]];
  const loads: { x: number; p: V3; F: V3; C: V3 }[] = [];
  const push = (loc: V3, F: V3, tau: V3) => {
    const P = point3(s, b, loc);
    loads.push({ x: loc[0], p: P.p, F, C: sub(tau, cross(P.r, F)) });
  };
  m.joints.forEach((j, ji) => {
    if (!active[ji] || !lambda[ji].length) return;
    const loc = anchor3(s, j, b);
    if (!loc) return;
    let F: V3 = [0, 0, 0], tau: V3 = [0, 0, 0];
    jointRows3(s, j, m.bodies.length).forEach((r, k) => {
      const l = lambda[ji][k] ?? 0;
      F = add(F, [r.J[k6] * l, r.J[k6 + 1] * l, r.J[k6 + 2] * l]);
      tau = add(tau, [r.J[k6 + 3] * l, r.J[k6 + 4] * l, r.J[k6 + 5] * l]);
    });
    push(loc, F, tau);
  });
  for (const pl of m.pulls ?? []) {
    const P = point3(s, b, pl.local);
    if (pl.body === b && P.p[1] > pl.untilY) push(pl.local, [0, -pl.force, 0], cross(P.r, [0, -pl.force, 0]));
  }
  for (const sp of m.springs ?? []) {
    if (sp.body !== b) continue;
    const P = point3(s, b, sp.local), d = sub(sp.anchor, P.p), Ld = norm(d);
    if (Ld > sp.rest) {
      const F = scale(d, (sp.k * (Ld - sp.rest)) / Ld);
      push(sp.local, F, cross(P.r, F));
    }
  }
  const ac: V3 = [a[k6], a[k6 + 1], a[k6 + 2]], al: V3 = [a[k6 + 3], a[k6 + 4], a[k6 + 5]], w = omega(s, b);
  const ga = sub([0, -G, 0], ac), gl = cross(e, ga);
  const inert = add(sub(al, scale(e, dot(e, al))), scale(cross(e, w), dot(w, e)));
  const kv = add(cross(al, e), cross(w, cross(w, e))); // a(x) − a_c = kv·x
  const x = new Float64Array(SECTIONS), N = new Float64Array(SECTIONS), V = new Float64Array(SECTIONS), Vl = new Float64Array(SECTIONS), M = new Float64Array(SECTIONS), Ml = new Float64Array(SECTIONS);
  for (let k = 0; k < SECTIONS; k++) {
    const xs = -h + (L * k) / (SECTIONS - 1);
    const ps = add(c, scale(e, xs));
    let F = scale(sub(scale(ga, h - xs), scale(kv, (h * h - xs * xs) / 2)), mu);
    let Mv = scale(sub(scale(gl, (h - xs) ** 2 / 2), scale(inert, h ** 3 / 3 - (xs * h * h) / 2 + xs ** 3 / 6)), mu);
    for (const ld of loads) if (ld.x > xs + 1e-9) (F = add(F, ld.F)), (Mv = add(Mv, add(cross(sub(ld.p, ps), ld.F), ld.C)));
    const Vv = sub(F, scale(e, dot(e, F)));
    Mv = sub(Mv, scale(e, dot(e, Mv))); // the rest is torsion
    (x[k] = xs), (N[k] = dot(e, F)), (Vl[k] = Math.abs(Vv[2])), (V[k] = Math.hypot(Vv[0], Vv[1])), (M[k] = Math.abs(Mv[2])), (Ml[k] = Math.hypot(Mv[0], Mv[1]));
  }
  return { x, N, V, M, Vl, Ml };
}

export function bendingPeak3(m: Mechanism3, s: State3, active: boolean[], a: Float64Array, lambda: number[][], b: number) {
  const r = rodLoads3(m, s, active, a, lambda, b);
  if (!r) return undefined;
  let best = { moment: 0, x: 0 };
  r.M.forEach((M, k) => Math.hypot(M, r.Ml[k]) > best.moment && (best = { moment: Math.hypot(M, r.Ml[k]), x: r.x[k] }));
  return best;
}
