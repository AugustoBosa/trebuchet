import { G, type Vec } from './model';

// Point-mass flight with quadratic drag, RK4, until the projectile reaches the ground (y = 0).
export function fly(p0: Vec, v0: Vec, k: number, dt = 1e-3): { path: Vec[]; range: number; time: number } {
  // k = ½ρ·Cd·A / m  →  a = -k|v|v - g
  const f = (s: number[]) => {
    const sp = Math.hypot(s[2], s[3]);
    return [s[2], s[3], -k * sp * s[2], -k * sp * s[3] - G];
  };
  let s = [p0[0], p0[1], v0[0], v0[1]];
  let t = 0;
  const path: Vec[] = [[s[0], s[1]]];
  while (t < 600) {
    const k1 = f(s);
    const k2 = f(s.map((x, i) => x + (dt / 2) * k1[i]));
    const k3 = f(s.map((x, i) => x + (dt / 2) * k2[i]));
    const k4 = f(s.map((x, i) => x + dt * k3[i]));
    const n = s.map((x, i) => x + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if (n[1] < 0) {
      const u = s[1] / (s[1] - n[1]); // linear interpolation to y = 0
      const x = s[0] + u * (n[0] - s[0]);
      path.push([x, 0]);
      return { path, range: x, time: t + u * dt };
    }
    s = n;
    t += dt;
    path.push([s[0], s[1]]);
  }
  return { path, range: s[0], time: t };
}
