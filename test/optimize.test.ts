import { describe, expect, it } from 'vitest';
import { armSplitRange, axlePeak, bestRelease, distinctOptima, evaluate, latinHypercube, minCounterweight, nelderMead, paramMapper, seeded, shownValue } from '../src/optimize';
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

describe('distância-alvo e teto de força no eixo', () => {
  const base = { ...defaults, cwMass: 600 };

  it('o contrapeso que acerta 70% do alcance atual cai a menos de 1 m do alvo', () => {
    const target = 0.7 * evaluate('hinged', base, 'range');
    const map = paramMapper({ ...base, target }, ['cwMass']);
    const res = nelderMead((u) => -evaluate('hinged', map.toParams(u), 'target'), map.toUnit(base), { maxEvals: 80, step: 0.02 });
    const hit = evaluate('hinged', map.toParams(res.x), 'range');
    expect(Math.abs(hit - target)).toBeLessThan(1);
    expect(shownValue('target', -res.fx)).toBeLessThan(1); // the table's number is that error, in m
  });

  it('com teto no eixo, o ótimo respeita o teto e custa alcance', () => {
    const vars = ['cwMass', 'slingLength', 'releaseDeg'] as const;
    const free = nelderMead((u) => -evaluate('hinged', paramMapper(base, [...vars]).toParams(u), 'range'), paramMapper(base, [...vars]).toUnit(base), { maxEvals: 120 });
    const best = paramMapper(base, [...vars]).toParams(free.x);
    const cap = 0.6 * axlePeak('hinged', best);
    const capped = { ...best, axleCap: cap };
    const map = paramMapper(capped, [...vars]);
    const res = nelderMead((u) => -evaluate('hinged', map.toParams(u), 'range'), map.toUnit(capped), { maxEvals: 120 });
    const p = map.toParams(res.x);
    expect(axlePeak('hinged', p)).toBeLessThan(cap * 1.05);
    expect(evaluate('hinged', { ...p, axleCap: undefined }, 'range')).toBeLessThan(-free.fx);
  });
});

describe('contrapeso mínimo para o alvo', () => {
  it('acha o menor contrapeso que chega ao alvo (e o alvo impossível devolve nada)', () => {
    const base = { ...defaults, cwMass: 600 };
    const target = evaluate('hinged', base, 'range');
    const cw = minCounterweight('hinged', base, target)!;
    expect(cw).toBeLessThanOrEqual(600 * 1.001);
    expect(cw).toBeGreaterThan(600 * 0.9); // range grows with the counterweight: nothing much lighter reaches it
    expect(evaluate('hinged', { ...base, cwMass: cw }, 'range')).toBeGreaterThanOrEqual(target);
    expect(evaluate('hinged', { ...base, cwMass: cw * 0.98 }, 'range')).toBeLessThan(target);
    expect(minCounterweight('hinged', base, 1e6)).toBeUndefined();
  });
});

describe('melhor caso (What If) e teto de força na funda', () => {
  it('o ângulo reotimizado nunca rende menos que o atual, nem menos que qualquer ponto da grade', () => {
    const p = { ...defaults, cwMass: 600 };
    const b = bestRelease('hinged', p, 'range');
    expect(b.value).toBeGreaterThanOrEqual(evaluate('hinged', p, 'range'));
    for (const d of [25, 30, 35, 40, 45, 50]) expect(b.value).toBeGreaterThanOrEqual(evaluate('hinged', { ...p, releaseDeg: d }, 'range') - 1e-6);
    expect(b.deg).toBeGreaterThan(20);
    expect(b.deg).toBeLessThan(60);
  });

  it('com teto na funda, o ótimo respeita o teto e custa alcance', () => {
    const vars = ['cwMass', 'slingLength', 'releaseDeg'] as const;
    const peak = (p: typeof defaults) => { const m = build('hinged', p); return simulate(m, { afterRelease: 0, dt: 2e-3 }).peakForce[m.sling]; };
    const map0 = paramMapper(defaults, [...vars]);
    const free = nelderMead((u) => -evaluate('hinged', map0.toParams(u), 'range'), map0.toUnit(defaults), { maxEvals: 120 });
    const best = map0.toParams(free.x);
    const cap = 0.6 * peak(best);
    const capped = { ...best, slingCap: cap };
    const map = paramMapper(capped, [...vars]);
    const res = nelderMead((u) => -evaluate('hinged', map.toParams(u), 'range'), map.toUnit(capped), { maxEvals: 120 });
    const p = map.toParams(res.x);
    expect(peak(p)).toBeLessThan(cap * 1.05);
    expect(evaluate('hinged', { ...p, slingCap: undefined }, 'range')).toBeLessThan(-free.fx);
  });
});
