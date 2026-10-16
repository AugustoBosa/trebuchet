import { G } from '../physics/model';
import type { V3 } from './model3';

// 3D point-mass flight with quadratic drag relative to the air (wind), RK4, until y = 0.
// a = −k|v − w|(v − w) − g ŷ,  k = ½ρ·Cd·A / m.  Without wind it is exactly the planar fly().
export function fly3(p0: V3, v0: V3, k: number, wind: V3 = [0, 0, 0], dt = 1e-3): { path: V3[]; range: number; lateral: number; time: number } {
  const f = (s: number[]) => {
    const rx = s[3] - wind[0], ry = s[4] - wind[1], rz = s[5] - wind[2];
    const sp = Math.hypot(rx, ry, rz);
    return [s[3], s[4], s[5], -k * sp * rx, -k * sp * ry - G, -k * sp * rz];
  };
  let s = [...p0, ...v0];
  let t = 0;
  const path: V3[] = [[s[0], s[1], s[2]]];
  while (t < 600) {
    const k1 = f(s);
    const k2 = f(s.map((x, i) => x + (dt / 2) * k1[i]));
    const k3 = f(s.map((x, i) => x + (dt / 2) * k2[i]));
    const k4 = f(s.map((x, i) => x + dt * k3[i]));
    const n = s.map((x, i) => x + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if (n[1] < 0) {
      const u = s[1] / (s[1] - n[1]); // linear interpolation to y = 0
      const x = s[0] + u * (n[0] - s[0]), z = s[2] + u * (n[2] - s[2]);
      path.push([x, 0, z]);
      return { path, range: x, lateral: z, time: t + u * dt };
    }
    s = n;
    t += dt;
    path.push([s[0], s[1], s[2]]);
  }
  return { path, range: s[0], lateral: s[2], time: t };
}
