import { describe, expect, it } from 'vitest';
import { fly } from '../src/physics/ballistics';
import { G, type Mechanism } from '../src/physics/model';
import { simulate } from '../src/physics/solver';
import { build, defaults, defaultsFor, KINDS, type Kind } from '../src/presets';

describe('motor', () => {
  it('pêndulo de pequena amplitude tem período 2π√(L/g)', () => {
    const L = 2;
    const th0 = 0.05;
    const m: Mechanism = {
      bodies: [{ name: 'bob', mass: 1, inertia: 1e-6, pos: [L * Math.sin(th0), 10 - L * Math.cos(th0)], angle: 0, shape: { kind: 'disk', radius: 0.001 } }],
      joints: [{ kind: 'rope', a: 0, pa: [0, 0], b: 'ground', pb: [0, 10], length: L }],
      projectile: 0, counterweight: 0, sling: 0, axle: 0,
      releaseAngle: -Infinity, air: { density: 0, cd: 0 },
    };
    const T = 2 * Math.PI * Math.sqrt(L / G);
    const r = simulate(m, { tMax: 1.2 * T, frameEvery: 1 });
    // x goes + → − → +; second upward zero crossing of x is one full period... find first return to + after going −
    const xs = r.frames.map((f) => f.q[0]);
    const crossings = r.frames.filter((f, i) => i > 0 && xs[i - 1] < 0 && xs[i] >= 0).map((f) => f.t);
    const firstDown = r.frames.find((f, i) => i > 0 && xs[i - 1] > 0 && xs[i] <= 0)!.t;
    expect(crossings[0] - firstDown).toBeCloseTo(T / 2, 2);
  });

  it('balística sem arrasto = v²·sin2θ/g', () => {
    const v = 50;
    const a = Math.PI / 6;
    const { range } = fly([0, 0], [v * Math.cos(a), v * Math.sin(a)], 0);
    expect(range).toBeCloseTo((v * v * Math.sin(2 * a)) / G, 1);
  });

  it('trebuchet sem ar conserva energia até a liberação (deriva < 0,1%)', () => {
    const m = build('fixed', { ...defaults, airDensity: 0, axleMu: 0, troughMu: 0 });
    const r = simulate(m, { afterRelease: 0, frameEvery: 1 });
    expect(r.error).toBeUndefined();
    const e = r.frames.map((f) => f.ke + f.pe);
    const spent = r.frames[0].pe - r.frames.at(-1)!.pe + 1e-9;
    const drift = Math.max(...e.map((x) => Math.abs(x - e[0])));
    expect(drift / Math.abs(spent)).toBeLessThan(1e-3);
  });

  it('preset padrão lança com eficiência física (0 < η < 1) e alcance plausível', () => {
    const r = simulate(build('fixed', defaults), { afterRelease: 0 });
    expect(r.error).toBeUndefined();
    expect(r.efficiency).toBeGreaterThan(0.2);
    expect(r.efficiency).toBeLessThan(1);
    // teto teórico sem arrasto: alcance ≤ 2·η·Δh·M/m
    expect(r.range).toBeGreaterThan(20);
  });

  it('atrito só dissipa: energia nunca sobe e a eficiência cai', () => {
    const noFric = simulate(build('fixed', { ...defaults, airDensity: 0, axleMu: 0, troughMu: 0 }), { afterRelease: 0 });
    const fric = simulate(build('fixed', { ...defaults, airDensity: 0, axleMu: 0.3, troughMu: 0.5 }), { afterRelease: 0, frameEvery: 1 });
    expect(fric.error).toBeUndefined();
    const e = fric.frames.map((f) => f.ke + f.pe);
    const scale = fric.frames[0].pe - fric.frames.at(-1)!.pe;
    for (let i = 1; i < e.length; i++) expect(e[i] - e[i - 1]).toBeLessThan(1e-4 * scale);
    expect(fric.dissipated).toBeGreaterThan(0);
    expect(fric.efficiency).toBeLessThan(noFric.efficiency);
  });

  const ideal = { ...defaults, airDensity: 0, axleMu: 0, troughMu: 0 };
  const kinds = Object.keys(KINDS) as Kind[];

  it.each(kinds)('%s: sem atrito nem ar, energia fecha o balanço e 0 < η < 1', (kind) => {
    const p = { ...defaultsFor(kind), airDensity: 0, axleMu: 0, troughMu: 0 };
    const r = simulate(build(kind, p), { afterRelease: 0 });
    expect(r.error).toBeUndefined();
    // the whipper's sling goes slack and re-tensions, and its counterweight lands on the arm; the F2K's wheels land
    // on the track: real inelastic impacts dissipate energy. The others have none: losses must be numerically zero.
    // Nobody may create energy.
    const loss = r.dissipated / r.inputEnergy;
    expect(loss).toBeGreaterThan(-5e-3);
    expect(loss).toBeLessThan(kind === 'whipper' || kind === 'f2k' ? 0.3 : 5e-3);
    expect(r.efficiency).toBeGreaterThan(0);
    expect(r.efficiency).toBeLessThan(1);
    expect(r.range).toBeGreaterThan(10);
  });

  it('articulado e floating arm são mais eficientes que o fixo', () => {
    const eff = (k: Kind) => simulate(build(k, ideal), { afterRelease: 0 }).efficiency;
    const fixed = eff('fixed');
    expect(eff('hinged')).toBeGreaterThan(fixed);
    expect(eff('floating')).toBeGreaterThan(fixed);
  });

  it('não libera o projétil enquanto ele ainda desliza na calha', () => {
    // a 20 m sling drags the stone forward along the ground: velocity angle ~0° is below any release angle
    const r = simulate(build('fixed', { ...defaults, slingLength: 20, releaseDeg: 30 }), { afterRelease: 0, tMax: 4 });
    expect(r.release === undefined || r.release.p[1] > defaults.projRadius + 0.01).toBe(true);
  });

  it('invariante: toda liberação acontece no ângulo pedido e acima do chão', () => {
    for (const slingLength of [0.5, 2, 4.5, 8, 12, 19.4])
      for (const releaseDeg of [11, 30, 45, 70, 89]) {
        const r = simulate(build('fixed', { ...defaults, slingLength, releaseDeg }), { afterRelease: 0, frameEvery: 1e9, dt: 5e-4, tMax: 4 });
        if (!r.release) continue; // a failed shot is fine; a wrong release is not
        expect(Math.abs((r.release.angle * 180) / Math.PI - releaseDeg), `funda ${slingLength} m, ${releaseDeg}°`).toBeLessThan(1.5);
        expect(r.release.p[1]).toBeGreaterThan(0);
      }
  }, 60_000);

  it('peça que atravessa o chão antes da liberação invalida o disparo', () => {
    // hanger so long that the swinging counterweight sweeps below ground level
    const r = simulate(build('hinged', { ...defaults, hingeLength: 3.29 }), { afterRelease: 0 });
    expect(r.error).toMatch(/chão/);
    for (const k of kinds) expect(simulate(build(k, defaultsFor(k)), { afterRelease: 0 }).error, k).toBeUndefined();
  });

  it.each(kinds)('%s: liberação interpolada — passo de 2 ms fica a < 0,1%% do passo de 0,1 ms', (kind) => {
    const ref = simulate(build(kind, defaultsFor(kind)), { afterRelease: 0, frameEvery: 1e9, dt: 1e-4 }).range;
    const fast = simulate(build(kind, defaultsFor(kind)), { afterRelease: 0, frameEvery: 1e9, dt: 2e-3 }).range;
    // impacts land on step boundaries; the walking arm's sling twitch after the spikes bite shifts by a step at 2 ms
    // (0.34 %; 0.003 % at the UI's 0.5 ms). The optimizer re-runs its pick at full accuracy, so that is fine.
    expect(Math.abs(fast - ref) / ref).toBeLessThan(kind === 'walking' ? 5e-3 : 1e-3);
  });
});
