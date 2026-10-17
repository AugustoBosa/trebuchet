// Landing scatter: mean, covariance and the principal axes of the Gaussian ellipse fitted to the landing points.
// Points are [downrange x, lateral z] in meters.
export interface Scatter {
  n: number;
  mean: [number, number];
  sd: [number, number]; // σ downrange, σ lateral
  axes: [number, number]; // 1σ semi-axes of the ellipse, major first
  angle: number; // rad, major axis from +x toward +z
}

export function scatterStats(pts: [number, number][]): Scatter {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, mz = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) (sxx += (x - mx) ** 2), (szz += (z - mz) ** 2), (sxz += (x - mx) * (z - mz));
  const k = Math.max(1, n - 1); // sample covariance
  (sxx /= k), (szz /= k), (sxz /= k);
  // eigenvalues of [[sxx, sxz], [sxz, szz]]
  const tr = sxx + szz, det = sxx * szz - sxz * sxz, h = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + h, l2 = Math.max(0, tr / 2 - h);
  return { n, mean: [mx, mz], sd: [Math.sqrt(sxx), Math.sqrt(szz)], axes: [Math.sqrt(l1), Math.sqrt(l2)], angle: 0.5 * Math.atan2(2 * sxz, sxx - szz) };
}

// standard normal draws from a uniform generator (Box–Muller)
export const gaussian = (rng: () => number) => () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
