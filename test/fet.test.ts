import { expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { build, defaultsFor } from '../src/presets';

it('FET sem atrito: nada empurra o conjunto na horizontal, então o momento horizontal total fica em zero', () => {
  const m = build('fet', { ...defaultsFor('fet'), airDensity: 0, axleMu: 0, troughMu: 0, rollCrr: 0 });
  const r = simulate(m, { afterRelease: 0, frameEvery: 1 });
  expect(r.error).toBeUndefined();
  const scale = m.bodies[m.counterweight!].mass * 5; // ~ counterweight at a few m/s
  for (let i = 1; i < r.frames.length; i++) {
    const [a, b] = [r.frames[i - 1], r.frames[i]];
    const px = m.bodies.reduce((s, bd, k) => s + (bd.mass * (b.q[3 * k] - a.q[3 * k])) / (b.t - a.t), 0);
    expect(Math.abs(px) / scale).toBeLessThan(1e-3);
  }
});
