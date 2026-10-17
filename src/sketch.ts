// Free-form design ("sketch"): everything in world coordinates at the cocked pose.
// compile() turns it into a Mechanism for the solver; toSketch() goes the other way for presets.
import { jointRows } from './physics/constraints';
import type { Body, Joint, Mechanism, Vec } from './physics/model';
import { initialState, startsActive } from './physics/solver';
import { world } from './render';

export type Role = 'projectile' | 'counterweight';
export type SBody =
  | { kind: 'rod'; name: string; a: Vec; b: Vec; mass: number }
  | { kind: 'disk'; name: string; c: Vec; r: number; mass: number; role?: Role };
export type SJoint =
  | { kind: 'pin' | 'weld'; at: Vec; a: number; b: number | 'ground'; mu?: number; radius?: number }
  | { kind: 'rope'; a: number; pa: Vec; b: number | 'ground'; pb: Vec }
  | { kind: 'slider'; a: number; at: Vec; dir: Vec }
  | { kind: 'pull'; a: number; at: Vec; force: number; stroke: number } // crew rope pulled straight down
  | { kind: 'stop'; a: number; b: number | 'ground'; at: Vec } // a rests against b at `at`: may lift off, never pass through
  | { kind: 'foot'; a: number; at: Vec } // spiked foot on the ground at `at`: no slip, may lift off
  | { kind: 'spike'; a: number; at: Vec } // spikes in the air: plant (become a foot) wherever they touch the ground
  | { kind: 'roller'; a: number; at: Vec } // fixed roller under rod a at `at`: the rod slides over it, may lift off
  | { kind: 'floor'; a: number; at: Vec; y: number } // the body point at `at` can't go below height y (a track or the ground to land on)
  | { kind: 'spring'; a: number; at: Vec; anchor: Vec; k: number; rest: number } // spring from the body point to a ground anchor
  | { kind: 'cam'; a: number; b: number; at: Vec; r0: number; r1: number; span: number; over?: Vec }; // drum on body b centered at `at`, its rope holding counterweight a (from a pulley at `over`, if any)

export interface Sketch {
  bodies: SBody[];
  joints: SJoint[];
  releaseDeg: number;
  airDensity: number;
  dragCd: number;
  troughMu: number;
}

export const emptySketch = (): Sketch => ({ bodies: [], joints: [], releaseDeg: 45, airDensity: 1.225, dragCd: 0.47, troughMu: 0.3 });

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ON_GROUND = 0.02; // m: a projectile this close to the ground rests in the trough
const ATTACH_TOL = 0.02; // m: how far a joint point may sit from the body it connects

export function segDist(p: Vec, a: Vec, b: Vec) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
  return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1]]);
}

// [world point, body] pairs a joint connects
export function attachments(j: SJoint): [Vec, number | 'ground'][] {
  if (j.kind === 'rope') return [[j.pa, j.a], [j.pb, j.b]];
  if (j.kind === 'cam') return [[j.at, j.b]];
  if (j.kind !== 'pin' && j.kind !== 'weld' && j.kind !== 'stop') return [[j.at, j.a]];
  return [[j.at, j.a], [j.at, j.b]];
}

const onBody = (b: SBody, p: Vec) => (b.kind === 'rod' ? segDist(p, b.a, b.b) : Math.max(0, dist(p, b.c) - b.r)) <= ATTACH_TOL;

// Joints whose point no longer touches a body they connect. The solver would accept them
// (as an invisible rigid bracket), but the drawing would lie — so they block the shot.
export const detachedJoints = (sk: Sketch) =>
  sk.joints.flatMap((j, i) => (attachments(j).some(([p, b]) => b !== 'ground' && !onBody(sk.bodies[b], p)) ? [i] : []));

function pose(b: SBody) {
  if (b.kind === 'disk') return { pos: b.c, angle: 0 };
  const d = sub(b.b, b.a);
  return { pos: [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2] as Vec, angle: Math.atan2(d[1], d[0]) };
}

function toLocal(b: SBody, w: Vec): Vec {
  const { pos, angle } = pose(b);
  const d = sub(w, pos);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * d[0] + s * d[1], -s * d[0] + c * d[1]];
}

export function compile(sk: Sketch): Mechanism {
  const projectile = sk.bodies.findIndex((b) => b.kind === 'disk' && b.role === 'projectile');
  if (projectile < 0) throw new Error('Falta o projétil: use a ferramenta "Projétil".');
  const loose = detachedJoints(sk).length;
  if (loose) throw new Error(`${loose} conexão(ões) solta(s), marcada(s) em vermelho: o ponto da junta não toca a peça. Arraste-o de volta ou apague a junta.`);
  const bodies: Body[] = sk.bodies.map((b) => {
    const { pos, angle } = pose(b);
    if (b.kind === 'rod') {
      const L = dist(b.a, b.b);
      return { name: b.name, mass: b.mass, inertia: (b.mass * L * L) / 12, pos, angle, shape: { kind: 'rod', length: L } };
    }
    return { name: b.name, mass: b.mass, inertia: (b.role === 'projectile' ? 0.4 : 0.5) * b.mass * b.r * b.r, pos, angle, shape: { kind: 'disk', radius: b.r } };
  });
  const loc = (i: number | 'ground', w: Vec): Vec => (i === 'ground' ? w : toLocal(sk.bodies[i], w));
  const pulls = sk.joints.flatMap((j) =>
    j.kind === 'pull' ? [{ body: j.a, local: loc(j.a, j.at), force: j.force, untilY: Math.max(0, j.at[1] - j.stroke) }] : []);
  const springs = sk.joints.flatMap((j) => (j.kind === 'spring' ? [{ body: j.a, local: loc(j.a, j.at), anchor: j.anchor, k: j.k, rest: j.rest }] : []));
  const joints: Joint[] = sk.joints.filter((j): j is Exclude<SJoint, { kind: 'pull' | 'spring' }> => j.kind !== 'pull' && j.kind !== 'spring').map((j): Joint => {
    switch (j.kind) {
      case 'pin':
        return { kind: 'pin', a: j.a, pa: loc(j.a, j.at), b: j.b, pb: loc(j.b, j.at), ...(j.mu ? { friction: { mu: j.mu, radius: j.radius ?? 0.05 } } : {}) };
      case 'weld':
        return { kind: 'weld', a: j.a, pa: loc(j.a, j.at), b: j.b, pb: loc(j.b, j.at), angle: bodies[j.a].angle - (j.b === 'ground' ? 0 : bodies[j.b].angle) };
      case 'rope':
        return { kind: 'rope', a: j.a, pa: loc(j.a, j.pa), b: j.b, pb: loc(j.b, j.pb), length: dist(j.pa, j.pb) };
      case 'slider':
        return { kind: 'slider', a: j.a, pa: loc(j.a, j.at), origin: j.at, dir: j.dir };
      case 'stop':
        return { kind: 'stop', a: j.a, b: j.b, angle: bodies[j.a].angle - (j.b === 'ground' ? 0 : bodies[j.b].angle) };
      case 'foot':
        return { kind: 'foot', a: j.a, pa: loc(j.a, j.at), at: j.at };
      case 'spike':
        return { kind: 'spike', a: j.a, pa: loc(j.a, j.at) };
      case 'roller': // the rod lies on top of the roller: the face whose normal points up
        return { kind: 'roller', a: j.a, at: j.at, side: Math.cos(bodies[j.a].angle) <= 0 ? -1 : 1 };
      case 'floor':
        return { kind: 'floor', a: j.a, pa: loc(j.a, j.at), y: j.y };
      case 'cam': {
        // rope exactly taut in the drawn pose (it hangs from the pulley, or from the drum itself)
        const top = j.over ? j.over[1] + dist(j.at, j.over) : j.at[1];
        const cw = sk.bodies[j.a];
        const y = cw.kind === 'disk' ? cw.c[1] : (cw.a[1] + cw.b[1]) / 2;
        return { kind: 'cam', a: j.a, b: j.b, hub: loc(j.b, j.at), theta0: bodies[j.b].angle, r0: j.r0, r1: j.r1, span: j.span, length: top - y, ...(j.over ? { over: j.over } : {}) };
      }
    }
  });
  const sling = joints.findIndex((j) => j.kind === 'rope' && (j.a === projectile || j.b === projectile));
  if (sling < 0) throw new Error('Ligue o projétil ao braço com uma corda (a funda).');
  const p = sk.bodies[projectile] as Extract<SBody, { kind: 'disk' }>;
  // trough under the projectile: active if it starts on the ground, open (it can land later) if it hangs
  joints.push({ kind: 'floor', a: projectile, pa: [0, 0], y: p.c[1] - p.r < ON_GROUND ? p.c[1] : p.r, mu: sk.troughMu });
  const cw = sk.bodies.findIndex((b) => b.kind === 'disk' && b.role === 'counterweight');
  const axle = joints.findIndex((j) => (j.kind === 'pin' && j.b === 'ground') || j.kind === 'slider');
  return {
    bodies,
    joints,
    projectile,
    sling,
    axle: axle < 0 ? sling : axle,
    ...(cw >= 0 ? { counterweight: cw } : {}),
    ...(pulls.length ? { pulls } : {}),
    ...(springs.length ? { springs } : {}),
    releaseAngle: (sk.releaseDeg * Math.PI) / 180,
    air: { density: sk.airDensity, cd: sk.dragCd },
  };
}

// Degrees of freedom from the rank of the constraint Jacobian at the start pose.
// Free spins of disks held only at their center (e.g. the projectile) are not counted: they move nothing.
export function analyze(m: Mechanism) {
  const s = initialState(m);
  const on = startsActive(m, s); // a contact that starts open doesn't lock anything
  const rows = m.joints.flatMap((j, i) => (on[i] ? jointRows(s, j, m.bodies.length).map((r) => Array.from(r.J)) : []));
  const A = rows.map((r) => r.slice());
  let rank = 0;
  const cols = 3 * m.bodies.length;
  for (let c = 0; c < cols && rank < A.length; c++) {
    let p = rank;
    for (let r = rank + 1; r < A.length; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) continue;
    [A[rank], A[p]] = [A[p], A[rank]];
    for (let r = 0; r < A.length; r++) {
      if (r === rank) continue;
      const f = A[r][c] / A[rank][c];
      for (let k = c; k < cols; k++) A[r][k] -= f * A[rank][k];
    }
    rank++;
  }
  const atCenter = (p: Vec) => !p[0] && !p[1];
  const freeSpins = m.bodies.filter((b, i) =>
    b.shape.kind === 'disk' &&
    m.joints.every((j) => {
      const onA = j.a === i;
      const onB = 'b' in j && j.b === i;
      if (!onA && !onB) return true;
      if (j.kind === 'weld' || j.kind === 'stop' || !('pa' in j)) return false; // these lock or touch the rotation
      return (!onA || atCenter(j.pa)) && (!onB || atCenter((j as { pb: Vec }).pb));
    }),
  ).length;
  return { dof: cols - rank - freeSpins, redundant: rows.length - rank };
}

// Preset → sketch.
export function toSketch(m: Mechanism, extra: { troughMu: number }): Sketch {
  const q = initialState(m).q;
  const bodies: SBody[] = m.bodies.map((b, i) => {
    if (b.shape.kind === 'rod') {
      const L = b.shape.length / 2;
      return { kind: 'rod', name: b.name, a: world(q, i, [-L, 0]), b: world(q, i, [L, 0]), mass: b.mass };
    }
    const role: Role | undefined = i === m.projectile ? 'projectile' : i === m.counterweight ? 'counterweight' : undefined;
    return { kind: 'disk', name: b.name, c: [b.pos[0], b.pos[1]], r: b.shape.radius, mass: b.mass, ...(role ? { role } : {}) };
  });
  const w = (i: number | 'ground', p: Vec): Vec => (i === 'ground' ? [p[0], p[1]] : world(q, i, p));
  const hangers: SJoint[] = [];
  // A joint off a disk's center (hinged counterweight) means a rigid hanger: make it a visible, near-massless rod.
  const via = (i: number | 'ground', p: Vec): number | 'ground' => {
    const b = bodies[i as number];
    if (i === 'ground' || b.kind !== 'disk' || Math.hypot(p[0], p[1]) <= b.r) return i;
    bodies.push({ kind: 'rod', name: 'haste', a: [b.c[0], b.c[1]], b: w(i, p), mass: b.mass * 1e-4 });
    const hanger = bodies.length - 1;
    hangers.push({ kind: 'weld', at: [b.c[0], b.c[1]], a: hanger, b: i });
    return hanger;
  };
  const joints = m.joints.flatMap((j): SJoint[] => {
    switch (j.kind) {
      case 'pin':
        return [{ kind: 'pin', at: w(j.a, j.pa), a: via(j.a, j.pa) as number, b: via(j.b, j.pb), ...(j.friction ? { mu: j.friction.mu, radius: j.friction.radius } : {}) }];
      case 'weld':
        return [{ kind: 'weld', at: w(j.a, j.pa), a: via(j.a, j.pa) as number, b: via(j.b, j.pb) }];
      case 'rope':
        return [{ kind: 'rope', a: j.a, pa: w(j.a, j.pa), b: j.b, pb: w(j.b, j.pb) }];
      case 'slider':
        return [{ kind: 'slider', a: j.a, at: w(j.a, j.pa), dir: [j.dir[0], j.dir[1]] }];
      case 'stop': {
        // contact point: where body a's center projects onto body b (the counterweight lying on the arm)
        const c: Vec = [q[3 * j.a], q[3 * j.a + 1]];
        let at = c;
        const rb = j.b === 'ground' ? undefined : bodies[j.b];
        if (rb?.kind === 'rod') {
          const ab: Vec = [rb.b[0] - rb.a[0], rb.b[1] - rb.a[1]];
          const t = ((c[0] - rb.a[0]) * ab[0] + (c[1] - rb.a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2);
          at = [rb.a[0] + t * ab[0], rb.a[1] + t * ab[1]];
        }
        return [{ kind: 'stop', a: j.a, b: j.b, at }];
      }
      case 'foot':
        return [{ kind: 'foot', a: j.a, at: [j.at[0], j.at[1]] }];
      case 'floor': // the projectile's trough is regenerated by compile(); other bodies keep their landing surface
        return j.a === m.projectile ? [] : [{ kind: 'floor', a: j.a, at: w(j.a, j.pa), y: j.y }];
      case 'spike':
        return [{ kind: 'spike', a: j.a, at: w(j.a, j.pa) }];
      case 'roller':
        return [{ kind: 'roller', a: j.a, at: [j.at[0], j.at[1]] }];
      case 'cam':
        return [{ kind: 'cam', a: j.a, b: j.b, at: w(j.b, j.hub), r0: j.r0, r1: j.r1, span: j.span, ...(j.over ? { over: [j.over[0], j.over[1]] as Vec } : {}) }];
    }
  });
  for (const sp of m.springs ?? []) joints.push({ kind: 'spring', a: sp.body, at: w(sp.body, sp.local), anchor: [sp.anchor[0], sp.anchor[1]], k: sp.k, rest: sp.rest });
  joints.push(...hangers);
  for (const pl of m.pulls ?? []) {
    const at = w(pl.body, pl.local);
    joints.push({ kind: 'pull', a: pl.body, at, force: pl.force, stroke: at[1] - pl.untilY });
  }
  return { bodies, joints, releaseDeg: (m.releaseAngle * 180) / Math.PI, airDensity: m.air.density, dragCd: m.air.cd, troughMu: extra.troughMu };
}

// Every coordinate in the sketch, so coincident points can be dragged together.
export function allPoints(sk: Sketch): Vec[] {
  return [
    ...sk.bodies.flatMap((b) => (b.kind === 'rod' ? [b.a, b.b] : [b.c])),
    ...sk.joints.flatMap((j) => (j.kind === 'rope' ? [j.pa, j.pb] : j.kind === 'spring' ? [j.at, j.anchor] : j.kind === 'cam' && j.over ? [j.at, j.over] : [j.at])),
  ];
}

export function removeBody(sk: Sketch, i: number) {
  sk.bodies.splice(i, 1);
  const re = (k: number | 'ground') => (k === 'ground' ? k : k > i ? k - 1 : k);
  sk.joints = sk.joints
    .filter((j) => j.a !== i && (!('b' in j) || j.b !== i))
    .map((j) => ({ ...j, a: re(j.a) as number, ...('b' in j ? { b: re(j.b) } : {}) }) as SJoint);
}

// Untrusted JSON → Sketch: keep only well-formed numbers, indices in range, known kinds.
export function sanitizeSketch(raw: unknown): Sketch {
  const r = raw as Partial<Sketch>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const vec = (v: unknown): Vec => (Array.isArray(v) ? [num(v[0], 0), num(v[1], 0)] : [0, 0]);
  const pos = (v: unknown, d: number) => Math.max(1e-3, num(v, d));
  const sk = emptySketch();
  if (!r || typeof r !== 'object') return sk;
  for (const b of Array.isArray(r.bodies) ? (r.bodies as SBody[]) : []) {
    const name = String(b?.name ?? 'corpo').slice(0, 40);
    if (b?.kind === 'rod') sk.bodies.push({ kind: 'rod', name, a: vec(b.a), b: vec(b.b), mass: pos(b.mass, 10) });
    else if (b?.kind === 'disk') {
      const role = b.role === 'projectile' || b.role === 'counterweight' ? b.role : undefined;
      sk.bodies.push({ kind: 'disk', name, c: vec(b.c), r: pos(b.r, 0.1), mass: pos(b.mass, 10), ...(role ? { role } : {}) });
    }
  }
  const n = sk.bodies.length;
  const idx = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : -1);
  const ref = (v: unknown) => (v === 'ground' ? 'ground' : idx(v));
  for (const j of Array.isArray(r.joints) ? (r.joints as SJoint[]) : []) {
    const a = idx(j?.a);
    if (a < 0) continue;
    if (j.kind === 'pin' || j.kind === 'weld') {
      const b = ref(j.b);
      if (b === -1) continue;
      sk.joints.push({ kind: j.kind, at: vec(j.at), a, b, ...(j.kind === 'pin' && j.mu ? { mu: num(j.mu, 0), radius: pos(j.radius, 0.05) } : {}) });
    } else if (j.kind === 'rope') {
      const b = ref(j.b);
      if (b !== -1) sk.joints.push({ kind: 'rope', a, pa: vec(j.pa), b, pb: vec(j.pb) });
    } else if (j.kind === 'slider') {
      const dir = vec(j.dir);
      if (dir[0] || dir[1]) sk.joints.push({ kind: 'slider', a, at: vec(j.at), dir });
    } else if (j.kind === 'pull') {
      sk.joints.push({ kind: 'pull', a, at: vec(j.at), force: pos(j.force, 8000), stroke: pos(j.stroke, 2) });
    } else if (j.kind === 'foot') {
      sk.joints.push({ kind: 'foot', a, at: vec(j.at) });
    } else if (j.kind === 'stop') {
      const b = ref(j.b);
      if (b !== -1) sk.joints.push({ kind: 'stop', a, b, at: vec(j.at) });
    } else if (j.kind === 'spike' || j.kind === 'roller') {
      sk.joints.push({ kind: j.kind, a, at: vec(j.at) });
    } else if (j.kind === 'floor') {
      sk.joints.push({ kind: 'floor', a, at: vec(j.at), y: num(j.y, 0) });
    } else if (j.kind === 'spring') {
      sk.joints.push({ kind: 'spring', a, at: vec(j.at), anchor: vec(j.anchor), k: pos(j.k, 7000), rest: pos(j.rest, 1) });
    } else if (j.kind === 'cam') {
      const b = idx(j.b);
      const at = vec(j.at);
      const over = Array.isArray(j.over) ? vec(j.over) : undefined;
      if (b !== -1 && b !== a) sk.joints.push({ kind: 'cam', a, b, at, r0: pos(j.r0, 0.8), r1: pos(j.r1, 0.2), span: pos(j.span, 1), ...(over && over[1] > at[1] ? { over } : {}) });
    }
  }
  sk.releaseDeg = num(r.releaseDeg, 45);
  sk.airDensity = Math.max(0, num(r.airDensity, 1.225));
  sk.dragCd = Math.max(0, num(r.dragCd, 0.47));
  sk.troughMu = Math.max(0, num(r.troughMu, 0.3));
  return sk;
}
