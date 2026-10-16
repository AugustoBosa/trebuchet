import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor, type Kind } from '../src/presets';
import { analyze, compile, detachedJoints, emptySketch, removeBody, sanitizeSketch, toSketch } from '../src/sketch';

describe('editor livre (sketch)', () => {
  // walking, murlin, wheel and f2k use joints the editor has no tools for (landing spikes, drum, roller)
  it.each(['fixed', 'hinged', 'floating', 'traction', 'whipper'] as Kind[])('%s: preset → esboço → motor dá o mesmo disparo', (kind) => {
    const m = build(kind, defaultsFor(kind));
    const a = simulate(m, { afterRelease: 0 });
    const b = simulate(compile(toSketch(m, { troughMu: defaults.troughMu })), { afterRelease: 0 });
    expect(b.error).toBeUndefined();
    expect(b.range).toBeCloseTo(a.range, 0);
    expect(b.efficiency).toBeCloseTo(a.efficiency, 3);
  });

  it('graus de liberdade: fixo 1, articulado 2, floating arm 1', () => {
    const dof = (k: Kind) => analyze(build(k, defaults)).dof;
    expect(dof('fixed')).toBe(1);
    expect(dof('hinged')).toBe(2);
    expect(dof('floating')).toBe(1);
  });

  it('detecta mecanismo travado', () => {
    const sk = toSketch(build('fixed', defaults), { troughMu: 0 });
    sk.joints.push({ kind: 'pin', at: [...(sk.bodies[0] as { a: [number, number] }).a], a: 0, b: 'ground' });
    expect(analyze(compile(sk)).dof).toBe(0);
  });

  it('erros claros sem projétil ou sem funda', () => {
    expect(() => compile(emptySketch())).toThrow(/projétil/);
    const sk = emptySketch();
    sk.bodies.push({ kind: 'disk', name: 'p', c: [0, 0.1], r: 0.1, mass: 1, role: 'projectile' });
    expect(() => compile(sk)).toThrow(/corda/);
  });

  it('apagar um corpo remove suas juntas e reindexa as outras', () => {
    const sk = toSketch(build('hinged', defaults), { troughMu: 0 });
    const n = sk.joints.length;
    removeBody(sk, 1); // projectile: sling + nothing else in sketch (floor is implicit)
    expect(sk.joints.length).toBe(n - 1);
    expect(sk.joints.every((j) => j.a < sk.bodies.length && (!('b' in j) || j.b === 'ground' || j.b < sk.bodies.length))).toBe(true);
  });

  it('sanitizeSketch descarta índices inválidos e lixo', () => {
    const sk = sanitizeSketch({
      bodies: [{ kind: 'rod', a: [0, 0], b: [1, 'x'], mass: -5 }, { kind: 'hack' }],
      joints: [{ kind: 'pin', at: [0, 0], a: 0, b: 7 }, { kind: 'pin', at: [0, 0], a: 0, b: 'ground' }, { kind: 'rope', a: 3 }],
      releaseDeg: 'abc',
    });
    expect(sk.bodies).toHaveLength(1);
    expect(sk.bodies[0].mass).toBeGreaterThan(0);
    expect(sk.joints).toHaveLength(1);
    expect(sk.releaseDeg).toBe(45);
  });

  it('conexão solta (eixo fora do braço) é detectada e bloqueia o disparo', () => {
    const sk = toSketch(build('fixed', defaults), { troughMu: 0 });
    expect(detachedJoints(sk)).toEqual([]);
    const arm = sk.bodies[0] as { a: [number, number] };
    arm.a[1] += 1.5; // move one end of the arm alone: it no longer passes through the axle
    const axle = sk.joints.findIndex((j) => j.kind === 'pin' && j.b === 'ground');
    expect(detachedJoints(sk)).toContain(axle);
    expect(() => compile(sk)).toThrow(/solta/);
  });

  it('articulado convertido tem a haste visível e nenhuma conexão solta', () => {
    const sk = toSketch(build('hinged', defaults), { troughMu: 0 });
    expect(detachedJoints(sk)).toEqual([]);
    expect(sk.bodies.some((b) => b.kind === 'rod' && b.name === 'haste')).toBe(true);
  });

  it('equipe (tração) no esboço: compila para força aplicada e sobrevive à sanitização', () => {
    const sk = toSketch(build('traction', defaults), { troughMu: 0 });
    const pull = sk.joints.find((j) => j.kind === 'pull')!;
    expect(pull).toBeDefined();
    expect(compile(sk).pulls).toHaveLength(1);
    const clean = sanitizeSketch(JSON.parse(JSON.stringify(sk)));
    expect(clean.joints.filter((j) => j.kind === 'pull')).toHaveLength(1);
    expect(sanitizeSketch({ bodies: [{ kind: 'rod', a: [0, 0], b: [1, 1], mass: 1 }], joints: [{ kind: 'pull', a: 0, at: [1, 1], force: -5, stroke: 'x' }] }).joints[0])
      .toMatchObject({ kind: 'pull', force: expect.any(Number), stroke: expect.any(Number) });
  });
});
