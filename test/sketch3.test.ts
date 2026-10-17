import { describe, expect, it } from 'vitest';
import { lift } from '../src/physics3d/lift';
import { simulate3 } from '../src/physics3d/solver3';
import { build, defaults, defaultsFor, type Kind } from '../src/presets';
import { compile, sanitizeSketch, toSketch } from '../src/sketch';
import { compile3, moveNode, nodes3 } from '../src/sketch3';

const sketchOf = (k: Kind) => toSketch(build(k, defaultsFor(k)), { troughMu: defaults.troughMu });

describe('esboço em 3D', () => {
  it.each(['fixed', 'hinged', 'floating', 'whipper'] as Kind[])('%s: profundidades todas 0 pelo caminho 3D = esboço plano', (kind) => {
    const sk = sketchOf(kind);
    const flat = simulate3(lift(compile(sk)), { afterRelease: 0 });
    sk.bodies.forEach((b) => (b.z = {})); // forces the general 3D path, same geometry
    const r = simulate3(compile3(sk), { afterRelease: 0 });
    expect(r.error).toBeUndefined();
    expect(Math.abs(r.range - flat.range) / flat.range).toBeLessThan(1e-6);
    expect(Math.abs(r.lateral)).toBeLessThan(1e-9);
  });

  it('a profundidade sobrevive a salvar/carregar', () => {
    const sk = sketchOf('hinged');
    sk.bodies[0].z = { a: 0.3 };
    sk.joints[0].z = { at: -0.1 };
    const back = sanitizeSketch(JSON.parse(JSON.stringify(sk)));
    expect(back.bodies[0].z).toEqual({ a: 0.3 });
    expect(back.joints[0].z).toEqual({ at: -0.1 });
  });

  it('arrastar a ponta do braço em z: o eixo no meio do braço acompanha, nada fica solto', () => {
    const sk = sketchOf('fixed');
    const arm = sk.bodies.findIndex((b) => b.kind === 'rod');
    const rod = sk.bodies[arm] as Extract<(typeof sk.bodies)[number], { kind: 'rod' }>;
    const tip = nodes3(sk).find((n) => n.refs.some((r) => r.o === rod && r.k === 'b'))!;
    moveNode(sk, tip, [tip.p[0], tip.p[1], 0.4]);
    expect(rod.z?.b).toBeCloseTo(0.4, 12);
    const axle = sk.joints.find((j) => j.kind === 'pin' && j.b === 'ground')!;
    expect(axle.z?.at).toBeGreaterThan(0); // moved along the tilted arm
    expect(axle.z?.at).toBeLessThan(0.4);
    const r = simulate3(compile3(sk), { afterRelease: 0 });
    expect(r.error).toBeUndefined();
    expect(Math.abs(r.lateral)).toBeGreaterThan(0.1); // an arm tilted out of the plane throws sideways
  });
});
