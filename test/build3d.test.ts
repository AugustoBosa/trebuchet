import { describe, expect, it } from 'vitest';
import { simulate3 } from '../src/physics3d/solver3';
import { emptySketch } from '../src/sketch';
import { apply3, compile3, type Tool3 } from '../src/sketch3';
import type { V3 } from '../src/physics3d/model3';

// a fixed-counterweight trebuchet built click by click on the work plane z
function build(z: number) {
  const sk = emptySketch();
  const T: V3 = [-4, 0.9, z], S: V3 = [1, 3.4, z], P: V3 = [0, 2.9, z], stone: V3 = [-1, 0.1, z];
  const steps: [Tool3, V3, V3?][] = [['rod', S, T], ['pin', P], ['cw', S], ['weld', S], ['projectile', stone], ['rope', stone, T]];
  for (const [tool, p, from] of steps) expect(apply3(sk, tool, p, from)).toBeUndefined();
  return sk;
}

describe('criar peças no 3D', () => {
  it('trebuchet montado por cliques dispara; num plano z = 0,5 m cai exatamente 0,5 m de lado', () => {
    const r0 = simulate3(compile3(build(0)), { afterRelease: 0 });
    expect(r0.error).toBeUndefined();
    expect(r0.range).toBeGreaterThan(50);
    const r = simulate3(compile3(build(0.5)), { afterRelease: 0 });
    expect(r.range).toBeCloseTo(r0.range, 6);
    expect(r.lateral).toBeCloseTo(0.5, 6);
  });

  it('erros e apagar: pino no vazio é recusado; apagar tira a junta antes do corpo', () => {
    const sk = build(0);
    expect(apply3(sk, 'pin', [10, 10, 0])).toBe('Clique sobre um corpo.');
    const n = sk.joints.length;
    expect(apply3(sk, 'delete', [0, 2.9, 0])).toBeUndefined(); // the axle pin
    expect(sk.joints.length).toBe(n - 1);
    expect(apply3(sk, 'delete', [0, 2.9, 0])).toBeUndefined(); // now the arm itself, with its joints
    expect(sk.bodies.some((b) => b.kind === 'rod')).toBe(false);
  });
});
