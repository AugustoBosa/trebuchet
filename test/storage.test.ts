import { describe, expect, it } from 'vitest';
import { defaults } from '../src/presets';
import { decodeDesign, encodeDesign, sanitize } from '../src/storage';

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

describe('link de compartilhamento', () => {
  it('ida e volta: o design inteiro (nome com acento, parâmetros, material) sai igual', () => {
    const d = sanitize({ name: 'Máquina açaí ✓', kind: 'hinged', params: { cwMass: 777.5, slingLength: 3.21 }, spec: { arm: { mat: 'ipe', size: '6x12' } }, breakMode: 'design' });
    const back = decodeDesign(encodeDesign(d));
    expect(back).toEqual(d);
    expect(encodeDesign(d)).toMatch(/^[A-Za-z0-9_-]+$/); // fits a URL fragment as is
  });

  it('link quebrado ou malicioso é recusado', () => {
    expect(() => decodeDesign('###')).toThrow();
    expect(() => decodeDesign(encodeDesign({ kind: 'catapulta' } as never))).toThrow();
  });
});
