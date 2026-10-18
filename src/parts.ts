// Part inspector ("BIM" card): every body, joint, spring and crew of a machine as a named part with its dimensions,
// material and checks. Parts are found by key — b:i (body), j:i (joint), s:i (spring), p:i (crew pull) — the same
// indices in the 2D mechanism and its 3D lift. Setters only mutate params / spec / sketch; the caller re-runs.
import { HINTS, LABELS, RANGES } from './labels';
import type { Mechanism, Vec } from './physics/model';
import type { Result } from './physics/solver';
import { KINDS, type Kind, type Params } from './presets';
import type { SBody, SJoint, Sketch } from './sketch';

// --- materials (typical characteristic values; a hand check, not a design code) ---
// bars: EN 338 timber classes (mean density, bending strength f_m,k), structural steel and aluminium (yield)
export const BAR_MATS: Record<string, { label: string; rho: number; f: number }> = {
  c24: { label: 'Madeira C24 (pinho)', rho: 420, f: 24e6 },
  d30: { label: 'Madeira D30 (carvalho)', rho: 640, f: 30e6 },
  d40: { label: 'Madeira D40 (eucalipto)', rho: 660, f: 40e6 },
  al: { label: 'Alumínio 6061-T6', rho: 2700, f: 240e6 },
  s235: { label: 'Aço S235', rho: 7850, f: 235e6 },
};
// ropes: breaking load ≈ su · πd²/4 on the nominal diameter (12 mm: sisal ~9 kN, nylon ~28 kN, steel 6×19 ~85 kN)
export const ROPE_MATS: Record<string, { label: string; su: number }> = {
  sisal: { label: 'Sisal / cânhamo', su: 80e6 },
  poly: { label: 'Poliéster', su: 220e6 },
  nylon: { label: 'Nylon (poliamida)', su: 250e6 },
  steel: { label: 'Cabo de aço 6×19', su: 750e6 },
  dyneema: { label: 'Dyneema (UHMWPE)', su: 800e6 },
};
export const CW_MATS: Record<string, { label: string; rho: number }> = {
  water: { label: 'Água (tanque)', rho: 1000 },
  sand: { label: 'Caixa de areia', rho: 1600 },
  concrete: { label: 'Concreto', rho: 2400 },
  stone: { label: 'Pedra', rho: 2500 },
  iron: { label: 'Ferro', rho: 7800 },
  lead: { label: 'Chumbo', rho: 11300 },
};
export const PROJ_MATS: Record<string, { label: string; rho: number }> = {
  clay: { label: 'Argila cozida', rho: 1800 },
  stone: { label: 'Pedra (granito)', rho: 2700 },
  iron: { label: 'Ferro fundido', rho: 7200 },
  lead: { label: 'Chumbo', rho: 11300 },
};
// axle pins in double shear: τ_max = (4/3)·(F/2)/(πr²) against f_v = f_y/√3
export const AXLE_MATS: Record<string, { label: string; fy: number }> = {
  s235: { label: 'Aço S235', fy: 235e6 },
  s355: { label: 'Aço S355', fy: 355e6 },
};

export type PartSpec = { mat?: string; b?: number; h?: number; d?: number }; // bar section b × h (m), rope or pin diameter d (m)
export type Spec = Record<string, PartSpec>;

export type Status = 'ok' | 'warn' | 'fail';
// ok from 2 (bars, pins); ropes from 5: knots and splices take about half of the breaking load
export const statusOf = (fs: number, okAt = 2): Status => (fs >= okAt ? 'ok' : fs >= 1 ? 'warn' : 'fail');
const statusText = (s: Status, okAt: number) => ({ ok: `ok (≥ ${okAt})`, warn: `atenção (1–${okAt})`, fail: 'falha (< 1)' })[s];

export type Input =
  | { kind: 'number'; value: number; min?: number; max?: number; step?: number; unit?: string; set: (v: number) => void }
  | { kind: 'select'; value: string; options: [string, string][]; set: (v: string) => void }
  | { kind: 'text'; value: string; set: (v: string) => void };
export interface Row { label: string; value?: string; hint?: string; note?: string; input?: Input; status?: Status }
export interface Part { id: string; title: string; keys: string[]; rows: Row[]; note?: string }

// --- formatting ---
const fmt = (v: number, d = 2) => (Math.abs(v) >= 1000 ? v.toFixed(0) : +v.toPrecision(4) === Math.round(v) ? String(Math.round(v)) : v.toFixed(d));
const kN = (n: number) => (n < 1000 ? `${fmt(n, 1)} N` : `${fmt(n / 1000, 2)} kN`);
const MPa = (s: number) => `${fmt(s / 1e6, 1)} MPa`;
const sel = (m: Record<string, { label: string }>): [string, string][] => Object.entries(m).map(([k, v]) => [k, v.label]);
const clampP = (f: keyof Params, v: number) => Math.min(RANGES[f][1], Math.max(RANGES[f][0], v));

// --- checks shared by presets and free designs ---
export function barCheck(moment: number, b: number, h: number, f: number) {
  const W = (b * h * h) / 6; // rectangle bent in its depth h (the plane of the throw)
  const sigma = moment / W;
  return { W, sigma, fs: f / sigma };
}
export function ropeCheck(force: number, d: number, su: number) {
  const breaking = (su * Math.PI * d * d) / 4;
  return { breaking, fs: breaking / force };
}
export function pinCheck(force: number, r: number, fy: number) {
  const tau = ((4 / 3) * (force / 2)) / (Math.PI * r * r);
  return { tau, fs: fy / Math.sqrt(3) / tau };
}
const fsRows = (fs: number, okAt = 2, note?: string): Row[] =>
  Number.isFinite(fs) ? [{ label: 'Fator de segurança', value: `${fmt(fs, 2)} · ${statusText(statusOf(fs, okAt), okAt)}`, status: statusOf(fs, okAt), note }] : [];

// Bar material + section rows. Without a stored section, a square one is estimated from the mass (shown as such);
// editing material or section sets the mass to ρ·b·h·L.
function barRows(spec: PartSpec, attach: () => void, L: number, mass: number, setMass: (m: number) => void, moment?: number): Row[] {
  const mat = BAR_MATS[spec.mat ?? 'd30'] ?? BAR_MATS.d30;
  const estimated = !(spec.b && spec.h);
  const side = Math.sqrt(mass / (mat.rho * L));
  const b = spec.b ?? side, h = spec.h ?? side;
  const apply = () => (attach(), setMass((BAR_MATS[spec.mat ?? 'd30'] ?? BAR_MATS.d30).rho * (spec.b ?? side) * (spec.h ?? side) * L)); // the material chosen now, not when the card was built
  const rows: Row[] = [
    { label: 'Material', input: { kind: 'select', value: spec.mat ?? 'd30', options: sel(BAR_MATS), set: (v) => ((spec.mat = v), (spec.b ??= b), (spec.h ??= h), apply()) } },
    { label: 'Seção: largura b', hint: estimated ? 'Estimada pela massa (seção quadrada). Digite para fixar.' : undefined,
      input: { kind: 'number', value: +(b * 100).toFixed(1), min: 0.5, step: 0.5, unit: 'cm', set: (v) => ((spec.b = v / 100), (spec.h ??= h), apply()) } },
    { label: 'Seção: altura h (no plano do giro)', hint: estimated ? 'Estimada pela massa (seção quadrada). Digite para fixar.' : undefined,
      input: { kind: 'number', value: +(h * 100).toFixed(1), min: 0.5, step: 0.5, unit: 'cm', set: (v) => ((spec.h = v / 100), (spec.b ??= b), apply()) } },
    { label: 'Massa pela seção (ρ·b·h·L)', value: `${fmt(mat.rho * b * h * L)} kg${Math.abs(mat.rho * b * h * L - mass) > 0.01 * mass ? ` (atual: ${fmt(mass)} kg)` : ''}` },
  ];
  if (moment !== undefined && moment > 0) {
    const c = barCheck(moment, b, h, mat.f);
    rows.push(
      { label: 'Módulo resistente W = b·h²/6', value: `${fmt(c.W * 1e6, 1)} cm³` },
      { label: 'Tensão máxima σ = M/W', value: MPa(c.sigma) },
      { label: `Resistência (${mat.label.split(' (')[0]})`, value: MPa(mat.f) },
      ...fsRows(c.fs, 2, estimated ? 'Com a seção estimada pela massa: digite b e h reais para uma verificação de verdade.' : undefined),
    );
  }
  return rows;
}

function ropeRows(spec: PartSpec, attach: () => void, force: number | undefined): Row[] {
  const mat = ROPE_MATS[spec.mat ?? 'nylon'] ?? ROPE_MATS.nylon;
  const d = spec.d ?? 0.012;
  const rows: Row[] = [
    { label: 'Material da corda', input: { kind: 'select', value: spec.mat ?? 'nylon', options: sel(ROPE_MATS), set: (v) => ((spec.mat = v), attach()) } },
    { label: 'Diâmetro', input: { kind: 'number', value: +(d * 1000).toFixed(1), min: 1, step: 1, unit: 'mm', set: (v) => ((spec.d = v / 1000), attach()) } },
  ];
  const c = ropeCheck(force ?? 0, d, mat.su);
  rows.push({ label: 'Carga de ruptura (≈ σᵤ·πd²/4)', value: kN(c.breaking) });
  if (force) rows.push({ label: 'Pico de tração', value: kN(force) }, ...fsRows(c.fs, 5));
  return rows;
}

function pinRows(spec: PartSpec, attach: () => void, r: number, force: number | undefined): Row[] {
  const mat = AXLE_MATS[spec.mat ?? 's235'] ?? AXLE_MATS.s235;
  const rows: Row[] = [{ label: 'Material do eixo', input: { kind: 'select', value: spec.mat ?? 's235', options: sel(AXLE_MATS), set: (v) => ((spec.mat = v), attach()) } }];
  if (force) {
    const c = pinCheck(force, r, mat.fy);
    rows.push({ label: 'Pico de força no eixo', value: kN(force) }, { label: 'Cisalhamento duplo τ = 4/3·(F/2)/(πr²)', value: MPa(c.tau) }, { label: 'Resistência ao cisalhamento f_y/√3', value: MPa(mat.fy / Math.sqrt(3)) }, ...fsRows(c.fs));
  }
  return rows;
}

const peak = (r: Result | undefined, j: number) => (r && r.peakForce[j] > 0 ? r.peakForce[j] : undefined);
const forceRow = (f: number | undefined): Row[] => (f ? [{ label: 'Pico de força (até a soltura)', value: kN(f) }] : []);
const JOINT_NAME: Record<string, string> = {
  pin: 'Pino', weld: 'Solda', rope: 'Corda', slider: 'Trilho', stop: 'Apoio', foot: 'Pé com espinhos', spike: 'Espetos',
  roller: 'Rolete', floor: 'Chão', cam: 'Tambor', pull: 'Equipe', spring: 'Mola',
};

// ===================================================================================================== presets
export interface PresetCtx { kind: Kind; p: Params; spec: Spec; m: Mechanism; r?: Result }

// which part every key of the mechanism belongs to
export function presetOwner(m: Mechanism): Map<string, string> {
  const own = new Map<string, string>();
  const arm = (m.joints[m.axle] as { a?: number }).a;
  const cw = m.counterweight;
  m.bodies.forEach((b, i) => own.set(`b:${i}`, i === arm ? 'arm' : i === m.projectile ? 'proj' : i === cw ? 'cw' : b.name === 'perna' ? 'leg' : `b:${i}`));
  m.joints.forEach((j, i) => {
    const touches = (k: number | undefined) => k !== undefined && (j.a === k || ('b' in j && j.b === k));
    const id =
      i === m.axle ? 'axle'
      : i === m.sling ? 'sling'
      : j.kind === 'pin' && touches(cw) && (j.pa[0] || j.pa[1]) ? 'hanger'
      : j.kind === 'cam' ? 'cam'
      : j.kind === 'roller' ? 'roller'
      : j.kind === 'slider' ? 'guide'
      : j.kind === 'rope' ? 'string'
      : j.kind === 'floor' ? (j.a === m.projectile ? 'proj' : j.a === cw ? 'cw' : 'floor')
      : touches(cw) ? 'cw'
      : (j.kind === 'foot' || j.kind === 'spike') ? (own.get(`b:${j.a}`) ?? `j:${i}`)
      : `j:${i}`;
    own.set(`j:${i}`, id);
  });
  m.springs?.forEach((_, i) => own.set(`s:${i}`, 'springs'));
  m.pulls?.forEach((_, i) => own.set(`p:${i}`, 'crew'));
  return own;
}

export function presetParts(c: PresetCtx): Part[] {
  const { kind, p, spec, m, r } = c;
  const fields = KINDS[kind].fields;
  const own = presetOwner(m);
  const keysOf = (id: string) => [...own].filter(([, v]) => v === id).map(([k]) => k);
  const param = (f: keyof Params): Row[] => {
    if (!fields.includes(f)) return [];
    const [min, max, step] = RANGES[f];
    return [{ label: LABELS[f], hint: HINTS[f], input: { kind: 'number', value: p[f], min, max, step, set: (v) => (p[f] = clampP(f, v)) } }];
  };
  const specOf = (id: string): [PartSpec, () => void] => {
    const s = spec[id] ?? {};
    return [s, () => (spec[id] = s)];
  };
  const shape = (i: number | undefined) => (i === undefined ? undefined : m.bodies[i].shape);
  const parts: Part[] = [];
  const add = (id: string, title: string, rows: Row[], note?: string) => keysOf(id).length && parts.push({ id, title, keys: keysOf(id), rows, note });

  const arm = (m.joints[m.axle] as { a: number }).a;
  const L = m.bodies[arm].shape.kind === 'rod' ? m.bodies[arm].shape.length : 0;
  const setArmMass = (v: number) => (p.armMass = clampP('armMass', +v.toFixed(3)));
  const lengthRow = (f: 'longArm' | 'shortArm') => param(f).map((row) => {
    const set = (row.input as Extract<Input, { kind: 'number' }>).set;
    return { ...row, input: { ...(row.input as Extract<Input, { kind: 'number' }>), set: (v: number) => {
      set(v);
      const s = spec.arm; // an explicit section keeps its mass per meter: a longer arm weighs more
      if (s?.b && s.h) setArmMass((BAR_MATS[s.mat ?? 'd30'] ?? BAR_MATS.d30).rho * s.b * s.h * (p.longArm + p.shortArm));
    } } };
  });
  add('arm', 'Braço', [
    { label: 'Comprimento total', value: `${fmt(L)} m` },
    ...lengthRow('longArm'), ...lengthRow('shortArm'), ...param('armMass'),
    ...(kind === 'whipper' || kind === 'ka' || kind === 'faka' ? param('cockDeg') : []),
    { label: 'Momento de inércia (centro)', value: `${fmt((m.bodies[arm].mass * L * L) / 12)} kg·m²` },
    ...(r?.peakBending ? [{ label: 'Pico de flexão', value: `${kN(r.peakBending.moment).replace('N', 'N·m')} ${r.peakBending.fromAxle < 0.02 ? 'no eixo' : `a ${fmt(r.peakBending.fromAxle)} m do eixo`}` }] : []),
    ...barRows(...specOf('arm'), L, m.bodies[arm].mass, setArmMass, r?.peakBending?.moment),
  ], r?.peakBending ? undefined : 'Dispare para ver a verificação de flexão.');

  const ax = m.joints[m.axle];
  const axleTitle = ax.kind === 'pin' ? (ax.b === 'ground' ? 'Eixo e pórtico' : 'Eixo (braço–perna)') : ax.kind === 'slider' ? 'Eixo sobre trilho (rodas)' : 'Rodas do eixo e trilho de pouso';
  add('axle', axleTitle, [
    ...param('pivotHeight'), ...param('axleLift'), ...param('axleRadius'), ...param('axleMu'),
    ...(ax.kind !== 'pin' && fields.includes('rollCrr') ? param('rollCrr') : []),
    ...(ax.kind === 'pin' ? pinRows(...specOf('axle'), p.axleRadius, peak(r, m.axle)) : forceRow(peak(r, m.axle))),
  ]);

  const cw = m.counterweight;
  const cs = shape(cw);
  if (cw !== undefined && cs?.kind === 'disk') {
    const matKey = Object.keys(CW_MATS).find((k) => CW_MATS[k].rho === p.cwDensity);
    add('cw', 'Contrapeso', [
      ...param('cwMass'),
      ...(fields.includes('cwDensity') ? [{ label: 'Material', input: { kind: 'select' as const, value: matKey ?? '', options: [...sel(CW_MATS), ...(matKey ? [] : [['', `outro (${fmt(p.cwDensity)} kg/m³)`] as [string, string]])], set: (v: string) => v && (p.cwDensity = CW_MATS[v].rho) } }] : []),
      ...param('cwDensity'),
      { label: 'Raio (esfera equivalente)', value: `${fmt(cs.radius * 100, 1)} cm` },
      { label: 'Volume', value: `${fmt((4 / 3) * Math.PI * cs.radius ** 3, 3)} m³` },
    ]);
  }
  const hangI = m.joints.findIndex((_, i) => own.get(`j:${i}`) === 'hanger');
  add('hanger', 'Haste do contrapeso', [...param('hingeLength'), ...forceRow(peak(r, hangI))]);

  const ps = shape(m.projectile);
  const V = ps?.kind === 'disk' ? (4 / 3) * Math.PI * ps.radius ** 3 : 0;
  const pm = Object.keys(PROJ_MATS).find((k) => Math.abs(PROJ_MATS[k].rho * V - p.projMass) < 0.03 * p.projMass);
  add('proj', 'Projétil', [
    ...param('projMass'), ...param('projRadius'),
    { label: 'Material (ajusta a massa ao raio)', input: { kind: 'select', value: pm ?? '', options: [...sel(PROJ_MATS), ...(pm ? [] : [['', 'outro'] as [string, string]])], set: (v) => v && (p.projMass = clampP('projMass', +(PROJ_MATS[v].rho * V).toFixed(3))) } },
    { label: 'Densidade aparente (m/V)', value: `${fmt(p.projMass / V)} kg/m³` },
    ...param('dragCd'), ...param('troughMu'),
  ]);

  add('sling', 'Funda', [...param('slingLength'), ...param('releaseDeg'), ...ropeRows(...specOf('sling'), peak(r, m.sling))]);
  const legI = m.bodies.findIndex((b) => b.name === 'perna');
  if (legI >= 0) {
    const legL = shape(legI)?.kind === 'rod' ? (shape(legI) as { length: number }).length : 0;
    add('leg', 'Perna', [...param('legLength'), ...param('legMass'), ...barRows(...specOf('leg'), legL, m.bodies[legI].mass, (v) => (p.legMass = clampP('legMass', +v.toFixed(3))))]);
  }
  const strI = m.joints.findIndex((_, i) => own.get(`j:${i}`) === 'string');
  add('string', kind === 'walking' ? 'Corda de ajuste da perna' : 'Corda', [...(kind === 'walking' ? param('cockDeg') : []), ...ropeRows(...specOf('string'), peak(r, strI))]);
  const camI = m.joints.findIndex((j) => j.kind === 'cam');
  add('cam', 'Tambor e corda do contrapeso', [...param('camStart'), ...param('camEnd'), ...param('pulleyHeight'), ...ropeRows(...specOf('cam'), peak(r, camI))]);
  const rolI = m.joints.findIndex((j) => j.kind === 'roller');
  add('roller', 'Rolete', [...param('rollerOffset'), ...param('rollCrr'), ...forceRow(peak(r, rolI))]);
  const guI = m.joints.findIndex((_, i) => own.get(`j:${i}`) === 'guide');
  add('guide', 'Guia vertical do contrapeso', [...param('rollCrr'), ...forceRow(peak(r, guI))]);
  add('floor', 'Chão de pouso', [{ label: 'O quê', value: 'Uma peça que pousa e não atravessa' }]);
  if (m.springs?.length) {
    const sp = m.springs[0];
    const L0 = Math.hypot(...([0, 1].map((k) => m.bodies[sp.body].pos[k] + rotLocal(m.bodies[sp.body].angle, sp.local)[k] - sp.anchor[k]) as [number, number]));
    add('springs', 'Molas', [...param('springK'), ...param('springRest'), { label: 'Comprimento armado', value: `${fmt(L0)} m` }, { label: 'Energia armazenada ½k(L − L₀)²', value: `${fmt((0.5 * p.springK * Math.max(0, L0 - p.springRest) ** 2) / 1000)} kJ` }]);
  }
  add('crew', 'Equipe de tração', [...param('crewForce'), ...param('pullStroke'), { label: 'Pessoas (≈ 250 N cada)', value: fmt(p.crewForce / 250, 0) }, { label: 'Trabalho F·s', value: `${fmt((p.crewForce * p.pullStroke) / 1000)} kJ` }]);

  // anything left (so every piece on screen opens a card)
  for (const [key, id] of own) {
    if (parts.some((pt) => pt.id === id)) continue;
    const [t, i] = [key[0], +key.slice(2)];
    const title = t === 'b' ? m.bodies[i].name : JOINT_NAME[m.joints[i]?.kind] ?? 'Ligação';
    parts.push({ id, title, keys: [key], rows: t === 'j' ? forceRow(peak(r, i)) : [{ label: 'Massa', value: `${fmt(m.bodies[i].mass)} kg` }] });
  }
  return parts;
}
const rotLocal = (a: number, v: Vec): Vec => [Math.cos(a) * v[0] - Math.sin(a) * v[1], Math.sin(a) * v[0] + Math.cos(a) * v[1]];

// ===================================================================================================== free designs
// Sketch joint i → mechanism key (compile() drops crew pulls and springs out of the joint list, in order)
export function sketchToMech(sk: Sketch, i: number): string {
  const j = sk.joints[i];
  const before = sk.joints.slice(0, i);
  if (j.kind === 'pull') return `p:${before.filter((x) => x.kind === 'pull').length}`;
  if (j.kind === 'spring') return `s:${before.filter((x) => x.kind === 'spring').length}`;
  return `j:${before.filter((x) => x.kind !== 'pull' && x.kind !== 'spring').length}`;
}
export function mechToSketch(sk: Sketch, key: string): string | undefined {
  if (key.startsWith('b:')) return +key.slice(2) < sk.bodies.length ? key : undefined;
  const i = sk.joints.findIndex((_, k) => sketchToMech(sk, k) === key);
  return i < 0 ? undefined : `j:${i}`; // the projectile's regenerated trough has no sketch joint
}

export interface FreeCtx { sk: Sketch; m?: Mechanism; r?: Result }
const len = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// the card of one sketch part (key b:i or j:i of the sketch)
export function sketchPart(c: FreeCtx, key: string): Part | undefined {
  const { sk, m, r } = c;
  const i = +key.slice(2);
  const num = (label: string, value: number, set: (v: number) => void, o: { min?: number; step?: number; unit?: string; hint?: string } = {}): Row =>
    ({ label, hint: o.hint, input: { kind: 'number', value: +value.toPrecision(6), min: o.min, step: o.step ?? 0.01, unit: o.unit, set } });
  const pos = (v: number) => Number.isFinite(v) && v > 0;
  if (key.startsWith('b:')) {
    const b: SBody | undefined = sk.bodies[i];
    if (!b) return undefined;
    const rows: Row[] = [{ label: 'Nome', input: { kind: 'text', value: b.name, set: (v) => (b.name = v.slice(0, 40)) } }, num('Massa', b.mass, (v) => pos(v) && (b.mass = v), { unit: 'kg' })];
    const spec = b.spec ?? {};
    const attach = () => (b.spec = spec);
    if (b.kind === 'rod') {
      const L = len(b.a, b.b);
      const arm = m && (m.joints[m.axle] as { a?: number } | undefined)?.a === i;
      rows.push({ label: 'Comprimento', value: `${fmt(L)} m` }, ...barRows(spec, attach, L, b.mass, (v) => (b.mass = +v.toFixed(3)), arm ? r?.peakBending?.moment : undefined));
    } else {
      const V = (4 / 3) * Math.PI * b.r ** 3;
      const mats = b.role === 'counterweight' ? CW_MATS : PROJ_MATS;
      const mk = Object.keys(mats).find((k) => Math.abs(mats[k].rho * V - b.mass) < 0.03 * b.mass);
      rows.push(
        num('Raio', b.r, (v) => pos(v) && (b.r = v), { unit: 'm' }),
        { label: 'Papel', input: { kind: 'select', value: b.role ?? '', options: [['', 'nenhum'], ['projectile', 'projétil'], ['counterweight', 'contrapeso']], set: (v) => {
          if (v === 'projectile') sk.bodies.forEach((x) => x.kind === 'disk' && x.role === 'projectile' && delete x.role);
          if (v) b.role = v as 'projectile' | 'counterweight'; else delete b.role;
        } } },
        { label: 'Material (ajusta a massa ao raio)', input: { kind: 'select', value: mk ?? '', options: [...sel(mats), ...(mk ? [] : [['', 'outro'] as [string, string]])], set: (v) => v && (b.mass = +(mats[v].rho * V).toFixed(3)) } },
        { label: 'Densidade aparente (m/V)', value: `${fmt(b.mass / V)} kg/m³` },
      );
    }
    return { id: key, title: b.name, keys: [key], rows };
  }
  const j: SJoint | undefined = sk.joints[i];
  if (!j) return undefined;
  const mk = sketchToMech(sk, i);
  const force = mk.startsWith('j:') ? peak(r, +mk.slice(2)) : undefined;
  const spec = j.spec ?? {};
  const attach = () => (j.spec = spec);
  const rows: Row[] = [];
  const tilt = (k: 'pitch' | 'yaw', label: string) => num(label, (j as { pitch?: number; yaw?: number })[k] ?? 0, (v) => {
    if (j.kind !== 'pin' || !Number.isFinite(v)) return;
    if (v) j[k] = Math.max(-45, Math.min(45, v));
    else delete j[k];
  }, { unit: '°', step: 1, hint: 'Só vale na Vista 3D: inclinação ergue um lado do eixo; guinada o gira em planta (máximo ±45°).' });
  if (j.kind === 'pin') {
    rows.push(num('Atrito μ', j.mu ?? 0, (v) => v >= 0 && (j.mu = v)), num('Raio do eixo', j.radius ?? 0.05, (v) => pos(v) && (j.radius = v), { unit: 'm', step: 0.001 }),
      tilt('pitch', 'Eixo: inclinação (3D)'), tilt('yaw', 'Eixo: guinada (3D)'));
    if (j.b === 'ground') rows.push(...pinRows(spec, attach, j.radius ?? 0.05, force));
    else rows.push(...forceRow(force));
  } else if (j.kind === 'rope') rows.push({ label: 'Comprimento', value: `${fmt(len(j.pa, j.pb))} m` }, ...ropeRows(spec, attach, force));
  else if (j.kind === 'pull') rows.push(num('Força da equipe', j.force, (v) => pos(v) && (j.force = v), { unit: 'N', step: 100 }), num('Curso do puxão', j.stroke, (v) => pos(v) && (j.stroke = v), { unit: 'm' }), { label: 'Trabalho F·s', value: `${fmt((j.force * j.stroke) / 1000)} kJ` });
  else if (j.kind === 'floor') rows.push(num('Altura do chão', j.y, (v) => Number.isFinite(v) && (j.y = v), { unit: 'm' }), num('Atrito ao pousar (μ; rodas: Crr)', j.mu ?? 0, (v) => v >= 0 && (j.mu = Math.min(1, v) || undefined)), ...forceRow(force));
  else if (j.kind === 'slider' || j.kind === 'roller') rows.push(num('Resistência ao rolamento (Crr)', j.mu ?? 0, (v) => v >= 0 && (j.mu = Math.min(1, v) || undefined), { step: 0.001, hint: 'Força contra o rolamento = Crr × carga. Rodas duras em trilho ≈ 0,001–0,005; madeira ou skate ≈ 0,005–0,02.' }), ...forceRow(force));
  else if (j.kind === 'spring') {
    const Ls = len(j.at, j.anchor);
    rows.push(num('Rigidez k', j.k, (v) => pos(v) && (j.k = v), { unit: 'N/m', step: 100 }), num('Comprimento livre', j.rest, (v) => pos(v) && (j.rest = v), { unit: 'm' }), { label: 'Comprimento armado', value: `${fmt(Ls)} m` }, { label: 'Energia armazenada', value: `${fmt((0.5 * j.k * Math.max(0, Ls - j.rest) ** 2) / 1000)} kJ` });
  } else if (j.kind === 'cam') {
    rows.push(num('Raio inicial', j.r0, (v) => pos(v) && ((j.r0 = v), j.over && (j.over = [j.at[0] - v, j.over[1]])), { unit: 'm' }), num('Raio final', j.r1, (v) => pos(v) && (j.r1 = v), { unit: 'm' }), num('Giro da espiral', j.span, (v) => pos(v) && (j.span = v), { unit: 'rad' }),
      num('Altura da polia (0 = sem)', j.over?.[1] ?? 0, (v) => (v > j.at[1] ? (j.over = [j.at[0] - j.r0, v]) : delete j.over), { unit: 'm' }),
      { label: 'Corda que desenrola até o raio final', value: `${fmt((j.span * (j.r0 + j.r1)) / 2)} m` }, ...ropeRows(spec, attach, force));
  } else rows.push(...forceRow(force));
  return { id: key, title: JOINT_NAME[j.kind] + ('b' in j && j.b === 'ground' ? ' (preso ao chão)' : ''), keys: [mk], rows };
}

export function sketchParts(c: FreeCtx): Part[] {
  return [...c.sk.bodies.map((_, i) => `b:${i}`), ...c.sk.joints.map((_, i) => `j:${i}`)].flatMap((k) => sketchPart(c, k) ?? []);
}

// untrusted JSON → spec: known materials, positive sizes
export function sanitizeSpec(raw: unknown): PartSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const out: PartSpec = {};
  const all = { ...BAR_MATS, ...ROPE_MATS, ...AXLE_MATS };
  if (typeof s.mat === 'string' && Object.hasOwn(all, s.mat)) out.mat = s.mat;
  for (const k of ['b', 'h', 'd'] as const) if (typeof s[k] === 'number' && Number.isFinite(s[k]) && (s[k] as number) > 0 && (s[k] as number) < 10) out[k] = s[k] as number;
  return Object.keys(out).length ? out : undefined;
}
