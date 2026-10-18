// Structural checks over a shot's load history (Result.loads): every part gets a utilization u = demand/strength at
// every sample, under one of two criteria. The first sample with u > 1 is where the machine breaks.
//   rupture: mean values (wood at its rupture, metal at yield, rope at its breaking load), loads as simulated.
//   design: loads × 1.4; wood per NBR 7190:1997 (k_mod = 1.1·1.0·0.8 = 0.88 instantaneous load, dry, 2nd grade;
//     f_k = 0.7·f_m, γ_w = 1.4; shear f_vk = 0.54·f_vm, γ_v = 1.8; bending held to the compressed fiber's f_c0,d;
//     tension f_t0 = f_c0/0.77), steel per NBR 8800 (γ_a1 = 1.10), ropes at a fifth of the breaking load.
import { point } from './physics/constraints';
import type { Mechanism, Vec } from './physics/model';
import type { Result } from './physics/solver';
import { barMat, hasSection, ROPE_MATS, section, type BarMat, type PartSpec } from './materials';

export type Mode = 'rupture' | 'design';
export const MODE_LABEL: Record<Mode, string> = { rupture: 'Ruptura (valores médios)', design: 'Projeto (NBR 7190 / NBR 8800)' };
const KMOD = 0.88;

type Kind = 'bend' | 'comp' | 'tens' | 'shear' | 'bearing0' | 'bearing90';
export function strength(mat: BarMat, k: Kind, mode: Mode): number {
  if (mat.metal) {
    const f = k === 'shear' ? mat.fv : k.startsWith('bearing') ? 1.5 * mat.fm : mat.fm; // ponytail: bearing ≈ 1.5·f_y, not NBR 8800's 2.4·f_u/γ
    return mode === 'design' ? f / 1.1 : f;
  }
  const ft = mat.fc0 / 0.77;
  if (mode === 'rupture') return { bend: mat.fm, comp: mat.fc0, tens: ft, shear: mat.fv, bearing0: mat.fc0, bearing90: mat.fc0 / 4 }[k];
  const d = (fm: number, g: number) => (KMOD * 0.7 * fm) / g;
  return { bend: d(mat.fc0, 1.4), comp: d(mat.fc0, 1.4), tens: d(ft, 1.8), shear: (KMOD * 0.54 * mat.fv) / 1.8, bearing0: d(mat.fc0, 1.4), bearing90: d(mat.fc0, 1.4) / 4 }[k];
}
const loadFactor = (mode: Mode) => (mode === 'design' ? 1.4 : 1);
// Euler load of a pinned strut (design: E·k_mod for wood, then the material's γ)
const euler = (mat: BarMat, I: number, L: number, mode: Mode) =>
  (Math.PI ** 2 * (mode === 'design' && !mat.metal ? KMOD : 1) * mat.E * I) / (L * L) / (mode === 'design' ? (mat.metal ? 1.1 : 1.4) : 1);
export const ropeBreaking = (s: PartSpec) => s.F ?? (ROPE_MATS[s.mat ?? 'nylon'] ?? ROPE_MATS.nylon).su * Math.PI * (s.d ?? 0.012) ** 2 / 4;

export interface Check {
  id: string; // part id (the card's)
  key: string; // mechanism key drawn red on failure (b:i / j:i)
  label: string;
  u: number; // worst utilization over the shot
  t: number; // when
  detail: string; // demand vs strength at that instant
  fail?: { t: number; detail: string; x?: number }; // first sample past u = 1 (x: rod local coordinate)
}
export interface Assessment { checks: Check[]; failure?: Check & { fail: NonNullable<Check['fail']> } }

const MPa = (s: number) => `${(s / 1e6).toFixed(1).replace('.', ',')} MPa`;
const kN = (f: number) => `${(f / 1000).toFixed(2).replace('.', ',')} kN`;

// spec: the card's material / section per part id ('arm', 'axle', 'frame', 'hanger', 'sling', 'string', 'cam', 'leg')
export function assess(m: Mechanism, r: Result, spec: Record<string, PartSpec>, mode: Mode): Assessment {
  const checks = new Map<string, Check>();
  const g = loadFactor(mode);
  // u is computed for every sample; the detail text only when it becomes the worst or the first failure
  const note = (id: string, key: string, label: string, u: number, t: number, detail: () => string, x?: number) => {
    let c = checks.get(id + label);
    if (!c) checks.set(id + label, (c = { id, key, label, u: -1, t, detail: '' }));
    if (u > c.u) (c.u = u), (c.t = t), (c.detail = detail());
    if (u > 1 && !c.fail) c.fail = { t, detail: detail(), ...(x !== undefined ? { x } : {}) };
  };

  const ax = m.joints[m.axle] as { a: number; pa: Vec; kind: string; b?: unknown; pb?: Vec; friction?: { radius: number } };
  const arm = ax.a;
  const sling = m.joints[m.sling] as { b?: unknown; pb?: Vec };
  const rodSpec = (id: string, b: number): [BarMat, PartSpec] => {
    const s = spec[id] ?? {};
    const mat = barMat(s.mat);
    if (hasSection(s)) return [mat, s];
    const sh = m.bodies[b].shape, L = sh.kind === 'rod' ? sh.length : 1, side = Math.sqrt(m.bodies[b].mass / (mat.rho * L)); // the card's estimate
    return [mat, { shape: 'rect', b: side, h: side }];
  };
  const rods: [string, number][] = [['arm', arm], ...m.bodies.flatMap((b, i): [string, number][] => (b.name === 'perna' ? [['leg', i]] : []))];
  const ropes = m.joints.flatMap((j, i): [string, number][] =>
    i === m.sling ? [['sling', i]] : j.kind === 'cam' ? [['cam', i]] : j.kind === 'rope' ? [['string', i]] : []);
  const hangI = m.joints.findIndex((j) => j.kind === 'pin' && j.a === m.counterweight && (j.pa[0] || j.pa[1]));
  const where = (x: number) => {
    const d = Math.abs(x - ax.pa[0]);
    if (d < 0.02) return 'no eixo';
    const long = sling.b === arm && sling.pb ? (x - ax.pa[0]) * (sling.pb[0] - ax.pa[0]) > 0 : true;
    return `a ${d.toFixed(2).replace('.', ',')} m do eixo, braço ${long ? 'longo' : 'curto'}`;
  };

  for (const S of r.loads ?? []) {
    // bars (arm, walking leg): (|N|/A + |M|/W) vs bending strength, τ = k·V/A vs shear
    for (const [id, b] of rods) {
      const L = S.rods[b];
      if (!L) continue;
      const [mat, ss] = rodSpec(id, b), sec = section(ss), fb = strength(mat, 'bend', mode), fv = strength(mat, 'shear', mode);
      let kb = 0, kv = 0, ub = -1, uv = -1;
      for (let k = 0; k < L.x.length; k++) {
        const u1 = (g * (Math.abs(L.N[k]) / sec.A + Math.abs(L.M[k]) / sec.W)) / fb, u2 = (g * sec.k * Math.abs(L.V[k])) / sec.A / fv;
        if (u1 > ub) (ub = u1), (kb = k);
        if (u2 > uv) (uv = u2), (kv = k);
      }
      const label = id === 'arm' ? 'Braço' : 'Perna';
      const at = (k: number) => (id === 'arm' ? where(L.x[k]) : `a ${(L.x[k] + L.x[L.x.length - 1]).toFixed(2).replace('.', ',')} m do eixo`);
      note(id, `b:${b}`, `${label}: flexão + normal`, ub, S.t, () => `σ = ${MPa(ub * fb)} ${ub > 1 ? '>' : '≤'} ${MPa(fb)} ${at(kb)}`, L.x[kb]);
      note(id, `b:${b}`, `${label}: cisalhamento`, uv, S.t, () => `τ = ${MPa(uv * fv)} ${uv > 1 ? '>' : '≤'} ${MPa(fv)} ${at(kv)}`, L.x[kv]);
    }

    // axle pin: double shear, bending over the span (arm width + 2 cm), bearing in the arm's hole (Hankinson for wood)
    const F = S.F[m.axle], Fm = Math.hypot(...F);
    const rP = ax.friction?.radius ?? 0.05;
    if (Fm > 0) {
      const pin = barMat(spec.axle?.mat, 'aco-a36');
      const [armMat, armSpec] = rodSpec('arm', arm), armSec = section(armSpec);
      const width = armSpec.b ?? armSpec.d ?? 0.1;
      const tau = ((4 / 3) * (g * Fm / 2)) / (Math.PI * rP * rP), uS = tau / strength(pin, 'shear', mode);
      const Mp = g * Fm * ((width + 0.02) / 4 - width / 8), sig = Mp / ((Math.PI * rP ** 3) / 4), uB = sig / strength(pin, 'bend', mode);
      const i = 3 * arm, e: Vec = [Math.cos(S.q[i + 2]), Math.sin(S.q[i + 2])];
      const c2 = ((F[0] * e[0] + F[1] * e[1]) / Fm) ** 2; // cos² of the angle between the load and the grain
      const f0 = strength(armMat, 'bearing0', mode), f90 = strength(armMat, 'bearing90', mode);
      const fe = armMat.metal ? f0 : (f0 * f90) / (f0 * (1 - c2) + f90 * c2);
      const sb = (g * Fm) / (2 * rP * armSec.bearing), uE = sb / fe;
      note('axle', `j:${m.axle}`, 'Eixo: cisalhamento duplo', uS, S.t, () => `τ = ${MPa(tau)} contra ${MPa(strength(pin, 'shear', mode))} (força ${kN(Fm)})`);
      note('axle', `j:${m.axle}`, 'Eixo: flexão do pino', uB, S.t, () => `σ = ${MPa(sig)} contra ${MPa(strength(pin, 'bend', mode))}`);
      note('axle', `j:${m.axle}`, 'Eixo: esmagamento do furo no braço', uE, S.t, () => `σ = ${MPa(sb)} contra ${MPa(fe)} (${(Math.acos(Math.sqrt(c2)) * 180 / Math.PI).toFixed(0)}° das fibras)`);
    }

    // frame: two A-frames under a fixed axle, feet at ±0.5·h (as drawn); each takes half the load
    if (ax.kind === 'pin' && ax.b === 'ground' && spec.frame && hasSection(spec.frame) && Fm > 0) {
      const mat = barMat(spec.frame.mat), sec = section(spec.frame), h = ax.pb![1], Lleg = h * Math.sqrt(1.25);
      const u1: Vec = [-0.5 / Math.sqrt(1.25), -1 / Math.sqrt(1.25)], u2: Vec = [0.5 / Math.sqrt(1.25), -1 / Math.sqrt(1.25)];
      const P: Vec = [(-g * F[0]) / 2, (-g * F[1]) / 2]; // on the apex, from the arm
      const det = u1[0] * u2[1] - u1[1] * u2[0];
      const N = [(P[0] * u2[1] - P[1] * u2[0]) / det, (u1[0] * P[1] - u1[1] * P[0]) / det]; // + = compression
      N.forEach((n, k) => {
        const side = k ? 'perna da frente' : 'perna de trás';
        if (n > 0) {
          const uc = n / sec.A / strength(mat, 'comp', mode), Pcr = euler(mat, sec.Imin, Lleg, mode), uk = n / Pcr;
          note('frame', `j:${m.axle}`, `Pórtico: compressão (${side})`, uc, S.t, () => `${kN(n)} → σ = ${MPa(n / sec.A)} contra ${MPa(strength(mat, 'comp', mode))}`);
          note('frame', `j:${m.axle}`, `Pórtico: flambagem (${side})`, uk, S.t, () => `${kN(n)} contra a carga de Euler ${kN(Pcr)} (perna de ${Lleg.toFixed(2).replace('.', ',')} m)`);
        } else note('frame', `j:${m.axle}`, `Pórtico: tração (${side})`, -n / sec.A / strength(mat, 'tens', mode), S.t, () => `${kN(-n)} → σ = ${MPa(-n / sec.A)} contra ${MPa(strength(mat, 'tens', mode))}`);
      });
    }

    // counterweight hanger: axial, along the line from the counterweight to its pin
    if (hangI >= 0 && spec.hanger && hasSection(spec.hanger)) {
      const j = m.joints[hangI] as { a: number; pa: Vec }, Fh = S.F[hangI];
      const pinW = point({ q: S.q, v: S.q }, j.a, j.pa).p, c: Vec = [S.q[3 * j.a], S.q[3 * j.a + 1]];
      const Lh = Math.hypot(...j.pa), uDir: Vec = [(pinW[0] - c[0]) / Lh, (pinW[1] - c[1]) / Lh];
      const n = g * (Fh[0] * uDir[0] + Fh[1] * uDir[1]); // + = the hanger pulls (tension)
      const mat = barMat(spec.hanger.mat, 'aco-1020'), sec = section(spec.hanger);
      if (n >= 0) note('hanger', `j:${hangI}`, 'Haste: tração', n / sec.A / strength(mat, 'tens', mode), S.t, () => `${kN(n)} → σ = ${MPa(n / sec.A)} contra ${MPa(strength(mat, 'tens', mode))}`);
      else {
        note('hanger', `j:${hangI}`, 'Haste: compressão', -n / sec.A / strength(mat, 'comp', mode), S.t, () => `${kN(-n)} → σ = ${MPa(-n / sec.A)} contra ${MPa(strength(mat, 'comp', mode))}`);
        note('hanger', `j:${hangI}`, 'Haste: flambagem', -n / euler(mat, sec.Imin, Lh, mode), S.t, () => `${kN(-n)} contra a carga de Euler ${kN(euler(mat, sec.Imin, Lh, mode))}`);
      }
    }

    // ropes: tension vs breaking load (design: a fifth of it)
    for (const [id, ji] of ropes) {
      const T = Math.hypot(...S.F[ji]);
      if (!T) continue;
      const brk = ropeBreaking(spec[id] ?? {}) / (mode === 'design' ? 5 : 1);
      const label = { sling: 'Funda', cam: 'Corda do contrapeso', string: 'Corda' }[id]!;
      note(id, `j:${ji}`, `${label}: tração`, T / brk, S.t, () => `${kN(T)} contra ${kN(brk)}${mode === 'design' ? ' (ruptura ÷ 5)' : ' (ruptura)'}`);
    }
  }
  const list = [...checks.values()].filter((c) => c.u >= 0);
  const failed = list.filter((c) => c.fail).sort((a, b) => a.fail!.t - b.fail!.t)[0];
  return { checks: list, ...(failed ? { failure: failed as Assessment['failure'] & object } : {}) };
}

// worst utilization of each part (FS = 1/u), for the comparison table
export function byPart(a: Assessment) {
  const out = new Map<string, Check>();
  for (const c of a.checks) if (!out.has(c.id) || c.u > out.get(c.id)!.u) out.set(c.id, c);
  return out;
}
