import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { apply3d, lift } from '../src/physics3d/lift';
import { simulate3 } from '../src/physics3d/solver3';
import { build, defaultsFor } from '../src/presets';

const peak = (a: Float64Array) => a.reduce((x, y) => Math.max(x, Math.abs(y)), 0);

describe('esforços da barra em 3D', () => {
  const m = build('hinged', defaultsFor('hinged'));
  const opts = { afterRelease: 0, frameEvery: 1e9, loadEvery: 20 };
  const r2 = simulate(m, opts), r3 = simulate3(lift(m), opts);

  it('no plano, N/V/M coincidem com os do solver plano e não há parte lateral', () => {
    const arm = (m.joints[m.axle] as { a: number }).a;
    expect(r3.loads!.length).toBeGreaterThan(5);
    r3.loads!.forEach((S, k) => {
      const a = r2.loads![k].rods[arm]!, b = S.rods[arm]!;
      for (const key of ['N', 'V', 'M'] as const) for (let i = 0; i < a.x.length; i++) expect((Math.abs(b[key][i]) - Math.abs(a[key][i])) / (peak(a[key]) + 1)).toBeLessThan(1e-5);
      expect(peak(b.Ml) / (peak(b.M) + 1)).toBeLessThan(1e-9);
      expect(peak(b.Vl) / (peak(b.V) + 1)).toBeLessThan(1e-9);
    });
  });

  it('com vento lateral e pino deslocado, a flexão lateral aparece', () => {
    const w = simulate3(apply3d(lift(m), { windZ: 5, pinOffset: 0.25 }), opts);
    const arm = (m.joints[m.axle] as { a: number }).a;
    expect(Math.max(...w.loads!.map((S) => peak(S.rods[arm]!.Ml)))).toBeGreaterThan(1);
  });
});
