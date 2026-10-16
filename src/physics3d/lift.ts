import type { Joint, Mechanism, Vec } from '../physics/model';
import { axisAngle, type Body3, type Joint3, type Mechanism3, type V3 } from './model3';

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
