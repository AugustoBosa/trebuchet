import { describe, expect, it } from 'vitest';
import { BAR_MATS } from '../src/materials';
import { evaluate, nelderMead, paramMapper, structU, withSectionMass, type Struct } from '../src/optimize';
import { defaultsFor } from '../src/presets';

describe('otimizador com a estrutura', () => {
  const p = defaultsFor('hinged');
  const st: Struct = { spec: { arm: { mat: 'jatoba', shape: 'rect', b: 0.06, h: 0.16 } }, mode: 'rupture', fsMin: 1.5 };

  it('a massa do braço segue a seção e o comprimento', () => {
    expect(withSectionMass(p, st.spec).armMass).toBeCloseTo(BAR_MATS.jatoba.rho * 0.06 * 0.16 * (p.longArm + p.shortArm), 6);
  });

  it('mais contrapeso rende mais, até o braço não aguentar: o ótimo para no FS mínimo', () => {
    const map = paramMapper(p, ['cwMass']);
    const f = (u: number[]) => -evaluate('hinged', map.toParams(u), 'range', undefined, st);
    const res = nelderMead(f, map.toUnit(p), { maxEvals: 40 });
    const best = map.toParams(res.x);
    const fs = 1 / structU('hinged', best, st);
    expect(fs).toBeGreaterThan(0.97 * st.fsMin); // the penalty lets it sit at the edge, a hair past at most
    expect(fs).toBeLessThan(1.15 * st.fsMin); // ...and not far inside: more counterweight would throw farther
    // unconstrained, the same search wants far more counterweight
    const free = map.toParams(nelderMead((u) => -evaluate('hinged', map.toParams(u), 'range'), map.toUnit(p), { maxEvals: 40 }).x);
    expect(free.cwMass).toBeGreaterThan(1.3 * best.cwMass);
  }, 60000);
});
