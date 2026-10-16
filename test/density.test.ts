import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor, KINDS, type Kind } from '../src/presets';
import { RANGES } from '../src/labels';
import { sanitize } from '../src/storage';

const cwRadius = (k: Kind, p = defaultsFor(k)) => {
  const m = build(k, p);
  const s = m.bodies[m.counterweight!].shape;
  return s.kind === 'disk' ? s.radius : NaN;
};

describe('densidade do contrapeso', () => {
  it('mesma massa, material mais denso = raio menor na proporção da raiz cúbica', () => {
    const iron = cwRadius('fixed', { ...defaults, cwDensity: 7800 });
    expect(iron / cwRadius('fixed')).toBeCloseTo(Math.cbrt(2500 / 7800), 10);
  });

  it('um contrapeso de ferro cabe onde o de pedra bate no chão (articulado)', () => {
    // a 1.6 m hanger swings a stone CW (r ≈ 0.46 m) into the ground mid-shot; the iron one (r ≈ 0.31 m) clears it
    // and, with the longer hanger, throws farther than the 1.2 m default (225 m)
    const p = { ...defaultsFor('hinged'), hingeLength: 1.6 };
    expect(simulate(build('hinged', p), { afterRelease: 0 }).error).toMatch(/bate no chão/);
    const r = simulate(build('hinged', { ...p, cwDensity: 7800 }), { afterRelease: 0 });
    expect(r.error).toBeUndefined();
    expect(r.range).toBeGreaterThan(225);
  });

  it('arquivo importado com densidade absurda é limitado à faixa do controle (0 daria contrapeso infinito)', () => {
    expect(sanitize({ kind: 'fixed', params: { cwDensity: 0 } }).params.cwDensity).toBe(RANGES.cwDensity[0]);
    expect(sanitize({ kind: 'fixed', params: { cwDensity: 1e9 } }).params.cwDensity).toBe(RANGES.cwDensity[1]);
  });

  it.each(Object.keys(KINDS) as Kind[])('%s: valores do preset cabem nas faixas dos controles (o clamp não os altera)', (k) => {
    const p = defaultsFor(k);
    expect(sanitize({ kind: k, params: p }).params).toEqual(p);
  });

  // regression guard: the default stone density must leave every preset where CHANGELOG 2026-10-16 recorded it
  const TABLE: Partial<Record<Kind, number>> = { fixed: 184, hinged: 225, floating: 259, traction: 217, whipper: 395, murlin: 313, wheel: 270, f2k: 296, fet: 258, ka: 377, faka: 499, spring: 229 };
  it.each(Object.keys(TABLE) as Kind[])('%s: alcance do preset inalterado', (k) => {
    const r = simulate(build(k, defaultsFor(k)), { afterRelease: 0 });
    expect(Math.abs(r.range / TABLE[k]! - 1)).toBeLessThan(0.01);
  });
});
