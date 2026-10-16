import { camRope } from '../physics/constraints';
import { cross, dot, norm, perp, rotate, scale, sub, type BodyRef, type Joint3, type V3 } from './model3';

// q = [x, y, z, qw, qx, qy, qz] per body, v = [vx, vy, vz, ωx, ωy, ωz] per body (ω in the world frame)
export interface State3 {
  q: Float64Array;
  v: Float64Array;
}

// One scalar constraint row: J·a = bias at acceleration level (J: 6 entries per body).
export interface Row3 {
  J: Float64Array;
  C: number;
  Cdot: number;
  bias: number;
}

const ZERO: V3 = [0, 0, 0];
export const omega = (s: State3, b: BodyRef): V3 => (b === 'ground' ? ZERO : [s.v[6 * b + 3], s.v[6 * b + 4], s.v[6 * b + 5]]);
export const worldAxis = (s: State3, b: BodyRef, axis: V3): V3 => (b === 'ground' ? axis : rotate(s.q, 7 * b + 3, axis));

export function point3(s: State3, b: BodyRef, local: V3) {
  if (b === 'ground') return { p: local, r: ZERO, vel: ZERO, cen: ZERO };
  const r = rotate(s.q, 7 * b + 3, local);
  const w = omega(s, b);
  const wr = cross(w, r);
  const i = 7 * b, k = 6 * b;
  return {
    p: [s.q[i] + r[0], s.q[i + 1] + r[1], s.q[i + 2] + r[2]] as V3,
    r,
    vel: [s.v[k] + wr[0], s.v[k + 1] + wr[1], s.v[k + 2] + wr[2]] as V3,
    cen: cross(w, wr), // ω×(ω×r)
  };
}

// J += sign · d(dir·p)/dq_b  (linear: dir, angular: r×dir)
function addPoint(J: Float64Array, b: BodyRef, r: V3, dir: V3, sign: number) {
  if (b === 'ground') return;
  const c = cross(r, dir);
  for (let k = 0; k < 3; k++) (J[6 * b + k] += sign * dir[k]), (J[6 * b + 3 + k] += sign * c[k]);
}
function addAngular(J: Float64Array, b: BodyRef, vec: V3, sign: number) {
  if (b !== 'ground') for (let k = 0; k < 3; k++) J[6 * b + 3 + k] += sign * vec[k];
}

// Twist of a relative to b about `axis` (b's frame; world for ground): φ = 2·atan2(q⃗·n, w) of q = q̄b ⊗ qa.
// For planar machines this is exactly θa − θb. ponytail: wraps outside (−2π, 2π]; unwrap if a part ever spins past that.
export function twist(s: State3, a: number, b: BodyRef, axis: V3) {
  const i = 7 * a + 3;
  const [aw, ax, ay, az] = [s.q[i], s.q[i + 1], s.q[i + 2], s.q[i + 3]];
  let [bw, bx, by, bz] = [1, 0, 0, 0];
  if (b !== 'ground') {
    const k = 7 * b + 3;
    [bw, bx, by, bz] = [s.q[k], -s.q[k + 1], -s.q[k + 2], -s.q[k + 3]]; // conjugate
  }
  const w = bw * aw - bx * ax - by * ay - bz * az;
  const v: V3 = [bw * ax + bx * aw + by * az - bz * ay, bw * ay - bx * az + by * aw + bz * ax, bw * az + bx * ay - by * ax + bz * aw];
  return 2 * Math.atan2(dot(v, axis), w);
}

function pointRows(s: State3, n: number, a: BodyRef, pa: V3, b: BodyRef, pb: V3, dirs: V3[]): Row3[] {
  const A = point3(s, a, pa);
  const B = point3(s, b, pb);
  const d = sub(A.p, B.p), dv = sub(A.vel, B.vel), dc = sub(A.cen, B.cen);
  return dirs.map((dir) => {
    const J = new Float64Array(n);
    addPoint(J, a, A.r, dir, 1);
    addPoint(J, b, B.r, dir, -1);
    return { J, C: dot(dir, d), Cdot: dot(dir, dv), bias: -dot(dir, dc) };
  });
}

// hinge: a's axis stays perpendicular to the two directions of b perpendicular to b's axis
function alignRows(s: State3, n: number, a: number, axis: V3, b: BodyRef, axisB: V3): Row3[] {
  const ea = worldAxis(s, a, axis);
  const p1 = perp(axisB);
  const wa = omega(s, a), wb = omega(s, b);
  const waea = cross(wa, ea);
  return [p1, cross(axisB, p1)].map((p) => {
    const bk = worldAxis(s, b, p);
    const c = cross(ea, bk);
    const J = new Float64Array(n);
    addAngular(J, a, c, 1);
    addAngular(J, b, c, -1);
    const wbbk = cross(wb, bk);
    return { J, C: dot(ea, bk), Cdot: dot(c, sub(wa, wb)), bias: -(dot(cross(wa, waea), bk) + 2 * dot(waea, wbbk) + dot(ea, cross(wb, wbbk))) };
  });
}

// twist of a about b's axis held at `angle` (axis fixed in b: ṅ = ωb×n)
function twistRow(s: State3, n: number, a: number, b: BodyRef, axisB: V3, angle: number): Row3 {
  const nw = worldAxis(s, b, axisB);
  const dw = sub(omega(s, a), omega(s, b));
  const J = new Float64Array(n);
  addAngular(J, a, nw, 1);
  addAngular(J, b, nw, -1);
  return { J, C: twist(s, a, b, axisB) - angle, Cdot: dot(nw, dw), bias: -dot(cross(omega(s, b), nw), dw) };
}

const XYZ: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const Y: V3 = [0, 1, 0];

export function jointRows3(s: State3, j: Joint3, nBodies: number): Row3[] {
  const n = 6 * nBodies;
  switch (j.kind) {
    case 'pin':
      return [...pointRows(s, n, j.a, j.pa, j.b, j.pb, XYZ), ...alignRows(s, n, j.a, j.axis, j.b, j.axisB)];
    case 'weld':
      return [...pointRows(s, n, j.a, j.pa, j.b, j.pb, XYZ), ...alignRows(s, n, j.a, j.axis, j.b, j.axisB), twistRow(s, n, j.a, j.b, j.axisB, j.angle)];
    case 'rope': {
      const A = point3(s, j.a, j.pa);
      const B = point3(s, j.b, j.pb);
      const d = sub(A.p, B.p);
      const L = norm(d);
      const u = scale(d, 1 / L);
      const dv = sub(A.vel, B.vel);
      const Cdot = dot(u, dv);
      const J = new Float64Array(n);
      addPoint(J, j.a, A.r, u, 1);
      addPoint(J, j.b, B.r, u, -1);
      return [{ J, C: L - j.length, Cdot, bias: -(dot(u, sub(A.cen, B.cen)) + (dot(dv, dv) - Cdot * Cdot) / L) }];
    }
    case 'slider': {
      const A = point3(s, j.a, j.pa);
      const c = cross(j.dir, j.across);
      return [j.across, scale(c, 1 / norm(c))].map((nr) => {
        const J = new Float64Array(n);
        addPoint(J, j.a, A.r, nr, 1);
        return { J, C: dot(nr, sub(A.p, j.origin)), Cdot: dot(nr, A.vel), bias: -dot(nr, A.cen) };
      });
    }
    case 'spike': // never active: the solver swaps it for a foot on touchdown
      return [];
    case 'foot': // rows: [x (no slip), y (normal), z (no slip)]
      return pointRows(s, n, j.a, j.pa, 'ground', j.at, XYZ);
    case 'stop':
      return [twistRow(s, n, j.a, j.b, j.axisB, j.angle)];
    case 'floor': {
      const A = point3(s, j.a, j.pa);
      const J = new Float64Array(n);
      addPoint(J, j.a, A.r, Y, 1);
      return [{ J, C: A.p[1] - j.y, Cdot: A.vel[1], bias: -A.cen[1] }];
    }
    case 'roller': {
      // C = n·(x_a − at): the rod's face (normal n, turning with a) stays on the roller. Ċ = n·v + (ω×n)·d
      const i = 7 * j.a, k = 6 * j.a;
      const nw = worldAxis(s, j.a, j.n);
      const w = omega(s, j.a);
      const d: V3 = [s.q[i] - j.at[0], s.q[i + 1] - j.at[1], s.q[i + 2] - j.at[2]];
      const va: V3 = [s.v[k], s.v[k + 1], s.v[k + 2]];
      const wn = cross(w, nw);
      const J = new Float64Array(n);
      addPoint(J, j.a, ZERO, nw, 1);
      addAngular(J, j.a, cross(nw, d), 1);
      return [{ J, C: dot(nw, d), Cdot: dot(nw, va) + dot(wn, d), bias: -(dot(cross(w, wn), d) + 2 * dot(wn, va)) }];
    }
    case 'cam': {
      // same as the planar cam, with θb = twist of the arm about the drum axis (ponytail: axis keeps its direction)
      const w = dot(j.axis, omega(s, j.b));
      const { r, F, dr } = camRope(j, j.theta0 - twist(s, j.b, 'ground', j.axis));
      const H = point3(s, j.b, j.hub);
      const J = new Float64Array(n);
      J[6 * j.a + 1] = -1;
      let C = -s.q[7 * j.a + 1] - F - j.length;
      let Cdot = -s.v[6 * j.a + 1];
      let bias = dr * w * w;
      if (j.over) {
        const d = sub(H.p, j.over);
        const L = norm(d);
        const u = scale(d, 1 / L);
        addPoint(J, j.b, H.r, u, 1);
        C += L + j.over[1];
        Cdot += dot(u, H.vel);
        bias -= dot(u, H.cen) + (dot(H.vel, H.vel) - dot(u, H.vel) ** 2) / L;
      } else {
        addPoint(J, j.b, H.r, Y, 1);
        C += H.p[1];
        Cdot += H.vel[1];
        bias -= H.cen[1];
      }
      addAngular(J, j.b, j.axis, r);
      Cdot += r * w;
      return [{ J, C, Cdot, bias }];
    }
  }
}
