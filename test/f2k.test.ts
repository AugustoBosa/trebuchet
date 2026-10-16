import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { build, defaultsFor } from '../src/presets';

const ideal = { airDensity: 0, axleMu: 0, troughMu: 0 };

describe('F2K (eixo flutuante erguido)', () => {
  const p = { ...defaultsFor('f2k'), ...ideal };
  const m = build('f2k', p);
  const r = simulate(m, { afterRelease: 0, frameEvery: 1 });
  const land = r.frames.findIndex((f) => f.forces[m.axle] > 0);

  it('apoiado no rolete, sem atrito: energia constante até as rodas pousarem; o pouso é a única perda', () => {
    expect(r.error).toBeUndefined();
    expect(land).toBeGreaterThan(10);
    const e = r.frames.map((f) => f.ke + f.pe);
    const scale = r.inputEnergy;
    for (let i = 0; i < land; i++) expect(Math.abs(e[i] - e[0]) / scale).toBeLessThan(1e-3);
    const lost = e[land - 1] - e[land];
    expect(lost / scale).toBeGreaterThan(0.01); // a real thud
    expect(Math.abs(r.dissipated - lost) / scale).toBeLessThan(2e-3); // ...and nothing else leaks
  });

  it('o rolete toca o braço dentro do comprimento dele enquanto o apoia', () => {
    const arm = m.bodies[0];
    const half = arm.shape.kind === 'rod' ? arm.shape.length / 2 : 0;
    const roller = m.joints.find((j) => j.kind === 'roller')!;
    if (roller.kind !== 'roller') throw new Error();
    for (const f of r.frames.slice(0, land)) {
      const along = Math.cos(f.q[2]) * (roller.at[0] - f.q[0]) + Math.sin(f.q[2]) * (roller.at[1] - f.q[1]);
      expect(Math.abs(along)).toBeLessThan(half);
    }
  });

  // The Hurl lists "lower efficiency" too; in this model that holds for the default hard landing (roller 0.5 m)
  // but not for every geometry (roller at 1 m lands softly: ~349 m, η ≈ 86 % vs 82 %).
  it('contra o floating arm (The Hurl): mais queda e alcance; menos eficiência no pouso duro do padrão', () => {
    const fat = simulate(build('floating', { ...defaultsFor('floating'), ...ideal }), { afterRelease: 0 });
    expect(r.inputEnergy).toBeGreaterThan(fat.inputEnergy);
    expect(r.range).toBeGreaterThan(fat.range);
    expect(r.efficiency).toBeLessThan(fat.efficiency);
  });
});
