import { describe, expect, it } from 'vitest';
import { evaluate, nelderMead, paramMapper, shownValue } from '../src/optimize';
import { defaultsFor } from '../src/presets';

describe('otimizador 3D', () => {
  it('com vento lateral, acha o pino fora do centro que cancela o desvio', () => {
    const p = defaultsFor('hinged');
    const env3 = { windZ: 2, pinOffset: 0, aimDeg: 0 }; // ~1.6 m of drift: within what ±50 cm of pin can cancel (5 m/s would need ~62 cm)
    const before = shownValue('lateral', evaluate('hinged', p, 'lateral', env3));
    const map = paramMapper(p, ['pinOffset']);
    const res = nelderMead((u) => -evaluate('hinged', map.toParams(u), 'lateral', env3), map.toUnit(p), { maxEvals: 40 });
    const after = shownValue('lateral', -res.fx);
    expect(before).toBeGreaterThan(1); // the wind alone pushes it sideways
    expect(after).toBeLessThan(0.05);
    expect(Math.abs(map.toParams(res.x).pinOffset!)).toBeGreaterThan(0.1); // a real offset does the cancelling
  }, 30_000); // ~40 3D shots

  it('objetivos 3D sem o motor 3D dão 0; alcance robusto < alcance nominal', () => {
    const p = defaultsFor('fixed');
    expect(evaluate('fixed', p, 'lateral')).toBe(0);
    const env3 = { windZ: 0, pinOffset: 0, aimDeg: 0 };
    const nominal = evaluate('fixed', p, 'range', env3);
    const robust = evaluate('fixed', p, 'robust', env3);
    expect(robust).toBeGreaterThan(0.9 * nominal);
    expect(robust).toBeLessThan(nominal);
    expect(nominal).toBeCloseTo(evaluate('fixed', p, 'range'), 6); // 3D engine on a planar shot = 2D engine
  });

  it('vento forte (5 m/s), que o pino não compensa: girar a máquina (mira) zera o desvio', () => {
    const p = defaultsFor('hinged');
    const env3 = { windZ: 5, pinOffset: 0, aimDeg: 0 };
    const map = paramMapper(p, ['aimDeg']);
    const res = nelderMead((u) => -evaluate('hinged', map.toParams(u), 'lateral', env3), map.toUnit(p), { maxEvals: 40 });
    expect(shownValue('lateral', -res.fx)).toBeLessThan(0.05);
    expect(Math.abs(map.toParams(res.x).aimDeg!)).toBeGreaterThan(0.3); // about 1°: 4 m over 224 m
  }, 30_000);
});
