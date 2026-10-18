import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { build, defaultsFor, KINDS, type Kind } from '../src/presets';
import { BAR_MATS, barCheck, mechToSketch, pinCheck, presetOwner, presetParts, ropeCheck, sanitizeSpec, sketchParts, sketchToMech, statusOf, type Spec } from '../src/parts';
import { compile, toSketch } from '../src/sketch';
import { partAt, world } from '../src/render';
import { initialState } from '../src/physics/solver';

const kinds = Object.keys(KINDS) as Kind[];
const shot = (k: Kind) => {
  const p = defaultsFor(k);
  const m = build(k, p);
  return { p, m, r: simulate(m, { afterRelease: 0 }) };
};

describe('verificações (contas à mão)', () => {
  it('flexão: retângulo 10 × 20 cm sob 21 kN·m', () => {
    const c = barCheck(21000, 0.1, 0.2, 30e6);
    expect(c.W).toBeCloseTo((0.1 * 0.2 ** 2) / 6, 12); // 666,7 cm³
    expect(c.sigma).toBeCloseTo(31.5e6, -3);
    expect(c.fs).toBeCloseTo(30 / 31.5, 3);
    expect(statusOf(c.fs)).toBe('fail');
  });
  it('corda: nylon de 12 mm rompe a ~28 kN', () => {
    expect(ropeCheck(1000, 0.012, 250e6).breaking).toBeCloseTo((250e6 * Math.PI * 0.012 ** 2) / 4, 6);
  });
  it('eixo: pino de 5 cm de raio, 60 kN, cisalhamento duplo', () => {
    const c = pinCheck(60000, 0.05, 235e6);
    expect(c.tau).toBeCloseTo(((4 / 3) * 30000) / (Math.PI * 0.0025), 6);
    expect(c.fs).toBeCloseTo(235e6 / Math.sqrt(3) / c.tau, 9);
    expect(statusOf(c.fs)).toBe('ok');
  });
});

describe('fichas dos presets', () => {
  it.each(kinds)('%s: toda peça, ligação, mola e equipe abre uma ficha', (k) => {
    const { p, m, r } = shot(k);
    const parts = presetParts({ kind: k, p, spec: {}, m, r });
    const keys = [...m.bodies.map((_, i) => `b:${i}`), ...m.joints.map((_, i) => `j:${i}`), ...(m.springs ?? []).map((_, i) => `s:${i}`), ...(m.pulls ?? []).map((_, i) => `p:${i}`)];
    for (const key of keys) expect(parts.some((pt) => pt.keys.includes(key)), key).toBe(true);
    expect(new Set(parts.map((pt) => pt.id)).size).toBe(parts.length);
    expect(presetOwner(m).get(`b:${m.projectile}`)).toBe('proj');
  });

  it('braço: com o disparo, a ficha traz σ = M/W e o fator de segurança', () => {
    const { p, m, r } = shot('hinged');
    const arm = presetParts({ kind: 'hinged', p, spec: {}, m, r }).find((pt) => pt.id === 'arm')!;
    expect(arm.rows.some((row) => row.label.startsWith('Tensão máxima'))).toBe(true);
    expect(arm.rows.find((row) => row.label === 'Fator de segurança')?.status).toBeDefined();
  });

  it('braço: escolher material e seção põe a massa em ρ·b·h·L', () => {
    const { p, m } = shot('fixed');
    const spec: Spec = {};
    const arm = presetParts({ kind: 'fixed', p, spec, m }).find((pt) => pt.id === 'arm')!;
    const row = (label: string) => arm.rows.find((x) => x.label.startsWith(label))!.input!;
    (row('Material') as { set: (v: string) => void }).set('c24');
    (row('Seção: largura') as { set: (v: number) => void }).set(15);
    (row('Seção: altura') as { set: (v: number) => void }).set(25);
    expect(spec.arm).toEqual({ mat: 'c24', b: 0.15, h: 0.25 });
    expect(p.armMass).toBeCloseTo(BAR_MATS.c24.rho * 0.15 * 0.25 * (p.longArm + p.shortArm), 2);
  });

  it('braço com seção fixada: alongar o braço pela ficha aumenta a massa na mesma proporção', () => {
    const { p, m } = shot('fixed');
    const spec: Spec = { arm: { mat: 'd30', b: 0.1, h: 0.2 } };
    const arm = presetParts({ kind: 'fixed', p, spec, m }).find((pt) => pt.id === 'arm')!;
    (arm.rows.find((x) => x.label.startsWith('Braço longo'))!.input as { set: (v: number) => void }).set(6);
    expect(p.armMass).toBeCloseTo(640 * 0.1 * 0.2 * (6 + p.shortArm), 2);
  });

  it('contrapeso: trocar o material muda só a densidade (mesma massa)', () => {
    const { p, m } = shot('hinged');
    const cw = presetParts({ kind: 'hinged', p, spec: {}, m }).find((pt) => pt.id === 'cw')!;
    (cw.rows.find((x) => x.label === 'Material')!.input as { set: (v: string) => void }).set('lead');
    expect(p.cwDensity).toBe(11300);
    expect(p.cwMass).toBe(defaultsFor('hinged').cwMass);
  });
});

describe('fichas do editor livre', () => {
  it.each(['traction', 'spring', 'murlin', 'walking'] as Kind[])('%s: chaves do esboço ↔ do mecanismo, ida e volta', (k) => {
    const sk = toSketch(build(k, defaultsFor(k)), { troughMu: 0.3 });
    const m = compile(sk);
    sk.joints.forEach((_, i) => {
      const key = sketchToMech(sk, i);
      const [t, n] = [key[0], +key.slice(2)];
      expect(t === 'j' ? n < m.joints.length : t === 's' ? n < (m.springs?.length ?? 0) : n < (m.pulls?.length ?? 0), key).toBe(true);
      expect(mechToSketch(sk, key)).toBe(`j:${i}`);
    });
    expect(sketchParts({ sk, m }).length).toBe(sk.bodies.length + sk.joints.length);
  });

  it('barra do esboço: material e seção definem a massa', () => {
    const sk = toSketch(build('fixed', defaultsFor('fixed')), { troughMu: 0.3 });
    const i = sk.bodies.findIndex((b) => b.kind === 'rod');
    const part = sketchParts({ sk }).find((pt) => pt.id === `b:${i}`)!;
    (part.rows.find((x) => x.label.startsWith('Seção: largura'))!.input as { set: (v: number) => void }).set(10);
    (part.rows.find((x) => x.label.startsWith('Seção: altura'))!.input as { set: (v: number) => void }).set(10);
    const b = sk.bodies[i];
    if (b.kind !== 'rod') throw new Error();
    expect(b.mass).toBeCloseTo(640 * 0.01 * Math.hypot(b.a[0] - b.b[0], b.a[1] - b.b[1]), 2);
  });

  it('sanitizeSpec descarta material desconhecido e tamanhos absurdos', () => {
    expect(sanitizeSpec({ mat: 'nylon', d: 0.01 })).toEqual({ mat: 'nylon', d: 0.01 });
    expect(sanitizeSpec({ mat: '<script>', b: -1, h: 1e9 })).toBeUndefined();
  });
});

describe('clique no desenho 2D (partAt)', () => {
  it.each(kinds)('%s: braço, contrapeso, projétil, funda e eixo são achados onde estão desenhados', (k) => {
    const { m } = shot(k);
    const q = initialState(m).q;
    const b = { x0: -10, x1: 10, y0: -1, y1: 10 };
    const tol = 0.01;
    const arm = (m.joints[m.axle] as { a: number }).a;
    const P = (i: number): [number, number] => [q[3 * i], q[3 * i + 1]];
    // a point on the arm away from the axle and from the counterweight
    const s = m.bodies[arm].shape;
    if (s.kind === 'rod') expect(partAt(m, q, world(q, arm, [0.3 * s.length, 0]), tol, b)).toBe(`b:${arm}`);
    expect(partAt(m, q, P(m.projectile), tol, b)).toBe(`b:${m.projectile}`);
    if (m.counterweight !== undefined) expect(partAt(m, q, P(m.counterweight), tol, b)).toBe(`b:${m.counterweight}`);
    const sl = m.joints[m.sling];
    if (sl.kind === 'rope' && sl.b !== 'ground') {
      const A = world(q, sl.a, sl.pa), B = world(q, sl.b, sl.pb);
      const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      expect(partAt(m, q, mid, tol, b)).toBe(`j:${m.sling}`);
    }
    const ax = m.joints[m.axle];
    if (ax.kind === 'pin' && ax.b === 'ground') expect(partAt(m, q, [ax.pb[0] - 0.25 * ax.pb[1], 0.5 * ax.pb[1]], tol, b)).toBe(`j:${m.axle}`);
    expect(partAt(m, q, [50, 50], tol, b)).toBeUndefined();
  });
});

describe('ficha: efeitos colaterais e limites', () => {
  it('abrir as fichas não grava material vazio no design nem no esboço', () => {
    const { p, m, r } = shot('hinged');
    const spec: Spec = {};
    presetParts({ kind: 'hinged', p, spec, m, r });
    expect(spec).toEqual({});
    const sk = toSketch(m, { troughMu: 0.3 });
    sketchParts({ sk, m: compile(sk), r });
    expect(sk.bodies.some((b) => b.spec) || sk.joints.some((j) => j.spec)).toBe(false);
  });

  it('funda: FS 3 é "atenção" (corda pede 5 por causa dos nós), não "ok"', () => {
    const { p, m, r } = shot('hinged');
    const spec: Spec = { sling: { mat: 'nylon', d: 0.008 } }; // ~12,6 kN de ruptura contra ~4,2 kN de pico
    const sling = presetParts({ kind: 'hinged', p, spec, m, r }).find((pt) => pt.id === 'sling')!;
    const fs = sling.rows.find((x) => x.label === 'Fator de segurança')!;
    expect(fs.status).toBe('warn');
    expect(fs.value).toMatch(/atenção \(1–5\)/);
  });
});
