// 3D twin of physics/model.ts. SI units; y up, x = throwing direction, z = across the machine.
export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // w, x, y, z
export type BodyRef = number | 'ground';

export interface Body3 {
  name: string;
  mass: number;
  inertia: V3; // principal moments in the body frame (a rod lies along local x)
  pos: V3; // center of mass, world
  quat: Quat;
  shape: { kind: 'rod'; length: number } | { kind: 'disk'; radius: number };
}

// pa/pb: points in each body's frame (world for 'ground'). Axes: unit vectors in the frame of the body they belong to
// (world for 'ground'). Planar joints (stop, cam, weld's angle) measure the twist of a about b around that axis.
export type Joint3 =
  | { kind: 'pin'; a: number; pa: V3; b: BodyRef; pb: V3; axis: V3; axisB: V3; friction?: { mu: number; radius: number } } // hinge
  | { kind: 'weld'; a: number; pa: V3; b: BodyRef; pb: V3; axis: V3; axisB: V3; angle: number }
  | { kind: 'rope'; a: number; pa: V3; b: BodyRef; pb: V3; length: number }
  | { kind: 'floor'; a: number; pa: V3; y: number; mu?: number }
  | { kind: 'slider'; a: number; pa: V3; origin: V3; dir: V3; across: V3 } // point on a line: rows along across and dir×across
  | { kind: 'stop'; a: number; b: BodyRef; axisB: V3; angle: number }
  | { kind: 'foot'; a: number; pa: V3; at: V3 }
  | { kind: 'spike'; a: number; pa: V3 }
  | { kind: 'roller'; a: number; at: V3; n: V3 } // n: the rod face's outward normal, a's frame
  | Cam3;

export interface Cam3 {
  kind: 'cam';
  a: number;
  b: number;
  hub: V3;
  axis: V3; // drum axis, world (the arm turns about it)
  theta0: number;
  r0: number;
  r1: number;
  span: number;
  over?: V3;
  length: number;
  dir?: 1 | -1; // see Cam in physics/model.ts
}

export interface Mechanism3 {
  bodies: Body3[];
  joints: Joint3[];
  projectile: number;
  counterweight?: number;
  pulls?: { body: number; local: V3; force: number; untilY: number }[];
  springs?: { body: number; local: V3; anchor: V3; k: number; rest: number }[];
  sling: number;
  axle: number;
  releaseAngle: number;
  air: { density: number; cd: number; wind?: V3 }; // wind in the machine's frame
  aim?: number; // rad: the whole machine turned about the vertical (three.js rotation.y sense); ranges are reported along world x
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [k * a[0], k * a[1], k * a[2]];
export const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);

// rotate v by the unit quaternion (w, x, y, z)
export function rotate(q: ArrayLike<number>, o: number, v: V3): V3 {
  const w = q[o], x = q[o + 1], y = q[o + 2], z = q[o + 3];
  const t: V3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]; // t = 2 q⃗×v
  return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
}
export const rotateInv = (q: ArrayLike<number>, o: number, v: V3): V3 => rotate([q[o], -q[o + 1], -q[o + 2], -q[o + 3]], 0, v);

export const axisAngle = (axis: V3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), s * axis[0], s * axis[1], s * axis[2]];
};

// any unit vector perpendicular to the unit vector a
export function perp(a: V3): V3 {
  const t: V3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const c = cross(a, t);
  return scale(c, 1 / norm(c));
}
