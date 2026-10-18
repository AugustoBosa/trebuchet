// Runs optimizations and sweeps off the UI thread. Cancel = terminate the worker.
import { evaluate, linspace, nelderMead, paramMapper, structU, sweepSpan, withSectionMass, type Env3, type Objective, type OptParams, type OptVar, type Struct } from './optimize';
import type { Kind, Params } from './presets';

export type Request =
  | { type: 'optimize'; kind: Kind; params: OptParams; vars: OptVar[]; armTotal?: number; objective: Objective; maxEvals?: number; env3?: Env3; struct?: Struct }
  | { type: 'sweep'; kind: Kind; params: Params; x: keyof Params; y?: keyof Params; objective: Objective; env3?: Env3 }
  | { type: 'screen'; kind: Kind; params: OptParams; structs: Struct[] }; // worst utilization of each variant, one quick shot each

export type Reply =
  | { type: 'progress'; evals: number; best?: number; done?: number; total?: number }
  | { type: 'optimized'; params: OptParams; value: number; start: number; evals: number; fs?: number } // fs: worst part's safety factor (with struct)
  | { type: 'swept'; xs: number[]; ys?: number[]; z: number[][] }
  | { type: 'screened'; u: number[] };

const post = (r: Reply) => postMessage(r);

onmessage = (e: MessageEvent<Request>) => {
  const q = e.data;
  if (q.type === 'optimize') {
    const map = paramMapper(q.params, q.vars, q.armTotal);
    const start = evaluate(q.kind, q.params, q.objective, q.env3, q.struct);
    const res = nelderMead((u) => -evaluate(q.kind, map.toParams(u), q.objective, q.env3, q.struct), map.toUnit(q.params), {
      maxEvals: q.maxEvals ?? 60 + 40 * q.vars.length,
      onIter: (_, fx, evals) => post({ type: 'progress', evals, best: -fx }),
    });
    // with a section, the arm's mass follows the found lengths: report it with the rest
    const params = q.struct ? withSectionMass(map.toParams(res.x), q.struct.spec) : map.toParams(res.x);
    post({ type: 'optimized', params, value: -res.fx, start, evals: res.evals, ...(q.struct ? { fs: 1 / structU(q.kind, params, q.struct) } : {}) });
  } else if (q.type === 'screen') {
    post({ type: 'screened', u: q.structs.map((st) => structU(q.kind, q.params, st)) });
  } else {
    const xs = linspace(...sweepSpan(q.x, q.params[q.x]), q.y ? 16 : 40);
    const ys = q.y ? linspace(...sweepSpan(q.y, q.params[q.y]), 12) : undefined;
    const z: number[][] = [];
    const rows = ys ?? [undefined];
    rows.forEach((yv, j) => {
      z.push(xs.map((xv) => evaluate(q.kind, { ...q.params, [q.x]: xv, ...(q.y && yv !== undefined ? { [q.y]: yv } : {}) }, q.objective, q.env3)));
      post({ type: 'progress', evals: (j + 1) * xs.length, done: j + 1, total: rows.length });
    });
    post({ type: 'swept', xs, ys, z });
  }
};
