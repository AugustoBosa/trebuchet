import type { Joint, Mechanism, Vec } from '../physics/model';
import { add, axisAngle, norm, rotate, sub, type Body3, type Joint3, type Mechanism3, type V3 } from './model3';

const Z: V3 = [0, 0, 1];
const v3 = (p: Vec, z = 0): V3 => [p[0], p[1], z];
const AXIAL_R = 0.02; // m: a rod's radius for its (tiny) inertia about its own axis, keeps M invertible

// A planar mechanism as a 3D one in the z = 0 plane: every hinge turns about z, the planar angle is the twist about z.
export function lift(m: Mechanism): Mechanism3 {
  const bodies: Body3[] = m.bodies.map((b) => ({
    name: b.name,
    mass: b.mass,
    inertia: b.shape.kind === 'rod' ? [(b.mass * AXIAL_R * AXIAL_R) / 2, b.inertia, b.inertia] : [b.inertia, b.inertia, b.inertia],
    pos: v3(b.pos),
    quat: axisAngle(Z, b.angle),
    shape: b.shape,
  }));
  const joints = m.joints.map((j: Joint): Joint3 => {
    switch (j.kind) {
      case 'pin':
        return { ...j, pa: v3(j.pa), pb: v3(j.pb), axis: Z, axisB: Z };
      case 'weld':
        return { ...j, pa: v3(j.pa), pb: v3(j.pb), axis: Z, axisB: Z };
      case 'rope':
        return { ...j, pa: v3(j.pa), pb: v3(j.pb) };
      case 'floor':
      case 'spike':
        return { ...j, pa: v3(j.pa) };
      case 'slider': {
        const L = Math.hypot(...j.dir);
        return { kind: 'slider', a: j.a, pa: v3(j.pa), origin: v3(j.origin), dir: v3(j.dir), across: [-j.dir[1] / L, j.dir[0] / L, 0] };
      }
      case 'stop':
        return { ...j, axisB: Z };
      case 'foot':
        return { ...j, pa: v3(j.pa), at: v3(j.at) };
      case 'roller':
        return { kind: 'roller', a: j.a, at: v3(j.at), n: [0, j.side, 0] };
      case 'cam':
        return { ...j, hub: v3(j.hub), axis: Z, over: j.over && v3(j.over) };
    }
  });
  return {
    ...m,
    bodies,
    joints,
    pulls: m.pulls?.map((p) => ({ ...p, local: v3(p.local) })),
    springs: m.springs?.map((s) => ({ ...s, local: v3(s.local), anchor: v3(s.anchor) })),
  };
}

// Out-of-plane conditions a planar model can't have: a crosswind (m/s, +z; windX: tail wind) and the release pin off the arm's
// center line (m, +z). The sling is re-measured from the moved pin to the stone, which stays on the center line.
export function apply3d(m: Mechanism3, o: { windZ: number; pinOffset: number; windX?: number }): Mechanism3 {
  const out: Mechanism3 = { ...m, air: { ...m.air, wind: [o.windX ?? 0, 0, o.windZ] }, joints: [...m.joints] };
  const j = m.joints[m.sling];
  if (j.kind !== 'rope' || !o.pinOffset) return out;
  const atA = j.a !== m.projectile; // which end holds the pin
  const pin: V3 = atA ? [j.pa[0], j.pa[1], j.pa[2] + o.pinOffset] : [j.pb[0], j.pb[1], j.pb[2] + o.pinOffset];
  const end = (b: number | 'ground', p: V3): V3 => (b === 'ground' ? p : add(m.bodies[b].pos, rotate(m.bodies[b].quat, 0, p)));
  const pa = atA ? pin : j.pa, pb = atA ? j.pb : pin;
  out.joints[m.sling] = { ...j, pa, pb, length: norm(sub(end(j.a, pa), end(j.b, pb))) };
  return out;
}
