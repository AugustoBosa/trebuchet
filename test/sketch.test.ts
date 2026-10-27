import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor, KINDS, type Kind } from '../src/presets';
import { analyze, compile, detachedJoints, emptySketch, removeBody, sanitizeSketch, toSketch } from '../src/sketch';

describe('editor livre (sketch)', () => {
  it.each(Object.keys(KINDS) as Kind[])('%s: preset → esboço → motor dá o mesmo disparo', (kind) => {
    const m = build(kind, defaultsFor(kind));
    const a = simulate(m, { afterRelease: 0 });
    const b = simulate(compile(toSketch(m, { troughMu: defaults.troughMu })), { afterRelease: 0 });
    expect(b.error).toBeUndefined();
    // the editor only knows uniform rods and disks; the Fiffer's composite parts (tapered arm, counterweight box) change
    // their inertia on the way in, which moves the shot by a few percent
    if (kind === 'fiffer') return expect(Math.abs(b.range - a.range) / a.range).toBeLessThan(0.05);
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
    // a negative pin friction would add energy
    const neg = sanitizeSketch({ bodies: [{ kind: 'rod', a: [0, 0], b: [1, 1], mass: 1 }], joints: [{ kind: 'pin', at: [0, 0], a: 0, b: 'ground', mu: -0.3 }] });
    expect(neg.joints[0]).toMatchObject({ kind: 'pin', mu: 0 });
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

  it.each(['murlin', 'f2k', 'walking', 'spring'] as Kind[])('%s: tambor, rolete, chão, espetos e mola sobrevivem à exportação/importação', (kind) => {
    const sk = toSketch(build(kind, defaultsFor(kind)), { troughMu: defaults.troughMu });
    const back = sanitizeSketch(JSON.parse(JSON.stringify(sk)));
    expect(back.joints.map((j) => j.kind)).toEqual(sk.joints.map((j) => j.kind));
    const a = simulate(compile(sk), { afterRelease: 0 });
    const b = simulate(compile(back), { afterRelease: 0 });
    expect(b.error).toBeUndefined();
    expect(b.range).toBeCloseTo(a.range, 6);
  });

  it('mola cuja ponta saiu do corpo é detectada como conexão solta', () => {
    const sk = toSketch(build('spring', defaultsFor('spring')), { troughMu: 0 });
    const i = sk.joints.findIndex((j) => j.kind === 'spring');
    const sp = sk.joints[i];
    if (sp.kind !== 'spring') throw new Error('sem mola');
    sp.at = [sp.at[0] + 1, sp.at[1] + 1];
    expect(detachedJoints(sk)).toContain(i);
  });

  it.each(['f2k', 'walking', 'murlin'] as Kind[])('%s: contato que começa aberto (rodas no ar, contrapeso acima do chão) não trava o esboço', (kind) => {
    const { dof } = analyze(compile(toSketch(build(kind, defaultsFor(kind)), { troughMu: 0 })));
    expect(dof).toBeGreaterThan(0);
  });

  it('polia no mesmo ponto do tambor (JSON adulterado) é descartada em vez de gerar NaN', () => {
    const sk = toSketch(build('murlin', defaultsFor('murlin')), { troughMu: 0 });
    const cam = sk.joints.find((j) => j.kind === 'cam')!;
    if (cam.kind !== 'cam') throw new Error('sem tambor');
    const back = sanitizeSketch(JSON.parse(JSON.stringify({ ...sk, joints: sk.joints.map((j) => (j === cam ? { ...cam, over: cam.at } : j)) })));
    const c2 = back.joints.find((j) => j.kind === 'cam')!;
    expect(c2.kind === 'cam' && c2.over).toBeFalsy();
    expect(simulate(compile(back), { afterRelease: 0 }).frames.at(-1)!.q.every(Number.isFinite)).toBe(true);
  });
});

