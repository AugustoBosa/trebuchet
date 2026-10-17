import { G } from '../physics/model';
import { solve } from '../physics/solver';
import { fly3 } from './ballistics3';
import { jointRows3, omega, point3, worldAxis, type Row3, type State3 } from './constraints3';
import { cross, dot, rotate, rotateInv, type Joint3, type Mechanism3, type V3 } from './model3';

// Same method as physics/solver.ts (acceleration-level multipliers + Baumgarte, RK4, inelastic impacts, release
// by velocity angle), with 6-DOF bodies: M⁻¹ is block-diagonal (1/m, R·I⁻¹·Rᵀ) and the gyroscopic torque −ω×(Iω)
// is applied. A planar machine stays exactly planar (every out-of-plane term is an exact zero).
const GROUND_TOL = 0.02;
const STAB = 100;
const V_SLIP = 0.01;

export function dragK3(m: Mechanism3): number {
  const p = m.bodies[m.projectile];
  const r = p.shape.kind === 'disk' ? p.shape.radius : 0;
  return (0.5 * m.air.density * m.air.cd * Math.PI * r * r) / p.mass;
}

export function initialState3(m: Mechanism3): State3 {
  const n = m.bodies.length;
  const q = new Float64Array(7 * n);
  m.bodies.forEach((b, i) => q.set([...b.pos, ...b.quat], 7 * i));
  return { q, v: new Float64Array(6 * n) };
}

// world inertia (or its inverse) times x: R·I^±1·Rᵀ·x
function inertia(m: Mechanism3, s: State3, b: number, x: V3, inv: boolean): V3 {
  const I = m.bodies[b].inertia;
  const l = rotateInv(s.q, 7 * b + 3, x);
  return rotate(s.q, 7 * b + 3, inv ? [l[0] / I[0], l[1] / I[1], l[2] / I[2]] : [l[0] * I[0], l[1] * I[1], l[2] * I[2]]);
}

// M⁻¹·x, restricted to the bodies listed (rows touch at most two)
function minv(m: Mechanism3, s: State3, x: Float64Array, bodies: Iterable<number>): Float64Array {
  const out = new Float64Array(x.length);
  for (const b of bodies) {
    const k = 6 * b;
    for (let c = 0; c < 3; c++) out[k + c] = x[k + c] / m.bodies[b].mass;
    out.set(inertia(m, s, b, [x[k + 3], x[k + 4], x[k + 5]], true), k + 3);
  }
  return out;
}

const bodiesOf = (J: Float64Array) => {
  const out: number[] = [];
  for (let b = 0; b < J.length / 6; b++) for (let c = 0; c < 6; c++) if (J[6 * b + c] !== 0) { out.push(b); break; }
  return out;
};

function addForce(F: Float64Array, b: number, r: V3, f: V3) {
  const t = cross(r, f);
  for (let c = 0; c < 3; c++) (F[6 * b + c] += f[c]), (F[6 * b + 3 + c] += t[c]);
}

// Coulomb friction from the previous step's normal force (same lagged approximation as the planar solver)
function addFriction(m: Mechanism3, s: State3, active: boolean[], fric: number[], F: Float64Array) {
  m.joints.forEach((j, ji) => {
    const mag = fric[ji];
    if (!mag || !active[ji]) return;
    if (j.kind === 'pin') {
      const n = worldAxis(s, j.b, j.axisB);
      const wa = omega(s, j.a), wb = omega(s, j.b);
      const tau = mag * Math.tanh(dot(n, [wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]]) / V_SLIP);
      for (let c = 0; c < 3; c++) {
        F[6 * j.a + 3 + c] -= tau * n[c];
        if (j.b !== 'ground') F[6 * j.b + 3 + c] += tau * n[c];
      }
    } else if (j.kind === 'floor') {
      const P = point3(s, j.a, j.pa);
      const sp = Math.hypot(P.vel[0], P.vel[2]);
      if (sp > 0) addForce(F, j.a, P.r, [(-mag * Math.tanh(sp / V_SLIP) * P.vel[0]) / sp, 0, (-mag * Math.tanh(sp / V_SLIP) * P.vel[2]) / sp]);
    }
  });
}

// hinges carry 3 force rows then 2 torque rows: only the forces count as the joint's load
const forceRows = (j: Joint3) => (j.kind === 'pin' || j.kind === 'weld' ? 3 : Infinity);
const load = (j: Joint3, l: number[]) => Math.hypot(...l.slice(0, forceRows(j)));

export function frictionMagnitudes3(m: Mechanism3, lambda: number[][]): number[] {
  return m.joints.map((j, ji) => {
    if (j.kind === 'pin' && j.friction) return j.friction.mu * j.friction.radius * load(j, lambda[ji]);
    if (j.kind === 'floor' && j.mu) return j.mu * Math.max(0, lambda[ji][0] ?? 0);
    return 0;
  });
}

function collectRows(m: Mechanism3, s: State3, active: boolean[]) {
  const rows: Row3[] = [];
  const owner: number[] = [];
  m.joints.forEach((j, ji) => active[ji] && jointRows3(s, j, m.bodies.length).forEach((r) => (rows.push(r), owner.push(ji))));
  const bodies = rows.map((r) => bodiesOf(r.J));
  const Y = rows.map((r, i) => minv(m, s, r.J, bodies[i])); // M⁻¹Jᵢᵀ
  const A = rows.map(() => new Float64Array(rows.length));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i; j < rows.length; j++) {
      let sum = 0;
      for (const b of bodies[i]) for (let c = 6 * b; c < 6 * b + 6; c++) sum += rows[j].J[c] * Y[i][c];
      A[i][j] = A[j][i] = sum;
    }
    A[i][i] += 1e-10 * A[i][i] + 1e-14; // redundant rows (a hinge loop) stay solvable
  }
  return { rows, owner, Y, A };
}

export function accelerations3(m: Mechanism3, s: State3, active: boolean[], fric: number[] = []) {
  const nb = m.bodies.length;
  const F = new Float64Array(6 * nb);
  m.bodies.forEach((b, i) => {
    F[6 * i + 1] = -b.mass * G;
    const w = omega(s, i);
    const gyro = cross(w, inertia(m, s, i, w, false));
    for (let c = 0; c < 3; c++) F[6 * i + 3 + c] -= gyro[c];
  });
  const p = 6 * m.projectile, wind = m.air.wind ?? [0, 0, 0];
  const rel: V3 = [s.v[p] - wind[0], s.v[p + 1] - wind[1], s.v[p + 2] - wind[2]];
  const kd = dragK3(m) * m.bodies[m.projectile].mass * Math.hypot(...rel);
  for (let c = 0; c < 3; c++) F[p + c] -= kd * rel[c];
  addFriction(m, s, active, fric, F);
  for (const pl of m.pulls ?? []) {
    const P = point3(s, pl.body, pl.local);
    if (P.p[1] > pl.untilY) addForce(F, pl.body, P.r, [0, -pl.force, 0]);
  }
  for (const sp of m.springs ?? []) {
    const P = point3(s, sp.body, sp.local);
    const d: V3 = [sp.anchor[0] - P.p[0], sp.anchor[1] - P.p[1], sp.anchor[2] - P.p[2]];
    const L = Math.hypot(...d);
    if (L > sp.rest) addForce(F, sp.body, P.r, [(sp.k * (L - sp.rest) * d[0]) / L, (sp.k * (L - sp.rest) * d[1]) / L, (sp.k * (L - sp.rest) * d[2]) / L]);
  }

  const { rows, owner, Y, A } = collectRows(m, s, active);
  const a = minv(m, s, F, m.bodies.keys());
  const rhs = rows.map((r) => r.bias - 2 * STAB * r.Cdot - STAB * STAB * r.C - r.J.reduce((acc, x, c) => acc + x * a[c], 0));
  const lam = solve(A, Float64Array.from(rhs));
  for (let i = 0; i < rows.length; i++) for (let c = 0; c < a.length; c++) a[c] += Y[i][c] * lam[i];
  const lambda: number[][] = m.joints.map(() => []);
  for (let i = 0; i < rows.length; i++) lambda[owner[i]].push(lam[i]);
  return { a, lambda };
}

const contactSign = (j: Joint3) => (j.kind === 'floor' || j.kind === 'stop' || j.kind === 'foot' || j.kind === 'roller' ? 1 : j.kind === 'rope' || j.kind === 'cam' ? -1 : 0);
const normalRow = (j: Joint3) => (j.kind === 'foot' ? 1 : 0);

// pos += Δx, quat ← exp(Δθ/2)⊗quat: the 6-DOF increment applied to the 7-number pose (exact for a fixed axis,
// so a planar machine integrates its angles exactly like the planar RK4)
function applyDelta(q: Float64Array, d: Float64Array, k: number): Float64Array {
  const out = q.slice();
  for (let b = 0; b < out.length / 7; b++) {
    const i = 7 * b, j = 6 * b;
    for (let c = 0; c < 3; c++) out[i + c] += k * d[j + c];
    const [ox, oy, oz] = [k * d[j + 3], k * d[j + 4], k * d[j + 5]];
    const ang = Math.hypot(ox, oy, oz);
    if (!ang) continue;
    const dw = Math.cos(ang / 2), sn = Math.sin(ang / 2) / ang;
    const [dx, dy, dz] = [sn * ox, sn * oy, sn * oz];
    const [w, x, y, z] = [q[i + 3], q[i + 4], q[i + 5], q[i + 6]];
    out[i + 3] = dw * w - dx * x - dy * y - dz * z;
    out[i + 4] = dw * x + w * dx + dy * z - dz * y;
    out[i + 5] = dw * y + w * dy + dz * x - dx * z;
    out[i + 6] = dw * z + w * dz + dx * y - dy * x;
  }
  return normalize(out);
}
function normalize(q: Float64Array): Float64Array {
  for (let i = 3; i < q.length; i += 7) {
    const l = Math.hypot(q[i], q[i + 1], q[i + 2], q[i + 3]);
    for (let c = 0; c < 4; c++) q[i + c] /= l;
  }
  return q;
}

// Inelastic impact / position projection / velocity clean-up: see impulse() in physics/solver.ts.
function impulse(m: Mechanism3, s: State3, active: boolean[], mode: 'settle' | 'positions' | 'velocities', preload: number[] = []): State3 {
  const positions = mode === 'positions';
  const { rows, owner, Y, A } = collectRows(m, s, active);
  const lam = solve(A, Float64Array.from(rows.map((r) => (positions ? -r.C : -r.Cdot))));
  if (mode === 'settle') {
    const tol = 1e-6 * Math.max(...Array.from(lam, Math.abs)) + 1e-9;
    let worst = -1, worstVal = -tol;
    owner.forEach((ji, i) => {
      if (i && owner[i - 1] === ji) return;
      const val = contactSign(m.joints[ji]) * lam[i + normalRow(m.joints[ji])] + (preload[ji] ?? 0);
      if (val < worstVal) (worst = ji), (worstVal = val);
    });
    if (worst >= 0) {
      active[worst] = false;
      return impulse(m, s, active, 'settle', preload);
    }
  }
  const d = new Float64Array(s.v.length);
  for (let i = 0; i < rows.length; i++) for (let c = 0; c < d.length; c++) d[c] += Y[i][c] * lam[i];
  if (positions) return { q: applyDelta(s.q, d, 1), v: s.v };
  return { q: s.q, v: s.v.map((x, c) => x + d[c]) };
}

function rk4(m: Mechanism3, s: State3, active: boolean[], fric: number[], dt: number, a1In?: Float64Array): State3 {
  const stage = (v: Float64Array, a: Float64Array, h: number): State3 => ({ q: applyDelta(s.q, v, h), v: s.v.map((x, c) => x + h * a[c]) });
  const a1 = a1In ?? accelerations3(m, s, active, fric).a;
  const s2 = stage(s.v, a1, dt / 2);
  const a2 = accelerations3(m, s2, active, fric).a;
  const s3 = stage(s2.v, a2, dt / 2);
  const a3 = accelerations3(m, s3, active, fric).a;
  const s4 = stage(s3.v, a3, dt);
  const a4 = accelerations3(m, s4, active, fric).a;
  // the RK4 blend of the stage velocities, applied as one increment (ponytail: exact while each body keeps its spin
  // axis during a step; a tumbling body would want a Lie-group RK4 (RKMK) if precision there ever matters)
  const vBlend = s.v.map((x, c) => (x + 2 * s2.v[c] + 2 * s3.v[c] + s4.v[c]) / 6);
  return { q: applyDelta(s.q, vBlend, dt), v: s.v.map((x, c) => x + (dt / 6) * (a1[c] + 2 * a2[c] + 2 * a3[c] + a4[c])) };
}

const springPE = (m: Mechanism3, s: State3) =>
  (m.springs ?? []).reduce((e, sp) => {
    const P = point3(s, sp.body, sp.local).p;
    const ext = Math.max(0, Math.hypot(sp.anchor[0] - P[0], sp.anchor[1] - P[1], sp.anchor[2] - P[2]) - sp.rest);
    return e + 0.5 * sp.k * ext * ext;
  }, 0);

export function energy3(m: Mechanism3, s: State3) {
  let pe = springPE(m, s);
  const kes = m.bodies.map((b, i) => {
    pe += b.mass * G * s.q[7 * i + 1];
    const w = omega(s, i);
    return 0.5 * b.mass * (s.v[6 * i] ** 2 + s.v[6 * i + 1] ** 2 + s.v[6 * i + 2] ** 2) + 0.5 * dot(w, inertia(m, s, i, w, false));
  });
  return { ke: kes.reduce((a, b) => a + b, 0), pe, kes };
}

export interface Frame3 {
  t: number;
  q: Float64Array;
  v: Float64Array;
  ke: number;
  pe: number;
  kes: number[];
  forces: number[];
  speed: number;
}

export interface Result3 {
  frames: Frame3[];
  release?: { t: number; p: V3; v: V3; speed: number; angle: number };
  flight: V3[];
  range: number; // downrange (world x) at landing
  lateral: number; // sideways drift (world z) at landing
  efficiency: number;
  inputEnergy: number;
  peakForce: number[];
  dissipated: number;
  error?: string;
}

// v0: initial velocities (6 per body), for tests that start in motion
export function simulate3(m: Mechanism3, opts: { dt?: number; tMax?: number; frameEvery?: number; afterRelease?: number; v0?: Float64Array } = {}): Result3 {
  const { dt = 5e-4, tMax = 8, frameEvery = 2, afterRelease = 1 } = opts;
  const nb = m.bodies.length;
  const peakForce = m.joints.map(() => 0);
  const frames: Frame3[] = [];
  const P = m.projectile;
  let prevAngle = -Infinity;
  let s = initialState3(m);
  if (opts.v0) s.v.set(opts.v0);
  if (m.joints.some((j) => j.kind === 'spike' || j.kind === 'foot')) m = { ...m, joints: [...m.joints] };
  const active = m.joints.map((j) => j.kind !== 'spike' && !(contactSign(j) * jointRows3(s, j, nb)[normalRow(j)].C > 1e-6));
  let fric: number[] = [];
  const e0 = energy3(m, s);
  const y0p = s.q[7 * P + 1];
  const cw = m.counterweight;
  const y0cw = cw === undefined ? 0 : s.q[7 * cw + 1];
  const y0pulls = (m.pulls ?? []).map((pl) => point3(s, pl.body, pl.local).p[1]);
  const res: Result3 = { frames, flight: [], range: 0, lateral: 0, efficiency: 0, inputEnergy: 0, peakForce, dissipated: 0 };

  for (let step = 0, t = 0; t < tMax; step++, t = step * dt) {
    if (res.release && t > res.release.t + afterRelease) break;
    let { a: a1, lambda } = accelerations3(m, s, active, fric);
    if (step % frameEvery === 0) {
      const forces = lambda.map((l, ji) => load(m.joints[ji], l));
      frames.push({ t, q: s.q.slice(), v: s.v.slice(), ...energy3(m, s), forces, speed: Math.hypot(s.v[6 * P], s.v[6 * P + 1], s.v[6 * P + 2]) });
    }
    let liftOff = false;
    m.joints.forEach((j, ji) => {
      if (!active[ji]) return;
      if (contactSign(j) * lambda[ji][normalRow(j)] < 0) (active[ji] = false), (liftOff = true);
      else if (!res.release) peakForce[ji] = Math.max(peakForce[ji], load(j, lambda[ji]));
    });
    fric = frictionMagnitudes3(m, lambda);
    if (liftOff) a1 = accelerations3(m, s, active, fric).a;
    const before = s;
    s = rk4(m, s, active, fric, dt, a1);
    m.joints.forEach((j, ji) => {
      if (j.kind === 'foot' && !active[ji]) m.joints[ji] = { kind: 'floor', a: j.a, pa: j.pa, y: 0 };
    });
    let hit = false;
    const wasActive = active.slice();
    m.joints.forEach((j, ji) => {
      if (j.kind === 'spike') {
        const S = point3(s, j.a, j.pa);
        if (S.p[1] < 0 && S.vel[1] < 0) {
          const B = point3(before, j.a, j.pa).p; // bite where the path crossed y = 0 inside the step
          const u = B[1] / (B[1] - S.p[1]);
          (m.joints[ji] = { kind: 'foot', a: j.a, pa: j.pa, at: [B[0] + u * (S.p[0] - B[0]), 0, B[2] + u * (S.p[2] - B[2])] }), (active[ji] = true), (hit = true);
        }
        return;
      }
      const sg = contactSign(j);
      if (active[ji] || !sg || j.kind === 'foot' || (ji === m.sling && res.release)) return;
      const r = jointRows3(s, j, nb)[0];
      if (sg * r.C < 0 && sg * r.Cdot < 0) (active[ji] = true), (hit = true);
    });
    if (hit) {
      const preload = m.joints.map((j, ji) => (wasActive[ji] ? Math.max(0, contactSign(j) * (lambda[ji][normalRow(j)] ?? 0)) * dt : 0));
      s = impulse(m, impulse(m, impulse(m, s, active, 'settle', preload), active, 'positions'), active, 'velocities');
    }
    if (!s.q.every(Number.isFinite)) return { ...res, error: 'Simulação divergiu (geometria impossível?)' };

    if (!res.release) {
      const hitB = m.bodies.findIndex((b, i) => {
        if (i === P) return false;
        if (b.shape.kind === 'disk') return s.q[7 * i + 1] - b.shape.radius < -GROUND_TOL;
        const L = b.shape.length / 2;
        return Math.min(point3(s, i, [-L, 0, 0]).p[1], point3(s, i, [L, 0, 0]).p[1]) < -GROUND_TOL;
      });
      if (hitB >= 0) return { ...res, error: `${m.bodies[hitB].name[0].toUpperCase()}${m.bodies[hitB].name.slice(1)} bate no chão antes da liberação: reduza a haste/braço ou suba o eixo` };
    }
    const pShape = m.bodies[P].shape;
    if (!res.release && s.q[7 * P + 1] < 0.5 * (pShape.kind === 'disk' ? pShape.radius : 0))
      return { ...res, error: 'O projétil bateu no chão antes de ser liberado (funda longa demais ou ângulo inalcançável)' };
    // release: elevation of the velocity (above the horizontal plane) sweeping down through releaseAngle
    const [vx, vy, vz] = [s.v[6 * P], s.v[6 * P + 1], s.v[6 * P + 2]];
    const angle = vx > 0 ? Math.atan2(vy, Math.hypot(vx, vz)) : -Infinity;
    const crossed = prevAngle > m.releaseAngle && angle <= m.releaseAngle && angle > -Infinity;
    const angleBefore = prevAngle;
    prevAngle = angle;
    if (!res.release && crossed && Math.hypot(vx, vy, vz) > 1) {
      active[m.sling] = false;
      const u = (angleBefore - m.releaseAngle) / (angleBefore - angle);
      const lerp = (a: Float64Array, b: Float64Array) => a.map((x, i) => x + u * (b[i] - x));
      const sr: State3 = { q: normalize(lerp(before.q, s.q)), v: lerp(before.v, s.v) };
      const p: V3 = [sr.q[7 * P], sr.q[7 * P + 1], sr.q[7 * P + 2]];
      const v: V3 = [sr.v[6 * P], sr.v[6 * P + 1], sr.v[6 * P + 2]];
      const speed = Math.hypot(...v);
      res.release = { t: t + u * dt, p, v, speed, angle: Math.atan2(v[1], Math.hypot(v[0], v[2])) };
      const mp = m.bodies[P].mass;
      const eProj = 0.5 * mp * speed * speed + mp * G * (p[1] - y0p);
      const work = (m.pulls ?? []).reduce((w, pl, k) => w + pl.force * (y0pulls[k] - Math.max(pl.untilY, point3(sr, pl.body, pl.local).p[1])), 0);
      res.inputEnergy = work + (cw === undefined ? 0 : m.bodies[cw].mass * G * (y0cw - sr.q[7 * cw + 1])) + springPE(m, initialState3(m)) - springPE(m, sr);
      res.efficiency = eProj / res.inputEnergy;
      const e = energy3(m, sr);
      res.dissipated = e0.ke + e0.pe + work - e.ke - e.pe;
      const f = fly3(p, v, dragK3(m), m.air.wind);
      res.flight = f.path; // machine frame (the 3D view turns it with the machine)
      const aim = m.aim ?? 0; // landing point turned into the world: x along the target line, z sideways
      res.range = f.range * Math.cos(aim) + f.lateral * Math.sin(aim);
      res.lateral = -f.range * Math.sin(aim) + f.lateral * Math.cos(aim);
      if (afterRelease <= 0) break;
    }
  }
  if (!res.release) res.error = 'Projétil não foi liberado — ajuste o ângulo de liberação ou a geometria';
  return res;
}
