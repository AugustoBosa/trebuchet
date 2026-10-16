// Runs optimizations and sweeps off the UI thread. Cancel = terminate the worker.
import { evaluate, linspace, nelderMead, paramMapper, sweepSpan, type Objective, type OptVar } from './optimize';
import type { Kind, Params } from './presets';

export type Request =
  | { type: 'optimize'; kind: Kind; params: Params; vars: OptVar[]; armTotal?: number; objective: Objective; maxEvals?: number }
  | { type: 'sweep'; kind: Kind; params: Params; x: keyof Params; y?: keyof Params; objective: Objective };

export type Reply =
  | { type: 'progress'; evals: number; best?: number; done?: number; total?: number }
  | { type: 'optimized'; params: Params; value: number; start: number; evals: number }
  | { type: 'swept'; xs: number[]; ys?: number[]; z: number[][] };

const post = (r: Reply) => postMessage(r);

onmessage = (e: MessageEvent<Request>) => {
  const q = e.data;
  if (q.type === 'optimize') {
    const map = paramMapper(q.params, q.vars, q.armTotal);
    const start = evaluate(q.kind, q.params, q.objective);
    const res = nelderMead((u) => -evaluate(q.kind, map.toParams(u), q.objective), map.toUnit(q.params), {
      maxEvals: q.maxEvals ?? 60 + 40 * q.vars.length,
      onIter: (_, fx, evals) => post({ type: 'progress', evals, best: -fx }),
    });
    post({ type: 'optimized', params: map.toParams(res.x), value: -res.fx, start, evals: res.evals });
  } else {
    const xs = linspace(...sweepSpan(q.x, q.params[q.x]), q.y ? 16 : 40);
    const ys = q.y ? linspace(...sweepSpan(q.y, q.params[q.y]), 12) : undefined;
    const z: number[][] = [];
    const rows = ys ?? [undefined];
    rows.forEach((yv, j) => {
      z.push(xs.map((xv) => evaluate(q.kind, { ...q.params, [q.x]: xv, ...(q.y && yv !== undefined ? { [q.y]: yv } : {}) }, q.objective)));
      post({ type: 'progress', evals: (j + 1) * xs.length, done: j + 1, total: rows.length });
    });
    post({ type: 'swept', xs, ys, z });
  }
};
