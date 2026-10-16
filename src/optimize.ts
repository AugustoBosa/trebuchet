import { RANGES } from './labels';
import { simulate } from './physics/solver';
import { build, type Kind, type Params } from './presets';

export type Objective = 'range' | 'efficiency';
export const FAST_DT = 2e-3; // ≤0.012% off the 1e-4 reference (release is interpolated), 4× cheaper than 5e-4; applied results are re-run at full accuracy

export function evaluate(kind: Kind, p: Params, objective: Objective): number {
  try {
    // tMax 4 s: designs that never release would otherwise burn 8 s of simulation each
    const r = simulate(build(kind, p), { afterRelease: 0, frameEvery: 1e9, dt: FAST_DT, tMax: 4 });
    if (r.error) return 0;
    return objective === 'range' ? r.range : r.efficiency;
  } catch {
    return 0; // impossible geometry scores zero
  }
}

// Box-bounded search: variables live in [0,1] and are mapped onto each slider's range.
// 'armSplit' is not a parameter but a share: the fraction of a fixed beam (long + short arm = armTotal) given to the long arm.
export type OptVar = keyof Params | 'armSplit';

// Range of that fraction keeping both arms inside their slider limits (empty when lo > hi: the beam is too short or too long).
export function armSplitRange(total: number): [number, number] {
  const [l0, l1] = RANGES.longArm;
  const [s0, s1] = RANGES.shortArm;
  return [Math.max(l0 / total, 1 - s1 / total), Math.min(1 - s0 / total, l1 / total)];
}

export function paramMapper(base: Params, vars: OptVar[], armTotal = base.longArm + base.shortArm) {
  const bounds = (k: OptVar): [number, number] => (k === 'armSplit' ? armSplitRange(armTotal) : [RANGES[k][0], RANGES[k][1]]);
  return {
    toUnit: (p: Params) =>
      vars.map((k) => {
        const [lo, hi] = bounds(k);
        return ((k === 'armSplit' ? p.longArm / (p.longArm + p.shortArm) : p[k]) - lo) / (hi - lo);
      }),
    toParams: (u: number[]): Params => {
      const p = { ...base };
      vars.forEach((k, i) => {
        const [lo, hi] = bounds(k);
        const v = lo + Math.min(1, Math.max(0, u[i])) * (hi - lo);
        if (k === 'armSplit') (p.longArm = armTotal * v), (p.shortArm = armTotal * (1 - v));
        else p[k] = v;
      });
      return p;
    },
  };
}

// Nelder–Mead downhill simplex (minimizes f). Derivative-free: right tool for a black-box simulator.
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  { step = 0.1, maxEvals = 200, tol = 1e-6, onIter }: { step?: number; maxEvals?: number; tol?: number; onIter?: (best: number[], fx: number, evals: number) => void } = {},
) {
  const n = x0.length;
  let evals = 0;
  const F = (x: number[]) => (evals++, f(x));
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + (v + step <= 1 ? step : -step) : v)))].map((x) => ({ x, fx: F(x) }));
  const comb = (a: number[], b: number[], t: number) => a.map((v, i) => v + t * (b[i] - v));
  while (evals < maxEvals) {
    simplex.sort((a, b) => a.fx - b.fx);
    const best = simplex[0];
    const worst = simplex[n];
    onIter?.(best.x, best.fx, evals);
    if (Math.abs(worst.fx - best.fx) <= tol * (Math.abs(best.fx) + tol)) break;
    const c = simplex.slice(0, n).reduce((acc, s) => acc.map((v, i) => v + s.x[i] / n), new Array(n).fill(0));
    const xr = comb(c, worst.x, -1);
    const fr = F(xr);
    if (fr < best.fx) {
      const xe = comb(c, worst.x, -2);
      const fe = F(xe);
      simplex[n] = fe < fr ? { x: xe, fx: fe } : { x: xr, fx: fr };
    } else if (fr < simplex[n - 1].fx) {
      simplex[n] = { x: xr, fx: fr };
    } else {
      const xc = fr < worst.fx ? comb(c, xr, 0.5) : comb(c, worst.x, 0.5);
      const fc = F(xc);
      if (fc < Math.min(fr, worst.fx)) simplex[n] = { x: xc, fx: fc };
      else simplex = simplex.map((s, i) => (i === 0 ? s : { x: comb(best.x, s.x, 0.5), fx: F(comb(best.x, s.x, 0.5)) }));
    }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return { x: simplex[0].x, fx: simplex[0].fx, evals };
}

// Range of a sweep axis around the current value, inside the slider limits.
export function sweepSpan(k: keyof Params, v: number): [number, number] {
  const [lo, hi] = RANGES[k];
  if (k === 'releaseDeg') return [5, 85];
  return [Math.max(lo, v * 0.4), Math.min(hi, v * 1.6)];
}

export const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

// Deterministic PRNG (mulberry32) so tests and reruns are reproducible.
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Latin hypercube: n points in [0,1]^dims, exactly one per stratum along every axis —
// covers the box far more evenly than n independent random points.
export function latinHypercube(n: number, dims: number, rng: () => number = Math.random): number[][] {
  const cols = Array.from({ length: dims }, () => {
    const p = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  });
  return Array.from({ length: n }, (_, i) => cols.map((c) => (c[i] + rng()) / n));
}

// Group local optima that landed close together (distance in the unit box), best first.
// ponytail: greedy clustering, fine for a handful of starts; use DBSCAN if starts grow large
export function distinctOptima<T extends { u: number[]; value: number }>(found: T[], tol = 0.08) {
  const groups: (T & { count: number })[] = [];
  for (const f of found.filter((f) => f.value > 0).sort((a, b) => b.value - a.value)) {
    const g = groups.find((g) => Math.hypot(...g.u.map((v, i) => v - f.u[i])) < tol);
    if (g) g.count++;
    else groups.push({ ...f, count: 1 });
  }
  return groups;
}
