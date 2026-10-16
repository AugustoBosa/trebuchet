import { expect, it } from 'vitest';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor } from '../src/presets';

it('King Arthur: mesma estrutura do articulado, contrapeso em pé → muito mais queda e alcance, menos eficiência', () => {
  const ka = defaultsFor('ka');
  expect([ka.shortArm, ka.hingeLength, ka.cwMass]).toEqual([defaults.shortArm, defaults.hingeLength, defaults.cwMass]);
  const k = simulate(build('ka', ka), { afterRelease: 0 });
  const h = simulate(build('hinged', defaults), { afterRelease: 0 });
  expect(k.error).toBeUndefined();
  expect(k.inputEnergy).toBeGreaterThan(2 * h.inputEnergy); // falls from on top of the hinge, not from below it
  expect(k.range).toBeGreaterThan(1.4 * h.range);
  expect(k.efficiency).toBeLessThan(h.efficiency);
});

it('FAKA: o King Arthur com eixo flutuante, mesma estrutura → mais eficiente e mais longe', () => {
  const ka = simulate(build('ka', defaultsFor('ka')), { afterRelease: 0 });
  const f = defaultsFor('faka');
  expect([f.shortArm, f.hingeLength, f.cwMass, f.pivotHeight]).toEqual([defaultsFor('ka').shortArm, defaultsFor('ka').hingeLength, defaultsFor('ka').cwMass, defaultsFor('ka').pivotHeight]);
  const fa = simulate(build('faka', f), { afterRelease: 0 });
  expect(fa.error).toBeUndefined();
  expect(fa.efficiency).toBeGreaterThan(ka.efficiency + 0.15);
  expect(fa.range).toBeGreaterThan(ka.range);
});
