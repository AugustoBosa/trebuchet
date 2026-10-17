// 3D side of the free-form sketch: points may sit off the 2D plane (Depth, edited in the 3D view).
// compile3() = compile() with real depths; a sketch without depths compiles to exactly lift(compile()).
import type { Vec } from './physics/model';
import { twist } from './physics3d/constraints3';
import { lift } from './physics3d/lift';
import { add, axisAngle, cross, norm, rotateInv, scale, sub, type BodyRef, type Mechanism3, type Quat, type V3 } from './physics3d/model3';
import { initialState3 } from './physics3d/solver3';
import { attachments, compile, type Depth, type SBody, type SJoint, type Sketch } from './sketch';

const Z: V3 = [0, 0, 1];
const zOf = (o: SBody | SJoint, k: keyof Depth) => o.z?.[k] ?? 0;
const at3 = (p: Vec, z: number): V3 => [p[0], p[1], z];

// unit quaternion of the frame whose columns are ex, ey, ez
function quatFromAxes(ex: V3, ey: V3, ez: V3): Quat {
  const [m00, m10, m20] = ex, [m01, m11, m21] = ey, [m02, m12, m22] = ez;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const S = 2 * Math.sqrt(tr + 1);
    return [0.25 * S, (m21 - m12) / S, (m02 - m20) / S, (m10 - m01) / S];
  }
  if (m00 > m11 && m00 > m22) {
    const S = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [(m21 - m12) / S, 0.25 * S, (m01 + m10) / S, (m02 + m20) / S];
  }
  if (m11 > m22) {
    const S = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m02 - m20) / S, (m01 + m10) / S, 0.25 * S, (m12 + m21) / S];
  }
  const S = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m10 - m01) / S, (m02 + m20) / S, (m12 + m21) / S, 0.25 * S];
}

// rod frame: local x along the rod; local z as close to world z as possible (hinges turn about world z)
function rodQuat(A: V3, B: V3): Quat {
  const d = sub(B, A);
  const ex = scale(d, 1 / norm(d));
  if (Math.abs(ex[2]) < 1e-12) return axisAngle(Z, Math.atan2(ex[1], ex[0])); // in the plane: same as lift()
  if (1 - Math.abs(ex[2]) < 1e-6) throw new Error('Uma barra aponta reto na direção lateral (z): incline-a um pouco.');
  const e = sub(Z, scale(ex, ex[2]));
  const ez = scale(e, 1 / norm(e));
  return quatFromAxes(ex, cross(ez, ex), ez);
}

export function compile3(sk: Sketch): Mechanism3 {
  const m3 = lift(compile(sk)); // compile() validates and fixes the joint order
  if (!sk.bodies.some((b) => b.z) && !sk.joints.some((j) => j.z)) return m3;
  m3.bodies = sk.bodies.map((b, i) => {
    const b3 = m3.bodies[i];
    if (b.kind === 'disk') return { ...b3, pos: at3(b.c, zOf(b, 'c')) };
    const A = at3(b.a, zOf(b, 'a')), B = at3(b.b, zOf(b, 'b'));
    const L = norm(sub(B, A));
    const I = (b.mass * L * L) / 12;
    return { ...b3, pos: scale(add(A, B), 0.5), quat: rodQuat(A, B), inertia: [b3.inertia[0], I, I], shape: { kind: 'rod', length: L } };
  });
  const s0 = initialState3(m3);
  const local = (i: BodyRef, w: V3): V3 => (i === 'ground' ? w : rotateInv(m3.bodies[i].quat, 0, sub(w, m3.bodies[i].pos)));
  const axisIn = (i: BodyRef): V3 => (i === 'ground' ? Z : rotateInv(m3.bodies[i].quat, 0, Z));
  const sj = sk.joints.filter((j) => j.kind !== 'pull' && j.kind !== 'spring'); // same order as compile()'s joints
  m3.joints = m3.joints.map((j, k) => {
    const s = sj[k];
    if (!s) return j; // the trough floor compile() appends
    const P = 'at' in s ? at3(s.at, zOf(s, 'at')) : undefined;
    switch (j.kind) {
      case 'pin':
        return { ...j, pa: local(j.a, P!), pb: local(j.b, P!), axis: axisIn(j.a), axisB: axisIn(j.b) };
      case 'weld':
        return { ...j, pa: local(j.a, P!), pb: local(j.b, P!), axis: axisIn(j.a), axisB: axisIn(j.b), angle: twist(s0, j.a, j.b, axisIn(j.b)) };
      case 'rope': {
        if (s.kind !== 'rope') return j;
        const A = at3(s.pa, zOf(s, 'pa')), B = at3(s.pb, zOf(s, 'pb'));
        return { ...j, pa: local(j.a, A), pb: local(j.b, B), length: norm(sub(A, B)) };
      }
      case 'slider':
        return { ...j, pa: local(j.a, P!), origin: P! };
      case 'stop':
        return { ...j, axisB: axisIn(j.b), angle: twist(s0, j.a, j.b, axisIn(j.b)) };
      case 'foot':
        return { ...j, pa: local(j.a, P!), at: P! };
      case 'spike':
      case 'floor':
        return { ...j, pa: local(j.a, P!) };
      case 'roller':
        return { ...j, at: P! };
      case 'cam': // drum keeps turning about z; its pulley moves sideways with it
        return { ...j, hub: local(j.b, P!), ...(j.over ? { over: [j.over[0], j.over[1], P![2]] as V3 } : {}) };
      default:
        return j;
    }
  });
  const pulls = sk.joints.filter((j) => j.kind === 'pull');
  m3.pulls = m3.pulls?.map((pl, k) => ({ ...pl, local: local(pl.body, at3(pulls[k].at, zOf(pulls[k], 'at'))) }));
  const springs = sk.joints.filter((j) => j.kind === 'spring');
  m3.springs = m3.springs?.map((sp, k) => ({ ...sp, local: local(sp.body, at3(springs[k].at, zOf(springs[k], 'at'))) })); // anchor stays at z = 0
  return m3;
}

// --- 3D nodes: every sketch point, coincident ones (same x, y, z) grouped so they move together
type Ref = { o: SBody | SJoint; k: keyof Depth };
export interface Node3 { p: V3; refs: Ref[]; label: string }

const pointKeys = (o: SBody | SJoint): (keyof Depth)[] =>
  o.kind === 'rod' ? ['a', 'b'] : o.kind === 'disk' ? ['c'] : o.kind === 'rope' ? ['pa', 'pb'] : ['at'];
const JOINT_NAMES: Record<SJoint['kind'], string> = {
  pin: 'pino', weld: 'solda', rope: 'corda', slider: 'trilho', pull: 'puxada', stop: 'batente', foot: 'pé',
  spike: 'espetos', roller: 'rolete', floor: 'piso', spring: 'mola', cam: 'tambor',
};
const pointOf = (r: Ref): V3 => at3((r.o as unknown as Record<string, Vec>)[r.k], zOf(r.o, r.k));

export function nodes3(sk: Sketch): Node3[] {
  const out = new Map<string, Node3>();
  for (const o of [...sk.bodies, ...sk.joints]) {
    for (const k of pointKeys(o)) {
      const p = pointOf({ o, k });
      const key = p.map((v) => v.toFixed(6)).join();
      const name = 'name' in o ? `${o.name} (${k === 'c' ? 'centro' : `ponta ${k.toUpperCase()}`})` : JOINT_NAMES[o.kind];
      const n = out.get(key);
      if (n) n.refs.push({ o, k });
      else out.set(key, { p, refs: [{ o, k }], label: name });
    }
  }
  return [...out.values()];
}

function place(r: Ref, p: V3) {
  const v = (r.o as unknown as Record<string, Vec>)[r.k];
  (v[0] = p[0]), (v[1] = p[1]); // in place: the 2D editor groups points by array identity
  r.o.z = { ...r.o.z, [r.k]: p[2] };
}

// Move a node; joint points riding on a reshaped body (an axle in the middle of the arm) follow it, as in the 2D editor.
export function moveNode(sk: Sketch, node: Node3, p: V3) {
  const nodes = nodes3(sk);
  const moved = new Set(node.refs.map((r) => r.o));
  const reshaped = sk.bodies.flatMap((b, i) => (moved.has(b) ? [i] : []));
  const followers: { group: Node3; body: number; t: number; off: V3 }[] = [];
  for (const j of sk.joints) {
    attachments(j).forEach(([, bi], n) => {
      if (bi === 'ground' || !reshaped.includes(bi)) return;
      const k: keyof Depth = j.kind === 'rope' ? (n ? 'pb' : 'pa') : 'at';
      if (node.refs.some((r) => r.o === j && r.k === k)) return;
      const q = pointOf({ o: j, k });
      const group = nodes.find((g) => g.refs.some((r) => r.o === j && r.k === k))!;
      if (followers.some((f) => f.group === group)) return;
      const b = sk.bodies[bi];
      if (b.kind === 'rod') {
        const A = pointOf({ o: b, k: 'a' }), ab = sub(pointOf({ o: b, k: 'b' }), A);
        followers.push({ group, body: bi, t: Math.max(0, Math.min(1, ((q[0] - A[0]) * ab[0] + (q[1] - A[1]) * ab[1] + (q[2] - A[2]) * ab[2]) / (norm(ab) ** 2 || 1))), off: [0, 0, 0] });
      } else followers.push({ group, body: bi, t: 0, off: sub(q, pointOf({ o: b, k: 'c' })) });
    });
  }
  node.refs.forEach((r) => place(r, p));
  node.p = p;
  for (const f of followers) {
    const b = sk.bodies[f.body];
    const q = b.kind === 'rod'
      ? add(pointOf({ o: b, k: 'a' }), scale(sub(pointOf({ o: b, k: 'b' }), pointOf({ o: b, k: 'a' })), f.t))
      : add(pointOf({ o: b, k: 'c' }), f.off);
    f.group.refs.filter((r) => !moved.has(r.o)).forEach((r) => place(r, q));
  }
}
