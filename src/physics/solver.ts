import { jointRows, point, type Row, type State } from './constraints';
import { fly } from './ballistics';
import { anchor, bendingPeak } from './bending';
import { G, type Mechanism, type Vec } from './model';

const GROUND_TOL = 0.02; // m of penetration tolerated before a part counts as hitting the ground
const STAB = 100; // Baumgarte stabilization frequency (rad/s): pulls drifted constraints back

export function dragK(m: Mechanism): number {
  const p = m.bodies[m.projectile];
  const r = p.shape.kind === 'disk' ? p.shape.radius : 0;
  return (0.5 * m.air.density * m.air.cd * Math.PI * r * r) / p.mass;
}

export function initialState(m: Mechanism): State {
  const n = m.bodies.length;
  const q = new Float64Array(3 * n);
  m.bodies.forEach((b, i) => q.set([b.pos[0], b.pos[1], b.angle], 3 * i));
  return { q, v: new Float64Array(3 * n) };
}

export function solve(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

// M·a = F + Jᵀλ,  J·a = bias  →  (J M⁻¹ Jᵀ) λ = bias − J M⁻¹ F.  λ per joint = reaction force on body a.
const V_SLIP = 0.01; // m/s or rad/s: tanh smooths Coulomb's sign() so the integrator doesn't chatter at v≈0

// Coulomb friction, solved together with the constraints: its magnitude is linear in the joint's own multipliers
// (μ·λ_normal), so it is folded into the joint's column, Ĵ = J + c·D (D: unit friction force as a generalized force,
// c: how the magnitude depends on each row's λ), and the system becomes J M⁻¹ Ĵᵀ λ = … (no longer symmetric).
// Floor and roller contacts are exact; a journal's |F| and a two-sided track's sign come from the previous step's
// multipliers (prev), only the direction/sign lags, never the magnitude.
// ponytail: no stiction (tanh-regularized sign; measured ≤ 0.019 % effect on every preset at 10× sharper)
// Did a friction direction move? (the first `rowsOf(j)` multipliers of each friction joint, as a vector: a journal's
// reaction, a two-sided track's normal): turned by more than ~2.5°, flipped, or appeared.
export function frictionDirsChanged<J>(joints: J[], active: boolean[], dirs: number[][], cur: number[][], rowsOf: (j: J) => number) {
  return joints.some((j, ji) => {
    const n = rowsOf(j);
    if (!n || !active[ji]) return false;
    const a = (dirs[ji] ?? []).slice(0, n), b = cur[ji].slice(0, n);
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    if (!lb) return false;
    return !la || a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0) / (la * lb) < 0.999;
  });
}

function frictionColumns(m: Mechanism, s: State, active: boolean[], prev: number[][], n: number) {
  const cols = new Map<number, { c: number[]; D: Float64Array }>(); // joint index → per-row coefficients, direction
  m.joints.forEach((j, ji) => {
    if (!active[ji]) return;
    const D = new Float64Array(n);
    let c: number[] | undefined;
    if (j.kind === 'pin' && j.friction) {
      const l = prev[ji] ?? [], L = Math.hypot(l[0] ?? 0, l[1] ?? 0);
      if (!L) return;
      const k = j.friction.mu * j.friction.radius;
      c = [(k * l[0]) / L, (k * l[1]) / L]; // |F| ≈ û·F with û the previous reaction's direction
      const t = Math.tanh((s.v[3 * j.a + 2] - (j.b === 'ground' ? 0 : s.v[3 * j.b + 2])) / V_SLIP);
      D[3 * j.a + 2] = -t;
      if (j.b !== 'ground') D[3 * j.b + 2] = t;
    } else if (j.kind === 'floor' && j.mu) {
      const P = point(s, j.a, j.pa);
      const t = Math.tanh(P.vel[0] / V_SLIP);
      c = [j.mu];
      (D[3 * j.a] = -t), (D[3 * j.a + 2] = P.r[1] * t);
    } else if ((j.kind === 'slider' || j.kind === 'roller') && j.mu) {
      // rolling resistance against the motion along the track (slider) or along the rod over the roller
      let r: Vec, vel: Vec, e: Vec;
      if (j.kind === 'slider') {
        const P = point(s, j.a, j.pa);
        const L = Math.hypot(...j.dir);
        (r = P.r), (vel = P.vel), (e = [j.dir[0] / L, j.dir[1] / L]);
        const sg = Math.sign(prev[ji]?.[0] ?? 0); // two-sided track: which face carries the load
        if (!sg) return;
        c = [j.mu * sg];
      } else {
        const i = 3 * j.a, w = s.v[i + 2];
        r = [j.at[0] - s.q[i], j.at[1] - s.q[i + 1]]; // rod material point over the roller
        (vel = [s.v[i] - w * r[1], s.v[i + 1] + w * r[0]]), (e = [Math.cos(s.q[i + 2]), Math.sin(s.q[i + 2])]);
        c = [j.mu];
      }
      const t = -Math.tanh((vel[0] * e[0] + vel[1] * e[1]) / V_SLIP);
      (D[3 * j.a] = t * e[0]), (D[3 * j.a + 1] = t * e[1]), (D[3 * j.a + 2] = t * (r[0] * e[1] - r[1] * e[0]));
    }
    if (c) cols.set(ji, { c, D });
  });
  return cols;
}

// Per-mechanism constants (inverse masses, gravity, drag factor), computed once instead of every call.
// ponytail: keyed by object identity — a mechanism must not change masses after its first simulation
const constCache = new WeakMap<Mechanism, { invM: Float64Array; F0: Float64Array; drag: number }>();
function constants(m: Mechanism) {
  let c = constCache.get(m);
  if (!c) {
    const n = 3 * m.bodies.length;
    const invM = new Float64Array(n);
    const F0 = new Float64Array(n);
    m.bodies.forEach((b, i) => {
      invM[3 * i] = invM[3 * i + 1] = 1 / b.mass;
      invM[3 * i + 2] = 1 / b.inertia;
      F0[3 * i + 1] = -b.mass * G;
    });
    c = { invM, F0, drag: dragK(m) * m.bodies[m.projectile].mass };
    constCache.set(m, c);
  }
  return c;
}

export function accelerations(m: Mechanism, s: State, active: boolean[], prev: number[][] = []) {
  const nb = m.bodies.length;
  const n = 3 * nb;
  const { invM, F0, drag } = constants(m);
  const F = F0.slice();
  const p = 3 * m.projectile;
  const kd = drag * Math.hypot(s.v[p], s.v[p + 1]);
  F[p] -= kd * s.v[p];
  F[p + 1] -= kd * s.v[p + 1];
  for (const pl of m.pulls ?? []) {
    const P = point(s, pl.body, pl.local);
    if (P.p[1] > pl.untilY) {
      F[3 * pl.body + 1] -= pl.force;
      F[3 * pl.body + 2] -= P.r[0] * pl.force;
    }
  }

  for (const sp of m.springs ?? []) {
    const P = point(s, sp.body, sp.local);
    const dx = sp.anchor[0] - P.p[0], dy = sp.anchor[1] - P.p[1];
    const L = Math.hypot(dx, dy);
    if (L <= sp.rest) continue;
    const fx = (sp.k * (L - sp.rest) * dx) / L, fy = (sp.k * (L - sp.rest) * dy) / L;
    F[3 * sp.body] += fx;
    F[3 * sp.body + 1] += fy;
    F[3 * sp.body + 2] += P.r[0] * fy - P.r[1] * fx;
  }

  const rows: Row[] = [];
  const owner: number[] = [];
  for (let ji = 0; ji < m.joints.length; ji++) {
    if (!active[ji]) continue;
    for (const r of jointRows(s, m.joints[ji], nb)) rows.push(r), owner.push(ji);
  }
  const k = rows.length;
  // Each row touches at most two bodies (≤6 nonzeros): iterate only those. Skipped terms are exact zeros.
  const nzOf = (J: Float64Array) => {
    const idx: number[] = [];
    for (let c = 0; c < n; c++) if (J[c] !== 0) idx.push(c);
    return idx;
  };
  const nz = rows.map((r) => nzOf(r.J));
  const perJoint = (lam: Float64Array) => {
    const l: number[][] = m.joints.map(() => []);
    for (let i = 0; i < k; i++) l[owner[i]].push(lam[i]);
    return l;
  };
  // friction directions/sides come from `dirs`; if the solve says a journal's reaction turned or a track's load changed
  // side, solve again with the new ones (at most twice): no step of lag even when a two-sided track's load flips
  let dirs = prev;
  let sys = system(dirs);
  for (let it = 0; it < 2; it++) {
    const cur = perJoint(sys.lam);
    if (!frictionDirsChanged(m.joints, active, dirs, cur, (j) => (j.kind === 'pin' && j.friction ? 2 : j.kind === 'slider' && j.mu ? 1 : 0))) break;
    (dirs = cur), (sys = system(dirs));
  }
  const { lam, Jh, nzh } = sys;
  const f = F.slice();
  for (let i = 0; i < k; i++) for (const c of nzh[i]) f[c] += Jh[i][c] * lam[i];
  const a = new Float64Array(n);
  for (let c = 0; c < n; c++) a[c] = invM[c] * f[c];
  return { a, lambda: perJoint(lam) };

  function system(dirs: number[][]) {
  // Ĵ: the rows' force directions with their joint's friction folded in (row r of a joint gets c[r]·D)
  const fc = frictionColumns(m, s, active, dirs, n);
  const Jh = rows.map((r, i) => {
    const col = fc.get(owner[i]);
    if (!col) return r.J;
    const rIn = i - owner.indexOf(owner[i]), cr = col.c[rIn] ?? 0;
    return cr ? r.J.map((x, c) => x + cr * col.D[c]) : r.J;
  });
  const nzh = Jh.map((J, i) => (J === rows[i].J ? nz[i] : nzOf(J)));
  const A = rows.map(() => new Float64Array(k));
  const rhs = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const Ji = rows[i].J;
    let jf = 0;
    for (const c of nz[i]) jf += Ji[c] * invM[c] * F[c];
    rhs[i] = rows[i].bias - 2 * STAB * rows[i].Cdot - STAB * STAB * rows[i].C - jf;
    for (let j = 0; j < k; j++) {
      let sum = 0;
      for (const c of nz[i]) sum += Ji[c] * invM[c] * Jh[j][c];
      A[i][j] = sum;
    }
    // ponytail: tiny regularization so redundant joints (free editor) stay solvable; least-squares if it misbehaves
    A[i][i] += 1e-10 * A[i][i] + 1e-14;
  }
  return { lam: solve(A, rhs), Jh, nzh };
  }
}

// Classic RK4 on (q, v). Plain loops, same arithmetic order as the textbook form (results are bit-identical
// to the earlier .map() version); stage velocities double as the stage dq.
// Unilateral joints and their sign σ: active while σλ ≥ 0, open while σC > 0.
// Floor/stop push (λ ≥ 0, open when C > 0); a rope only pulls (λ ≤ 0) and goes slack when shorter than its length.
const contactSign = (j: Mechanism['joints'][number]) => (j.kind === 'floor' || j.kind === 'stop' || j.kind === 'foot' || j.kind === 'roller' ? 1 : j.kind === 'rope' || j.kind === 'cam' ? -1 : 0);
// Joints in force at the start: contacts that start open (a stone hanging above its trough, wheels above their
// track) and spikes still in the air don't hold anything yet.
export const startsActive = (m: Mechanism, s: State) =>
  m.joints.map((j) => j.kind !== 'spike' && !(contactSign(j) * jointRows(s, j, m.bodies.length)[normalRow(j)].C > 1e-6));
// which row carries the normal force (a foot's first row is the no-slip grip)
const normalRow = (j: Mechanism['joints'][number]) => (j.kind === 'foot' ? 1 : 0);

// Inelastic impact: project velocities so every active constraint has zero relative velocity
// (M Δv = Jᵀ Λ, J (v + Δv) = 0). Momentum flows through the other joints; the lost energy is the thud.
// With positions: true, the same projection removes the penetration (Δq from C) so the Baumgarte term
// doesn't turn it into a spurious force spike afterwards.
// Velocity impulses also settle the active set: a unilateral joint whose impulse comes out with the wrong sign
// lets go instead (a counterweight landing slackens its rope rather than braking the spinning arm through it).
// mode: 'settle' = the impact itself (velocities, and decides who lets go); 'positions' = remove penetration;
// 'velocities' = clean-up after the position fix (tiny residuals: must not unplant a foot that just bit).
// preload[ji]: impulse a resting contact already carries this step (normal force × dt). A jerk elsewhere only
// unloads it by that much before it would really have to pull (a foot holding up the whole machine must not let go
// over a tiny sling twitch); contacts just closing have none.
// bounce: contacts closing in this impact that rebound with −e × their approach speed (normal row only)
function impulse(m: Mechanism, s: State, active: boolean[], mode: 'settle' | 'positions' | 'velocities', preload: number[] = [], bounce?: Set<number>): State {
  const positions = mode === 'positions';
  const nb = m.bodies.length;
  const n = 3 * nb;
  const { invM } = constants(m);
  const rows: Row[] = [];
  const owner: number[] = [];
  m.joints.forEach((j, ji) => active[ji] && jointRows(s, j, nb).forEach((r) => (rows.push(r), owner.push(ji))));
  const k = rows.length;
  const A = rows.map(() => new Float64Array(k));
  const rhs = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    rhs[i] = positions ? -rows[i].C : -rows[i].Cdot * (1 + bounceRow(m, bounce, owner, i, rows[i].Cdot, contactSign));
    for (let j = 0; j < k; j++) {
      let sum = 0;
      for (let c = 0; c < n; c++) sum += rows[i].J[c] * invM[c] * rows[j].J[c];
      A[i][j] = sum;
    }
    A[i][i] += 1e-10 * A[i][i] + 1e-14;
  }
  const lam = solve(A, rhs);
  if (mode === 'settle') {
    // drop the WORST offender only, then re-solve: the others may be needed once it's gone (greedy-first got a
    // landing wrong: it slackened the sling because of the roller's pull, then the sling re-tensioned with a jerk)
    const tol = 1e-6 * Math.max(...lam.map(Math.abs)) + 1e-9; // relative, with a floor for an all-zero set
    let worst = -1, worstVal = -tol;
    owner.forEach((ji, i) => {
      if (i && owner[i - 1] === ji) return; // one check per joint, on its normal row
      const val = contactSign(m.joints[ji]) * lam[i + normalRow(m.joints[ji])] + (preload[ji] ?? 0);
      if (val < worstVal) (worst = ji), (worstVal = val);
    });
    if (worst >= 0) {
      active[worst] = false;
      return impulse(m, s, active, 'settle', preload, bounce);
    }
  }
  const out = (positions ? s.q : s.v).slice();
  for (let i = 0; i < k; i++) for (let c = 0; c < n; c++) out[c] += invM[c] * rows[i].J[c] * lam[i];
  return positions ? { q: out, v: s.v } : { q: s.q, v: out };
}

// Restitution of row i: only a bouncing contact's first (normal) row, and only for a real approach (slower than
// V_REST it just settles: no endless micro-bounces).
const V_REST = 0.1; // m/s
// (shared with the 3D solver: `sign` is the solver's contactSign)
export const bounceRow = <J>(m: { restitution?: number; joints: J[] }, bounce: Set<number> | undefined, owner: number[], i: number, Cdot: number, sign: (j: J) => number) =>
  bounce?.has(owner[i]) && (i === 0 || owner[i - 1] !== owner[i]) && sign(m.joints[owner[i]]) * Cdot < -V_REST ? (m.restitution ?? 0) : 0;
// After a bouncing impact the rebounding contacts open (they fly apart until they land again).
export function reboundOpen(bounce: Set<number>, active: boolean[], rowOf: (ji: number) => { Cdot: number }, sign: (ji: number) => number) {
  for (const ji of bounce) if (active[ji] && sign(ji) * rowOf(ji).Cdot > 1e-6) active[ji] = false;
}

function rk4(m: Mechanism, s: State, active: boolean[], prev: number[][], dt: number, a1In?: Float64Array): State {
  const n = s.q.length;
  const h = dt / 2;
  const stage = (src: State, dq: Float64Array, dv: Float64Array, step: number): State => {
    const q = new Float64Array(n);
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) (q[i] = src.q[i] + step * dq[i]), (v[i] = src.v[i] + step * dv[i]);
    return { q, v };
  };
  const a1 = a1In ?? accelerations(m, s, active, prev).a;
  const s2 = stage(s, s.v, a1, h);
  const a2 = accelerations(m, s2, active, prev).a;
  const s3 = stage(s, s2.v, a2, h);
  const a3 = accelerations(m, s3, active, prev).a;
  const s4 = stage(s, s3.v, a3, dt);
  const a4 = accelerations(m, s4, active, prev).a;
  const q = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    q[i] = s.q[i] + (dt / 6) * (s.v[i] + 2 * s2.v[i] + 2 * s3.v[i] + s4.v[i]);
    v[i] = s.v[i] + (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]);
  }
  return { q, v };
}

const springPE = (m: Mechanism, s: State) =>
  (m.springs ?? []).reduce((e, sp) => {
    const P = point(s, sp.body, sp.local).p;
    const ext = Math.max(0, Math.hypot(sp.anchor[0] - P[0], sp.anchor[1] - P[1]) - sp.rest);
    return e + 0.5 * sp.k * ext * ext;
  }, 0);

// pe = gravity + elastic (springs)
export function energy(m: Mechanism, s: State) {
  let pe = springPE(m, s);
  const kes = m.bodies.map((b, i) => {
    pe += b.mass * G * s.q[3 * i + 1];
    return 0.5 * b.mass * (s.v[3 * i] ** 2 + s.v[3 * i + 1] ** 2) + 0.5 * b.inertia * s.v[3 * i + 2] ** 2;
  });
  return { ke: kes.reduce((a, b) => a + b, 0), pe, kes };
}

export interface Frame {
  t: number;
  q: Float64Array;
  ke: number;
  pe: number;
  kes: number[]; // kinetic energy per body
  forces: number[]; // |reaction| per joint, N (0 when inactive)
  speed: number; // projectile
}

export interface Result {
  frames: Frame[];
  release?: { t: number; p: Vec; v: Vec; speed: number; angle: number };
  flight: Vec[];
  range: number;
  efficiency: number; // projectile energy at release / energy put in (counterweight drop + crew work + springs)
  inputEnergy: number; // J, counterweight drop + crew work + spring energy released, until release
  peakForce: number[]; // per joint, N (until release)
  peakBending?: { moment: number; fromAxle: number; long: boolean; t: number }; // the arm's worst section until release: N·m, m from the axle, on the long (sling) side?
  dissipated: number; // J lost to friction + air + impacts until release
  error?: string;
}

export function simulate(
  m: Mechanism,
  opts: { dt?: number; tMax?: number; frameEvery?: number; afterRelease?: number; v0?: Float64Array } = {}, // v0: initial velocities, for tests
): Result {
  // dt 0.5 ms: ≤0.001% range error vs 0.1 ms now that release is interpolated; frames stay 1 ms apart
  const { dt = 5e-4, tMax = 8, frameEvery = 2, afterRelease = 1 } = opts;
  const peakForce = m.joints.map(() => 0);
  const frames: Frame[] = [];
  const P = 3 * m.projectile;
  let prevAngle = -Infinity; // velocity direction at the previous step, only while moving forward
  let s = initialState(m);
  if (opts.v0) s.v.set(opts.v0);
  // spikes become feet where they land: work on a copy of the joint list so the caller's mechanism stays reusable
  if (m.joints.some((j) => j.kind === 'spike' || j.kind === 'foot')) m = { ...m, joints: [...m.joints] };
  const active = startsActive(m, s);
  let prev: number[][] = []; // last step's multipliers: friction directions (journals) and track sides
  const e0 = energy(m, s);
  const y0p = s.q[P + 1];
  const cw = m.counterweight;
  const y0cw = cw === undefined ? 0 : s.q[3 * cw + 1];
  const y0pulls = (m.pulls ?? []).map((pl) => point(s, pl.body, pl.local).p[1]);
  const res: Result = { frames, flight: [], range: 0, efficiency: 0, inputEnergy: 0, peakForce, dissipated: 0 };
  const arm = (m.joints[m.axle] as { a?: number } | undefined)?.a; // the axle's body is the throwing arm

  for (let step = 0, t = 0; t < tMax; step++, t = step * dt) {
    if (res.release && t > res.release.t + afterRelease) break;

    // This evaluation gives the reaction forces AND serves as RK4's first stage (saves 1 of 5 calls per step).
    let { a: a1, lambda } = accelerations(m, s, active, prev);
    if (step % frameEvery === 0) {
      const forces = lambda.map((l) => Math.hypot(...l));
      frames.push({ t, q: s.q.slice(), ...energy(m, s), forces, speed: Math.hypot(s.v[P], s.v[P + 1]) });
      const bend = !res.release && arm !== undefined ? bendingPeak(m, s, active, a1, lambda, arm) : undefined;
      if (bend && bend.moment > (res.peakBending?.moment ?? 0)) {
        const ax = anchor(m, s, m.joints[m.axle], arm!)?.[0] ?? 0, sl = anchor(m, s, m.joints[m.sling], arm!)?.[0] ?? ax + 1;
        res.peakBending = { moment: bend.moment, fromAxle: Math.abs(bend.x - ax), long: (bend.x - ax) * (sl - ax) > 0, t };
      }
    }
    let liftOff = false;
    m.joints.forEach((j, ji) => {
      if (!active[ji]) return;
      // unilateral joints let go once they'd need the wrong sign: contacts would pull, ropes would push
      // (the released sling is already inactive, so it never comes back here)
      if (contactSign(j) * lambda[ji][normalRow(j)] < 0) (active[ji] = false), (liftOff = true);
      else if (!res.release) peakForce[ji] = Math.max(peakForce[ji], Math.hypot(...lambda[ji]));
    });

    // Friction uses this step's normal forces from the next step on; the first stage keeps the previous
    // magnitudes (one more evaluation of lag, still within the existing lagged-friction approximation).
    prev = lambda;
    if (liftOff) a1 = accelerations(m, s, active, prev).a; // the active set changed: first stage must see it
    const before = s;
    s = rk4(m, s, active, prev, dt, a1);
    // re-contact: an open contact closing with approaching velocity becomes active with an inelastic impact
    // ponytail: no restitution (stones and counterweights thud, they don't bounce); add e·Cdot if it matters
    // a spiked foot that let go (lifted, or dropped by an impact) stays a plain ground contact: the part may land on
    // the floor again but never sinks through it (no re-plant: the spikes' no-slip grip is gone)
    m.joints.forEach((j, ji) => {
      if (j.kind === 'foot' && !active[ji]) m.joints[ji] = { kind: 'floor', a: j.a, pa: j.pa, y: 0 };
    });
    let hit = false;
    let uHit = 1; // where inside the step the first new contact closed (0 = start, 1 = end)
    const bounce = new Set<number>(); // contacts closing now that may rebound (restitution)
    const wasActive = active.slice();
    m.joints.forEach((j, ji) => {
      if (j.kind === 'spike') {
        const P = point(s, j.a, j.pa);
        if (P.p[1] < 0 && P.vel[1] < 0) {
          const B = point(before, j.a, j.pa).p; // bite where the path crossed y = 0 inside the step, not at its end
          const x = B[0] + ((P.p[0] - B[0]) * B[1]) / (B[1] - P.p[1]);
          (m.joints[ji] = { kind: 'foot', a: j.a, pa: j.pa, at: [x, 0] }), (active[ji] = true), (hit = true);
          if (B[1] > 0) uHit = Math.min(uHit, B[1] / (B[1] - P.p[1]));
        }
        return;
      }
      const sg = contactSign(j);
      if (active[ji] || !sg || j.kind === 'foot' || (ji === m.sling && res.release)) return;
      const r = jointRows(s, j, m.bodies.length)[0];
      if (sg * r.C < 0 && sg * r.Cdot < 0) {
        (active[ji] = true), (hit = true), sg > 0 && m.restitution && bounce.add(ji);
        const Cb = sg * jointRows(before, j, m.bodies.length)[0].C;
        if (Cb > 0) uHit = Math.min(uHit, Cb / (Cb - sg * r.C));
      }
    });
    if (hit) {
      // The impact happens where the contact closed, not at the end of the step (that shifted F2K's landing by up to a
      // step: 0.29 % range at 2 ms): back up to that instant (linear in the step), hit there, then finish the step.
      const partial = uHit < 1 - 1e-9;
      if (partial) s = { q: before.q.map((x, c) => x + uHit * (s.q[c] - x)), v: before.v.map((x, c) => x + uHit * (s.v[c] - x)) };
      const preload = m.joints.map((j, ji) => (wasActive[ji] ? Math.max(0, contactSign(j) * (lambda[ji][normalRow(j)] ?? 0)) * dt : 0));
      s = impulse(m, s, active, 'settle', preload, bounce);
      if (bounce.size) reboundOpen(bounce, active, (ji) => jointRows(s, m.joints[ji], m.bodies.length)[0], (ji) => contactSign(m.joints[ji]));
      s = impulse(m, impulse(m, s, active, 'positions'), active, 'velocities');
      if (partial) s = rk4(m, s, active, prev, (1 - uHit) * dt);
    }
    if (!s.q.every(Number.isFinite)) return { ...res, error: 'Simulação divergiu (geometria impossível?)' };

    const vx = s.v[P];
    const vy = s.v[P + 1];
    // Machine parts can't pass through the ground (e.g. a long hanger swinging the counterweight into it).
    // ponytail: checked as failure, not as contact — dig-a-pit designs would need a ground profile
    if (!res.release) {
      const hit = m.bodies.findIndex((b, i) => {
        if (i === m.projectile) return false;
        if (b.shape.kind === 'disk') return s.q[3 * i + 1] - b.shape.radius < -GROUND_TOL;
        const L = b.shape.length / 2;
        return Math.min(point(s, i, [-L, 0]).p[1], point(s, i, [L, 0]).p[1]) < -GROUND_TOL;
      });
      if (hit >= 0) return { ...res, error: `${m.bodies[hit].name[0].toUpperCase()}${m.bodies[hit].name.slice(1)} bate no chão antes da liberação: reduza a haste/braço ou suba o eixo` };
    }
    // ponytail: no ground contact after lift-off — a stone falling back to the ground before release is a failed shot, not a bounce
    const pShape = m.bodies[m.projectile].shape;
    if (!res.release && s.q[P + 1] < 0.5 * (pShape.kind === 'disk' ? pShape.radius : 0))
      return { ...res, error: 'O projétil bateu no chão antes de ser liberado (funda longa demais ou ângulo inalcançável)' };
    // Release = the forward velocity direction sweeping DOWN through the release angle between two steps,
    // as when the ring slips off the pin while the sling passes over the arm. A continuous crossing excludes
    // a stone dragged forward along the ground (stays at 0°) and one falling back (atan2 jumps across ±90°).
    const angle = vx > 0 ? Math.atan2(vy, vx) : -Infinity;
    const crossed = prevAngle > m.releaseAngle && angle <= m.releaseAngle && angle > -Infinity;
    const angleBefore = prevAngle;
    prevAngle = angle;
    if (!res.release && crossed && Math.hypot(vx, vy) > 1) {
      active[m.sling] = false;
      // The crossing happened somewhere inside this step: interpolate the state to the exact instant, so the
      // release isn't quantized to step boundaries (that error was O(dt) and dominated RK4's O(dt⁴)).
      const u = (angleBefore - m.releaseAngle) / (angleBefore - angle);
      const lerp = (a: Float64Array, b: Float64Array) => a.map((x, i) => x + u * (b[i] - x));
      const sr: State = { q: lerp(before.q, s.q), v: lerp(before.v, s.v) };
      const p: Vec = [sr.q[P], sr.q[P + 1]];
      const v: Vec = [sr.v[P], sr.v[P + 1]];
      const speed = Math.hypot(v[0], v[1]);
      res.release = { t: t + u * dt, p, v, speed, angle: Math.atan2(v[1], v[0]) };
      const mp = m.bodies[m.projectile].mass;
      const eProj = 0.5 * mp * speed * speed + mp * G * (p[1] - y0p);
      const work = (m.pulls ?? []).reduce((w, pl, k) => w + pl.force * (y0pulls[k] - Math.max(pl.untilY, point(sr, pl.body, pl.local).p[1])), 0);
      res.inputEnergy = work + (cw === undefined ? 0 : m.bodies[cw].mass * G * (y0cw - sr.q[3 * cw + 1])) + springPE(m, initialState(m)) - springPE(m, sr);
      res.efficiency = eProj / res.inputEnergy;
      const e = energy(m, sr);
      res.dissipated = e0.ke + e0.pe + work - e.ke - e.pe;
      const f = fly(p, v, dragK(m));
      res.flight = f.path;
      res.range = f.range;
      if (afterRelease <= 0) break;
    }
  }
  if (!res.release) res.error = 'Projétil não foi liberado — ajuste o ângulo de liberação ou a geometria';
  return res;
}
