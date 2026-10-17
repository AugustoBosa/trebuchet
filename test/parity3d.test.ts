import { describe, expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { lift } from '../src/physics3d/lift';
import { simulate3 } from '../src/physics3d/solver3';
import { build, defaultsFor, KINDS, type Kind } from '../src/presets';

// The 3D solver on a planar machine must reproduce the planar solver: same physics, more coordinates.
describe('solver 3D = solver 2D no plano', () => {
  for (const kind of Object.keys(KINDS) as Kind[]) {
    it(kind, () => {
      const m = build(kind, defaultsFor(kind));
      const r2 = simulate(m, { afterRelease: 0 });
      const r3 = simulate3(lift(m), { afterRelease: 0 });
      expect(r3.error).toBe(r2.error);
      expect(Math.abs(r3.range - r2.range) / r2.range).toBeLessThan(0.005);
      expect(Math.abs(r3.peakForce[m.axle] - r2.peakForce[m.axle]) / r2.peakForce[m.axle]).toBeLessThan(0.01);
      expect(Math.abs(r3.efficiency - r2.efficiency)).toBeLessThan(0.005);
      expect(Math.abs(r3.lateral)).toBeLessThan(1e-9); // stays in its plane
      expect(Math.abs(r3.peakBending!.moment - r2.peakBending!.moment) / r2.peakBending!.moment).toBeLessThan(1e-5);
      expect(r3.peakBending!.fromAxle).toBeCloseTo(r2.peakBending!.fromAxle, 9);
    });
  }
});
