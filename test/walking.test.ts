import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { world } from '../src/render';
import { build, defaultsFor } from '../src/presets';

describe('walking arm (pose real: em pé na ponta do braço, perna no ar)', () => {
  const m = build('walking', defaultsFor('walking'));
  const r = simulate(m, { afterRelease: 0, frameEvery: 1 });
  const LEG = m.bodies.findIndex((b) => b.name === 'perna');
  const half = m.bodies[LEG].shape.kind === 'rod' ? m.bodies[LEG].shape.length / 2 : 0;
  const spike = (q: Float64Array) => world(q, LEG, [half, 0]);
  const bite = r.frames.findIndex((f) => spike(f.q)[1] <= 1e-6);

  it('tomba, os espinhos cravam à frente do dedo e depois não escorregam', () => {
    expect(r.error).toBeUndefined();
    expect(spike(r.frames[0].q)[1]).toBeGreaterThan(0.02); // armed: spikes in the air (build() refuses < 2 cm)
    expect(bite).toBeGreaterThan(0);
    const at = spike(r.frames[bite].q);
    expect(at[0]).toBeGreaterThan(0.2); // landed ahead of the finger (at x ≈ 0)
    for (const f of r.frames.slice(bite)) {
      const p = spike(f.q);
      if (p[1] > 1e-4) break; // lifted: fine, it may
      expect(Math.abs(p[0] - at[0])).toBeLessThan(1e-3);
    }
  });

  it('o dedo descola do chão e a corda de ajuste afrouxa depois do pouso', () => {
    const tip = (q: Float64Array) => world(q, 0, [m.bodies[0].shape.kind === 'rod' ? m.bodies[0].shape.length / 2 : 0, 0]); // long arm's end
    expect(tip(r.frames.at(-1)!.q)[1]).toBeGreaterThan(0.05);
    const string = m.joints.length - 1;
    expect(m.joints[string].kind).toBe('rope');
    expect(r.frames.at(-1)!.forces[string]).toBe(0);
  });

  it('depois da soltura a máquina cai no chão e não o atravessa', () => {
    const full = simulate(m, { afterRelease: 1.5 });
    m.bodies.forEach((b, i) => {
      if (i === m.projectile) return;
      const pts: [number, number][] = b.shape.kind === 'rod' ? [[-b.shape.length / 2, 0], [b.shape.length / 2, 0]] : [[0, -b.shape.radius]];
      for (const f of full.frames) for (const p of pts) expect(world(f.q, i, p)[1], `${b.name} em t=${f.t}`).toBeGreaterThan(-0.03);
    });
  });

  it('contrapeso de ferro: ~69 m no ajuste padrão (pedra no mesmo lugar raspava o chão), abaixo do teto sem ar', () => {
    expect(r.range).toBeGreaterThan(66);
    expect(r.efficiency).toBeLessThan(1);
    const noAir = simulate(build('walking', { ...defaultsFor('walking'), airDensity: 0 }), { afterRelease: 0 });
    expect(r.range).toBeLessThan(noAir.range);
  });
});
