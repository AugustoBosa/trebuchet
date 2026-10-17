import { describe, expect, it } from 'vitest';
import type { Vec } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor } from '../src/presets';
import { compile, toSketch, type Sketch } from '../src/sketch';

// x → −x for every point of a sketch (a slider's direction too)
function mirror(sk: Sketch): Sketch {
  const m = JSON.parse(JSON.stringify(sk)) as Sketch;
  const flip = (p?: Vec) => p && (p[0] = -p[0]);
  for (const b of m.bodies) b.kind === 'rod' ? (flip(b.a), flip(b.b)) : flip(b.c);
  for (const j of m.joints) for (const k of ['at', 'pa', 'pb', 'over', 'anchor', 'dir'] as const) flip((j as unknown as Record<string, Vec | undefined>)[k]);
  return m;
}

describe('tambor espelhado', () => {
  it('MURLIN espelhado: o braço gira ao contrário e o contrapeso cai igual (a corda desenrola, não enrola)', () => {
    const sk = toSketch(build('murlin', defaultsFor('murlin')), { troughMu: defaults.troughMu });
    const a = compile(sk);
    const b = compile(mirror(sk));
    expect(b.joints.find((j) => j.kind === 'cam')).toMatchObject({ dir: -1 });
    const ra = simulate(a, { tMax: 0.6, frameEvery: 50 });
    const rb = simulate(b, { tMax: 0.6, frameEvery: 50 }); // throws toward −x: never released here, but the drop is the same
    const cw = 3 * a.counterweight!;
    const n = Math.min(ra.frames.length, rb.frames.length);
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) expect(rb.frames[i].q[cw + 1]).toBeCloseTo(ra.frames[i].q[cw + 1], 6);
    expect(ra.frames[n - 1].q[cw + 1]).toBeLessThan(ra.frames[0].q[cw + 1] - 0.3); // it really fell
  });
});
