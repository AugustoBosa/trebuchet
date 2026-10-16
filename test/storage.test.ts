import { describe, expect, it } from 'vitest';
import { defaults } from '../src/presets';
import { sanitize } from '../src/storage';

describe('sanitize (arquivo importado)', () => {
  it('aceita design válido e completa parâmetros faltantes com os padrões', () => {
    const d = sanitize({ name: 'Meu', kind: 'hinged', params: { cwMass: 500 } });
    expect(d.kind).toBe('hinged');
    expect(d.params.cwMass).toBe(500);
    expect(d.params.longArm).toBe(defaults.longArm);
  });

  it('descarta valores não numéricos e chaves desconhecidas', () => {
    const d = sanitize({ kind: 'fixed', params: { cwMass: '<script>', longArm: NaN, evil: 1 } });
    expect(d.params.cwMass).toBe(defaults.cwMass);
    expect(d.params.longArm).toBe(defaults.longArm);
    expect('evil' in d.params).toBe(false);
  });

  it('rejeita tipo desconhecido ou lixo', () => {
    expect(() => sanitize({ kind: 'catapulta' })).toThrow();
    expect(() => sanitize(null)).toThrow();
    expect(() => sanitize({ kind: 'toString' })).toThrow();
  });

  it('design livre: esboço passa pela sanitização', () => {
    const d = sanitize({ kind: 'free', name: 'x', sketch: { bodies: [{ kind: 'disk', c: [0, 0.1], r: 0.1, mass: 1, role: 'projectile' }], joints: [{ kind: 'rope', a: 9 }] } });
    expect(d.kind).toBe('free');
    expect(d.sketch!.bodies).toHaveLength(1);
    expect(d.sketch!.joints).toHaveLength(0);
  });
});
