import { describe, expect, it } from 'vitest';
import { armSplitRange, distinctOptima, evaluate, latinHypercube, nelderMead, paramMapper, seeded } from '../src/optimize';
import { simulate } from '../src/physics/solver';
import { build, defaults } from '../src/presets';

describe('otimização', () => {
  it('Nelder–Mead acha o mínimo de uma função de Rosenbrock suave', () => {
    const f = ([x, y]: number[]) => (1 - x) ** 2 + 10 * (y - x * x) ** 2;
    const r = nelderMead(f, [0.2, 0.8], { maxEvals: 2000, tol: 1e-12 });
    expect(r.x[0]).toBeCloseTo(1, 2);
    expect(r.x[1]).toBeCloseTo(1, 2);
  });

  it('paramMapper respeita os limites dos sliders', () => {
    const m = paramMapper(defaults, ['slingLength']);
    expect(m.toParams([2]).slingLength).toBe(20);
    expect(m.toParams([-1]).slingLength).toBe(0.3);
    expect(m.toParams(m.toUnit(defaults)).slingLength).toBeCloseTo(defaults.slingLength, 9);
  });

  it('armSplit mantém longo + curto = total e respeita os limites dos sliders', () => {
    const m = paramMapper(defaults, ['armSplit'], 6.25);
    for (const u of [-1, 0, 0.3, 0.7, 1, 2]) {
      const p = m.toParams([u]);
      expect(p.longArm + p.shortArm).toBeCloseTo(6.25, 9);
      expect(p.longArm).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(p.shortArm).toBeGreaterThanOrEqual(0.05 - 1e-9);
      expect(p.shortArm).toBeLessThanOrEqual(8 + 1e-9);
    }
    expect(m.toParams(m.toUnit(defaults)).longArm).toBeCloseTo(defaults.longArm, 9); // current design is the starting point
    const [lo, hi] = armSplitRange(30); // 30 m cannot be split into a ≤20 m and a ≤8 m arm
    expect(lo).toBeGreaterThan(hi);
  });

  it('otimizar só a divisão do braço não perde para o design atual e preserva o total', () => {
    const total = defaults.longArm + defaults.shortArm;
    const map = paramMapper(defaults, ['armSplit'], total);
    const start = evaluate('fixed', defaults, 'range');
    const res = nelderMead((u) => -evaluate('fixed', map.toParams(u), 'range'), map.toUnit(defaults), { maxEvals: 40 });
    const best = map.toParams(res.x);
    expect(best.longArm + best.shortArm).toBeCloseTo(total, 9);
    expect(-res.fx).toBeGreaterThanOrEqual(start);
  }, 30_000);

  it('otimizar funda + ângulo melhora o alcance do fixo, confirmado no passo fino', () => {
    const vars = ['slingLength', 'releaseDeg'] as const;
    const map = paramMapper(defaults, [...vars]);
    const start = evaluate('fixed', defaults, 'range');
    const res = nelderMead((u) => -evaluate('fixed', map.toParams(u), 'range'), map.toUnit(defaults), { maxEvals: 120 });
    const best = map.toParams(res.x);
    expect(-res.fx).toBeGreaterThan(start);
    const fine = simulate(build('fixed', best), { afterRelease: 0 }).range;
    expect(Math.abs(fine + res.fx) / fine).toBeLessThan(2e-3);
  }, 30_000); // ~120 simulations: exceeds the 5 s default when the suite runs in parallel
});

describe('multi-start', () => {
  it('hipercubo latino: um ponto por faixa em cada eixo', () => {
    const pts = latinHypercube(8, 3, seeded(1));
    for (let d = 0; d < 3; d++) {
      const bins = pts.map((p) => Math.floor(p[d] * 8)).sort((a, b) => a - b);
      expect(bins).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('acha os dois mínimos de uma função com dois vales e os separa na tabela', () => {
    // minima at x=0.2 (deeper) and x=0.8; maximize -f
    const f = ([x]: number[]) => Math.min((x - 0.2) ** 2 - 0.5, (x - 0.8) ** 2 - 0.3);
    const starts = latinHypercube(8, 1, seeded(7));
    const found = starts.map((x0) => {
      const r = nelderMead(f, x0, { step: 0.05, maxEvals: 200, tol: 1e-12 });
      return { u: r.x, value: -r.fx };
    });
    const opt = distinctOptima(found);
    expect(opt).toHaveLength(2);
    expect(opt[0].u[0]).toBeCloseTo(0.2, 2);
    expect(opt[1].u[0]).toBeCloseTo(0.8, 2);
    expect(opt[0].count + opt[1].count).toBe(8);
  });
});
