import { describe, expect, it } from 'vitest';
import { seeded } from '../src/optimize';
import { gaussian, scatterStats } from '../src/physics3d/dispersion';

describe('dispersão', () => {
  it('recupera média, desvios e a inclinação da elipse de pontos gaussianos conhecidos', () => {
    const g = gaussian(seeded(7));
    const a = 0.5; // major axis 0.5 rad off downrange
    const pts = Array.from({ length: 20000 }, (): [number, number] => {
      const u = 4 * g(), v = 1 * g(); // σ 4 m along the major axis, 1 m across
      return [200 + u * Math.cos(a) - v * Math.sin(a), 3 + u * Math.sin(a) + v * Math.cos(a)];
    });
    const s = scatterStats(pts);
    expect(s.mean[0]).toBeCloseTo(200, 0);
    expect(s.mean[1]).toBeCloseTo(3, 0);
    expect(s.axes[0]).toBeCloseTo(4, 1);
    expect(s.axes[1]).toBeCloseTo(1, 1);
    expect(s.angle).toBeCloseTo(a, 1);
  });
});
