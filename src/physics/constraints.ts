import type { BodyRef, Cam, Joint, Vec } from './model';

// q, v = [x, y, θ] per body
export interface State {
  q: Float64Array;
  v: Float64Array;
}

// One scalar constraint row: J·a = bias at acceleration level.
export interface Row {
  J: Float64Array;
  C: number; // position error
  Cdot: number; // velocity error
  bias: number; // -J̇·v
}

interface Pt {
  p: Vec; // world position
  r: Vec; // arm from body COM
  vel: Vec;
  cen: Vec; // centripetal accel -ω²r
}

export function point(s: State, b: BodyRef, local: Vec): Pt {
  if (b === 'ground') return { p: local, r: [0, 0], vel: [0, 0], cen: [0, 0] };
  const i = 3 * b;
  const c = Math.cos(s.q[i + 2]);
  const sn = Math.sin(s.q[i + 2]);
  const w = s.v[i + 2];
  const r: Vec = [c * local[0] - sn * local[1], sn * local[0] + c * local[1]];
  return {
    p: [s.q[i] + r[0], s.q[i + 1] + r[1]],
    r,
    vel: [s.v[i] - w * r[1], s.v[i + 1] + w * r[0]],
    cen: [-w * w * r[0], -w * w * r[1]],
  };
}

// J += sign · d(dir·p)/dq_b
function addPoint(J: Float64Array, b: BodyRef, r: Vec, dir: Vec, sign: number) {
  if (b === 'ground') return;
  J[3 * b] += sign * dir[0];
  J[3 * b + 1] += sign * dir[1];
  J[3 * b + 2] += sign * (-dir[0] * r[1] + dir[1] * r[0]);
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];

// Hot path (runs ~5× per time step per joint): scalars instead of temporary arrays.
function pointPair(s: State, j: Extract<Joint, { pb: Vec }>, n: number, dirs: Vec[]): Row[] {
  const A = point(s, j.a, j.pa);
  const B = point(s, j.b, j.pb);
  const dx = A.p[0] - B.p[0], dy = A.p[1] - B.p[1];
  const vx = A.vel[0] - B.vel[0], vy = A.vel[1] - B.vel[1];
  const cx = A.cen[0] - B.cen[0], cy = A.cen[1] - B.cen[1];
  const rows: Row[] = [];
  for (const d of dirs) {
    const J = new Float64Array(n);
    addPoint(J, j.a, A.r, d, 1);
    addPoint(J, j.b, B.r, d, -1);
    rows.push({ J, C: d[0] * dx + d[1] * dy, Cdot: d[0] * vx + d[1] * vy, bias: -(d[0] * cx + d[1] * cy) });
  }
  return rows;
}

// drum radius and unwound rope at rotation φ (rope runs out at the end of the spiral: r stays r1, ponytail)
export function camRope(j: Pick<Cam, 'r0' | 'r1' | 'span'>, phi: number) {
  if (phi <= 0) return { r: j.r0, F: j.r0 * phi, dr: 0 };
  const k = (j.r1 - j.r0) / j.span;
  if (phi >= j.span) return { r: j.r1, F: j.span * (j.r0 + j.r1) / 2 + j.r1 * (phi - j.span), dr: 0 };
  return { r: j.r0 + k * phi, F: j.r0 * phi + (k * phi * phi) / 2, dr: k };
}

export function jointRows(s: State, j: Joint, nBodies: number): Row[] {
  const n = 3 * nBodies;
  switch (j.kind) {
    case 'pin':
      return pointPair(s, j, n, [[1, 0], [0, 1]]);
    case 'weld': {
      const J = new Float64Array(n);
      J[3 * j.a + 2] = 1;
      let C = s.q[3 * j.a + 2] - j.angle;
      let Cdot = s.v[3 * j.a + 2];
      if (j.b !== 'ground') {
        J[3 * j.b + 2] = -1;
        C -= s.q[3 * j.b + 2];
        Cdot -= s.v[3 * j.b + 2];
      }
      return [...pointPair(s, j, n, [[1, 0], [0, 1]]), { J, C, Cdot, bias: 0 }];
    }
    case 'rope': {
      const A = point(s, j.a, j.pa);
      const B = point(s, j.b, j.pb);
      const d: Vec = [A.p[0] - B.p[0], A.p[1] - B.p[1]];
      const L = Math.hypot(d[0], d[1]);
      const u: Vec = [d[0] / L, d[1] / L];
      const dv: Vec = [A.vel[0] - B.vel[0], A.vel[1] - B.vel[1]];
      const Cdot = dot(u, dv);
      const J = new Float64Array(n);
      addPoint(J, j.a, A.r, u, 1);
      addPoint(J, j.b, B.r, u, -1);
      return [{
        J,
        C: L - j.length,
        Cdot,
        bias: -(dot(u, [A.cen[0] - B.cen[0], A.cen[1] - B.cen[1]]) + (dot(dv, dv) - Cdot * Cdot) / L),
      }];
    }
    case 'slider': {
      const A = point(s, j.a, j.pa);
      const L = Math.hypot(j.dir[0], j.dir[1]);
      const nrm: Vec = [-j.dir[1] / L, j.dir[0] / L];
      const J = new Float64Array(n);
      addPoint(J, j.a, A.r, nrm, 1);
      return [{ J, C: dot(nrm, [A.p[0] - j.origin[0], A.p[1] - j.origin[1]]), Cdot: dot(nrm, A.vel), bias: -dot(nrm, A.cen) }];
    }
    case 'spike': // never active: the solver swaps it for a foot on touchdown
      return [];
    case 'foot': // rows: [horizontal (no slip), vertical (normal)]
      return pointPair(s, { kind: 'pin', a: j.a, pa: j.pa, b: 'ground', pb: j.at }, n, [[1, 0], [0, 1]]);
    case 'stop': {
      const J = new Float64Array(n);
      J[3 * j.a + 2] = 1;
      let C = s.q[3 * j.a + 2] - j.angle;
      let Cdot = s.v[3 * j.a + 2];
      if (j.b !== 'ground') {
        J[3 * j.b + 2] = -1;
        C -= s.q[3 * j.b + 2];
        Cdot -= s.v[3 * j.b + 2];
      }
      return [{ J, C, Cdot, bias: 0 }];
    }
    case 'cam': {
      const w = s.v[3 * j.b + 2];
      const { r, F, dr } = camRope(j, j.theta0 - s.q[3 * j.b + 2]);
      const H = point(s, j.b, j.hub); // drum center (pinned in practice: these terms just route the pull into the axle)
      const J = new Float64Array(n);
      J[3 * j.a + 1] = -1;
      // dF/dθb = −r, so C grows by +r per rad of θb; that entry's J̇·v = −dr·ω²
      let C = -s.q[3 * j.a + 1] - F - j.length;
      let Cdot = -s.v[3 * j.a + 1];
      let bias = dr * w * w;
      if (j.over) { // span pulley → drum
        const d: Vec = [H.p[0] - j.over[0], H.p[1] - j.over[1]];
        const L = Math.hypot(d[0], d[1]);
        const u: Vec = [d[0] / L, d[1] / L];
        addPoint(J, j.b, H.r, u, 1);
        C += L + j.over[1];
        Cdot += dot(u, H.vel);
        bias -= dot(u, H.cen) + (dot(H.vel, H.vel) - dot(u, H.vel) ** 2) / L;
      } else { // hangs from the drum itself
        addPoint(J, j.b, H.r, [0, 1], 1);
        C += H.p[1];
        Cdot += H.vel[1];
        bias -= H.cen[1];
      }
      J[3 * j.b + 2] += r;
      Cdot += r * w;
      return [{ J, C, Cdot, bias }];
    }
    case 'roller': {
      // C = side·n·(x − at): distance from the rod's center line to the roller, n = rod normal, e = rod direction
      const i = 3 * j.a;
      const c = Math.cos(s.q[i + 2]), sn = Math.sin(s.q[i + 2]), w = s.v[i + 2];
      const dx = s.q[i] - j.at[0], dy = s.q[i + 1] - j.at[1];
      const nx = -sn * j.side, ny = c * j.side, ex = c * j.side, ey = sn * j.side;
      const J = new Float64Array(n);
      J[i] = nx;
      J[i + 1] = ny;
      J[i + 2] = -(ex * dx + ey * dy);
      const ev = ex * s.v[i] + ey * s.v[i + 1];
      return [{ J, C: nx * dx + ny * dy, Cdot: nx * s.v[i] + ny * s.v[i + 1] + J[i + 2] * w, bias: 2 * w * ev + w * w * (nx * dx + ny * dy) }];
    }
    case 'floor': {
      const A = point(s, j.a, j.pa);
      const J = new Float64Array(n);
      addPoint(J, j.a, A.r, [0, 1], 1);
      return [{ J, C: A.p[1] - j.y, Cdot: A.vel[1], bias: -A.cen[1] }];
    }
  }
}
