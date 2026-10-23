import { css, drawChart, sizeCanvases, timeAt, type ChartSpec } from './charts';
import { createEditor } from './editor';
import { HINTS, LABELS, RANGES } from './labels';
import { mountOptimizer } from './optimizer-ui';
import { G, type Mechanism, type Vec } from './physics/model';
import { initialState, simulate, type Result } from './physics/solver';
import { build, defaults, defaultsFor, geometry, KINDS, type Kind, type Params } from './presets';
import { drawFlight, drawMachine, partAt, world, type Bounds, type View } from './render';
import { checksFor, mechToSketch, presetOwner, presetParts, sketchParts, type Checks, type Part, type Spec } from './parts';
import { byPart, MODE_LABEL, type Check, type Mode } from './structure';
import type { View3d } from './render3d';
import { apply3d, lift } from './physics3d/lift';
import { add, rotate, type Mechanism3 } from './physics3d/model3';
import { apply3, compile3, moveNode, nodes3, type Tool3 } from './sketch3';
import { gaussian, scatterStats } from './physics3d/dispersion';
import { seeded } from './optimize';
import { initialState3, type Result3 } from './physics3d/solver3';
import { compile, emptySketch, toSketch, type Sketch } from './sketch';
import { decodeDesign, deleteDesign, download, encodeDesign, importFile, listDesigns, loadCurrent, saveCurrent, saveDesign, type Design } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('params');
const kindSel = $<HTMLSelectElement>('kind');
const machine = $<HTMLCanvasElement>('machine');
const machine3d = $<HTMLCanvasElement>('machine3d');
if (matchMedia('(max-width: 800px)').matches) machine.dataset.h = machine3d.dataset.h = '300'; // phones: leave room for the results below
sizeCanvases();
const params: Params = { ...defaults }; // values survive switching type
kindSel.innerHTML =
  Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('') +
  '<option value="free">✎ Editor livre</option>';

const isFree = () => kindSel.value === 'free';
const editor = createEditor({
  canvas: machine, toolbar: $('tools'), panel: $('free-props'), status: $('free-status'),
  onChange: () => saveCurrent(design()),
  active: () => isFree(),
  onView: () => current && ((current.b = editor.bounds()), drawAt(lastT)), // zoom while watching a shot
  onSelect: (key) => ((selPart = key), renderInspector()),
});
const optimizer = mountOptimizer({
  kind: () => kindSel.value as Kind,
  params,
  apply: (p) => (Object.assign(params, p), syncForm(), run()), // run() re-simulates at full accuracy
  env3: () => (is3d() ? env3() : undefined),
  spec: () => spec,
  // a result found with "parts can't break": show the shot under the same criterion (and the swept arm section)
  applyArm: (arm, mode) => {
    if (arm) spec.arm = arm;
    $<HTMLSelectElement>('break').value = mode;
  },
  apply3d: (v) => {
    if (v.pinOffset !== undefined) $<HTMLInputElement>('pin').value = String(Math.round(v.pinOffset * 100));
    if (v.aimDeg !== undefined) $<HTMLInputElement>('aim').value = String(+v.aimDeg.toFixed(2));
  },
});

function buildForm() {
  kindSel.dataset.prev = kindSel.value; // what the next type switch is switching from
  $('preset-panel').hidden = isFree();
  $('free-panel').hidden = !isFree();
  if (isFree()) {
    $('info-title').textContent = kindSel.selectedOptions[0].text;
    $('info').textContent = 'Monte seu próprio mecanismo com barras, massas e juntas. Escolha uma ferramenta e passe o mouse sobre ela para ver como usá-la.';
    return;
  }
  const k = KINDS[kindSel.value as Kind];
  optimizer.refresh();
  $('info').textContent = k.info + ' Arraste os pontos marcados no desenho para mudar a geometria.';
  $('info-title').textContent = kindSel.selectedOptions[0].text;
  form.innerHTML = k.fields
    .map((f) => {
      const [min, max, step] = RANGES[f];
      return `<label title="${HINTS[f]}" data-f="${f}"><span>${LABELS[f]}</span>
        <input type="number" aria-label="${LABELS[f]}" data-num="${f}" step="any" value="${params[f]}">
        <input type="range" aria-label="${LABELS[f]}" name="${f}" min="${min}" max="${max}" step="${step}" value="${params[f]}"></label>`;
    })
    .join('');
}

function bounds(): Bounds {
  if (isFree()) return editor.bounds();
  const reach = params.longArm + params.slingLength;
  const R = reach + Math.min(1, 0.3 * reach); // margin scales down for small machines
  const h = kindSel.value === 'walking' ? params.longArm : params.pivotHeight; // walking arm: axle height follows the arm
  return { x0: -R, x1: R, y0: -Math.min(0.5, 0.1 * reach), y1: h + R };
}

function mechanismOrError(): Mechanism | undefined {
  $('err').textContent = '';
  try {
    return isFree() ? compile(editor.get()) : build(kindSel.value as Kind, params);
  } catch (e) {
    $('err').textContent = (e as Error).message;
  }
}

// kJ for full-size machines, J for tabletop ones
const joules = (j: number) => (Math.abs(j) < 1000 ? `${j.toFixed(1)} J` : `${(j / 1000).toFixed(2)} kJ`);

function stats(r: Result, m: Mechanism, lateral?: number, broke?: boolean) {
  const items: [string, string][] = [
    ['Alcance', broke ? '0 m<small>quebrou</small>' : `${r.range.toFixed(1)} m`],
    ...(lateral === undefined ? [] : [['Desvio lateral', `${lateral.toFixed(2)} m`] as [string, string]]),
    ['Eficiência', r.inputEnergy > 0 ? `${(r.efficiency * 100).toFixed(1)} %` : '—'],
    ['Velocidade de saída', `${r.release?.speed.toFixed(1) ?? '—'} m/s`],
    ['Ângulo / altura de saída', r.release ? `${((r.release.angle * 180) / Math.PI).toFixed(0)}° / ${r.release.p[1].toFixed(1)} m` : '—'],
    ['Pico de força no eixo', `${(r.peakForce[m.axle] / 1000).toFixed(1)} kN`],
    ['Pico de tração na funda', `${(r.peakForce[m.sling] / 1000).toFixed(2)} kN`],
    ...(r.peakBending ? [['Pico de flexão no braço', `${r.peakBending.moment < 1000 ? `${r.peakBending.moment.toFixed(1)} N·m` : `${(r.peakBending.moment / 1000).toFixed(1)} kN·m`}<small>${r.peakBending.fromAxle < 0.02 ? 'no eixo' : `a ${r.peakBending.fromAxle.toFixed(2)} m do eixo, braço ${r.peakBending.long ? 'longo' : 'curto'}`}</small>`] as [string, string]] : []),
    ['Perdas (atrito, ar, impactos)', joules(r.dissipated)],
  ];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
}

const PART_NAME: Record<string, string> = { arm: 'Braço', axle: 'Eixo', frame: 'Pórtico', hanger: 'Haste do contrapeso', sling: 'Funda', string: 'Corda', cam: 'Corda do contrapeso', leg: 'Perna' };
// every checked part: its critical check and safety factor under both criteria, side by side
function structureTable(a: Checks | undefined) {
  if (!a) return '';
  const rup = byPart(a.rupture), des = byPart(a.design), mode = breakMode();
  const fs = (c: Check | undefined, on: boolean) => `<td class="n${c && c.u > 1 ? ' fail' : ''}${on ? ' on' : ''}">${c ? (1 / c.u).toFixed(2).replace('.', ',') : '—'}</td>`;
  const rows = [...rup.keys()].map((id) => `<tr><td>${PART_NAME[id] ?? id}</td><td>${esc(rup.get(id)!.label.replace(/^[^:]+: /, ''))}</td>${fs(rup.get(id), mode === 'rupture')}${fs(des.get(id), mode === 'design')}</tr>`);
  return `<h2>Estrutura: fator de segurança</h2>
    <table class="fs"><thead><tr><th>Peça</th><th>Verificação crítica (ruptura)</th><th>Ruptura</th><th>Projeto (NBR)</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="muted">FS = resistência ÷ esforço; abaixo de 1, a peça quebra nesse critério${mode ? ` (ativo: ${MODE_LABEL[mode].toLowerCase()})` : '. Ligue a quebra ao lado de Disparar para o disparo parar quando quebrar'}. Pórtico e haste só entram com material e seção escolhidos na ficha. Detalhes na ficha de cada peça.</p>`;
}

function physicsPanel(r: Result, m: Mechanism, checks?: Checks) {
  if (!r.release || r.inputEnergy <= 0) return void ($('physics').innerHTML = structureTable(checks));
  const kj = joules;
  const mp = m.bodies[m.projectile].mass;
  const source = [m.counterweight !== undefined && 'queda do contrapeso M·g·Δh', m.pulls?.length && 'trabalho da equipe F·s', m.springs?.length && 'energia das molas ½k·x²'].filter(Boolean).join(' + ');
  const ideal = (2 * r.inputEnergy) / (mp * G);
  const ratios: string[] = [];
  if (m.counterweight !== undefined) ratios.push(`razão de massas M/m = <b>${(m.bodies[m.counterweight].mass / mp).toFixed(0)}</b>`);
  if (!isFree()) ratios.push(`razão de braços L₁/L₂ = <b>${(params.longArm / params.shortArm).toFixed(2)}</b>`);
  $('physics').innerHTML = `
    <h2>Para onde foi a energia</h2>
    <ul>
      <li>Entrada (${source}): <b>${kj(r.inputEnergy)}</b></li>
      <li>Projétil na soltura (½mv² + mgh): <b>${kj(r.efficiency * r.inputEnergy)}</b> → eficiência η = <b>${(r.efficiency * 100).toFixed(1)}%</b></li>
      <li>Perdas por atrito, ar e impactos (trancos da funda, peças que se chocam): <b>${kj(r.dissipated)}</b>. O resto ficou nas outras peças em movimento.</li>
      ${ratios.length ? `<li>${ratios.join(', ')}</li>` : ''}
      <li>Alcance ideal (η = 100%, sem ar, do chão a 45°): R = 2E/(m·g) = <b>${ideal.toFixed(0)} m</b>. O real é <b>${r.range.toFixed(0)} m</b> (${((100 * r.range) / ideal).toFixed(0)}% do ideal).</li>
    </ul>${structureTable(checks)}`;
}

const PALETTE = ['--series-1', '--series-2', '--series-3'];
function chartSpecs(r: Result, m: Mechanism): ChartSpec[] {
  const end = r.release ? r.release.t + 0.4 : Infinity;
  const fr = r.frames.filter((f) => f.t <= end);
  const t = fr.map((f) => f.t);
  const bodies = [m.projectile, ...(m.counterweight !== undefined ? [m.counterweight] : [])];
  const rod = m.bodies.findIndex((b, i) => b.shape.kind === 'rod' && !bodies.includes(i));
  if (rod >= 0) bodies.push(rod);
  const forces: [string, number][] = [['eixo', m.axle], ['funda', m.sling]];
  return [
    { title: 'Energia cinética', unit: 'kJ', t, marker: r.release?.t,
      series: bodies.map((b, i) => ({ label: m.bodies[b].name, color: css(PALETTE[i]), values: fr.map((f) => f.kes[b] / 1000) })) },
    { title: 'Velocidade do projétil', unit: 'm/s', t, marker: r.release?.t,
      series: [{ label: 'projétil', color: css(PALETTE[0]), values: fr.map((f) => f.speed) }] },
    { title: 'Forças de reação', unit: 'kN', t, marker: r.release?.t,
      series: forces.map(([label, j], i) => ({ label, color: css(PALETTE[i]), values: fr.map((f) => (f.forces[j] ?? 0) / 1000) })) },
  ];
}

// text alternative to the canvas charts: one row per ~40 samples, one column per series
function dataTable(specs: ChartSpec[]) {
  const host = $('data-table');
  const t = specs[0].t;
  const step = Math.max(1, Math.ceil(t.length / 40));
  const cols = specs.flatMap((sp) => sp.series.map((se) => ({ head: `${sp.title}: ${se.label} (${sp.unit})`, v: se.values, sp })));
  const rows = t.map((_, i) => i).filter((i) => i % step === 0 || i === t.length - 1);
  host.querySelector('.scroll')!.innerHTML = `<table><thead><tr><th scope="col">t (s)</th>${cols.map((c) => `<th scope="col">${c.head}</th>`).join('')}</tr></thead><tbody>${rows
    .map((i) => `<tr><th scope="row">${t[i].toFixed(3)}</th>${cols.map((c) => `<td>${+c.v[i].toPrecision(4)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
  host.hidden = false;
}

const chartEls = ['chart-energy', 'chart-speed', 'chart-force'].map((id) => $<HTMLCanvasElement>(id));
let raf = 0;
// 3D view: the shot comes from the 3D solver (m3, r3); r is its planar shadow for the stats and charts
let current: { m: Mechanism; r: Result; b: Bounds; specs: ChartSpec[]; m3?: Mechanism3; r3?: Result3; sketch?: string; checks?: Checks; fail?: Broken } | undefined;
// the part that broke in the shot on screen: red from t on (a ring where a bar cracked)
type Broken = { check: Check & { fail: NonNullable<Check['fail']> }; t: number; body?: number; x?: number };
const breakMode = () => ($<HTMLSelectElement>('break').value || undefined) as Mode | undefined;
const brokenAt = (t: number) => (current?.fail && t >= current.fail.t - 1e-9 ? { keys: new Set([current.fail.check.key]), body: current.fail.body, x: current.fail.x } : undefined);
let lastT = 0;

const is3d = () => !!view3d && !machine3d.hidden;
// free sketches keep their depths (compile3); presets are lifted from their planar build
const env3 = () => ({ windZ: +$<HTMLInputElement>('wind').value || 0, pinOffset: (+$<HTMLInputElement>('pin').value || 0) / 100, aimDeg: +$<HTMLInputElement>('aim').value || 0 });
const mechanism3 = (m: Mechanism) => apply3d(isFree() ? compile3(editor.get()) : lift(m), env3());
const still3 = (m3: Mechanism3): Result3 => ({
  frames: [{ t: 0, ...initialState3(m3), ke: 0, pe: 0, kes: [], forces: [], speed: 0 }],
  flight: [], range: 0, lateral: 0, efficiency: 0, inputEnergy: 0, peakForce: [], dissipated: 0,
});
const planar = ({ loads: _, ...r }: Result3): Result => ({
  ...r,
  release: r.release && { ...r.release, p: [r.release.p[0], r.release.p[1]], v: [r.release.v[0], r.release.v[1]] },
  flight: r.flight.map((p) => [p[0], p[1]]),
});
const stillResult = (m: Mechanism): Result => ({
  frames: [{ t: 0, q: initialState(m).q, ke: 0, pe: 0, kes: [], forces: [], speed: 0 }],
  flight: [], range: 0, efficiency: 0, inputEnergy: 0, peakForce: [], dissipated: 0,
});

// 2D ↔ 3D: three.js loads on first use, so the 2D page doesn't pay for it
let view3d: View3d | undefined;
$('view3d').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  if (!view3d) {
    view3d = (await import('./render3d')).createView3d(machine3d);
    view3d.setPartListener((key) => {
      if (isFree()) return editor.select(key && mechToSketch(editor.get(), key)); // the editor reports back (onSelect)
      const m = mechanismOrError();
      selPart = key && m ? presetOwner(m).get(key) : undefined;
      renderInspector(true);
    });
  }
  btn.setAttribute('aria-pressed', String(on));
  machine.hidden = on;
  machine3d.hidden = $('opts3d').hidden = !on;
  if (!isFree()) optimizer.refresh(); // the 3D pin becomes (or stops being) an optimization variable
  if (current && machine.dataset.mode === 'play') run(); // re-simulate with the other solver
  else preview();
});
for (const id of ['wind', 'pin', 'aim']) $(id).addEventListener('change', () => (current && machine.dataset.mode === 'play' ? run() : preview()));
$('edit3d').addEventListener('click', () => preview());
// phones: each group of 3D controls folds behind its own button (CSS shows the buttons only on narrow screens)
document.querySelectorAll<HTMLButtonElement>('.g3-toggle').forEach((b) =>
  b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    $(b.getAttribute('aria-controls')!).classList.toggle('open', open);
  }),
);

// building in 3D (free editor): the 2D tools on a work plane z; two-click tools keep their first point
let tool3: Tool3 | 'move' = 'move';
let first3: [number, number, number] | undefined;
function setTool3(t: Tool3 | 'move') {
  tool3 = t;
  first3 = undefined;
  view3d?.setMarker(undefined);
  $('tools3d').querySelectorAll<HTMLButtonElement>('[data-t3]').forEach((b) => b.classList.toggle('on', b.dataset.t3 === t));
  const span = bounds().x1 - bounds().x0;
  view3d?.setPick(t === 'move' ? undefined : onPick3, +$<HTMLInputElement>('z3d').value || 0, span);
  $('node3d').textContent = t === 'move' ? '' : t === 'rod' || t === 'rope' ? 'Clique no primeiro ponto.' : 'Clique no plano laranja.';
}
function onPick3(p: [number, number, number]) {
  if (tool3 === 'move') return;
  if ((tool3 === 'rod' || tool3 === 'rope') && !first3) {
    first3 = p;
    view3d?.setMarker(p, 0.01 * (bounds().x1 - bounds().x0));
    return void ($('node3d').textContent = 'Clique no segundo ponto.');
  }
  const sk = editor.get();
  const err = apply3(sk, tool3, p, first3);
  first3 = undefined;
  view3d?.setMarker(undefined);
  if (err) return void ($('node3d').textContent = err);
  editor.set(sk); // indices may have changed (delete): reset the 2D editor's selection
  saveCurrent(design());
  preview();
  $('node3d').textContent = 'Feito. ' + (tool3 === 'rod' || tool3 === 'rope' ? 'Clique no primeiro ponto da próxima.' : 'Clique de novo para outra.');
}
$('tools3d').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-t3]')?.dataset.t3;
  if (t) setTool3(t as Tool3 | 'move');
});
$('z3d').addEventListener('change', () => tool3 !== 'move' && setTool3(tool3));
for (const fmt of ['glb', 'stl'] as const)
  $(`${fmt}3d`).addEventListener('click', async () => {
    const blob = await view3d?.exportModel(fmt);
    if (!blob) return;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${$<HTMLInputElement>('name').value || 'trebuchet'}.${fmt}` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });


function drawAt(t: number) {
  if (!current) return;
  lastT = t;
  const { m, r, b, specs, m3, r3 } = current;
  machine.dataset.mode = 'play';
  if (view3d && m3 && r3) view3d.draw(m3, r3, t, b);
  else playView = drawMachine(machine, m, r, t, b, hlKeys, brokenAt(t));
  drawFlight($('flight'), r, t, b.x0);
  specs.forEach((s, i) => drawChart(chartEls[i], s, Math.min(t, s.t.at(-1)!)));
}

function design(): Design {
  const d: Design = { version: 1, name: $<HTMLInputElement>('name').value || 'Sem nome', kind: kindSel.value as Kind | 'free', params: { ...params } };
  if (isFree()) d.sketch = editor.get();
  else {
    if (Object.keys(spec).length) d.spec = spec;
    if (breakMode()) d.breakMode = breakMode();
  }
  return d;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// --- part card (BIM-style inspector): click a part in either view; its dimensions, material and checks ---
let spec: Spec = {}; // presets: material / section per part id (saved with the design)
let selPart: string | undefined; // preset: part id; free design: sketch key b:i / j:i
let hlKeys = new Set<string>(); // mechanism keys of the selected part, highlighted in both views
let playView: View | undefined; // the 2D view of the shot on screen: a click picks the part where it is drawn now
let cardParts: Part[] = [];

// a sketch's geometry and masses, without names and materials: what the shot's forces depend on
const shape = (sk: Sketch) => JSON.stringify(sk, (k, v) => (k === 'spec' || k === 'name' ? undefined : v));
function partsNow(): Part[] {
  const r = current?.r; // checks use the last shot (presets re-shoot on every edit)
  if (isFree()) {
    const sk = editor.get();
    let m: Mechanism | undefined;
    try { m = compile(sk); } catch { /* still being built: dimensions only */ }
    const fresh = current?.sketch === shape(sk); // an edited sketch: its old forces may belong to other joints
    return sketchParts({ sk, m, r: fresh ? r : undefined }).map((p) => (fresh || !r ? p : { ...p, note: 'Dispare de novo para ver as verificações com o esboço atual.' }));
  }
  try {
    return presetParts({ kind: kindSel.value as Kind, p: params, spec, m: build(kindSel.value as Kind, params), r, a: current?.checks });
  } catch {
    return [];
  }
}

function renderInspector(scroll = false) {
  const box = $('inspector');
  cardParts = selPart ? partsNow() : [];
  const part = cardParts.find((p) => p.id === selPart);
  const keys = part?.keys ?? [];
  const changed = keys.join() !== [...hlKeys].join();
  hlKeys = new Set(keys);
  view3d?.highlight(keys);
  if (changed && !isFree() && !is3d()) machine.dataset.mode === 'play' && current ? drawAt(lastT) : preview(); // repaint the 2D drawing
  if (!part) return void ((box.hidden = true), (box.innerHTML = ''));
  const input = (row: Part['rows'][number], i: number) => {
    const inp = row.input!;
    if (inp.kind === 'select') return `<select data-i="${i}" aria-label="${esc(row.label)}">${inp.options.map(([v, l]) => `<option value="${esc(v)}"${v === inp.value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (inp.kind === 'text') return `<input type="text" data-i="${i}" aria-label="${esc(row.label)}" value="${esc(inp.value)}">`;
    const field = `<input type="number" data-i="${i}" aria-label="${esc(row.label)}" step="${inp.step ?? 'any'}"${inp.min !== undefined ? ` min="${inp.min}"` : ''}${inp.max !== undefined ? ` max="${inp.max}"` : ''} value="${+inp.value.toPrecision(6)}">`;
    return inp.unit ? `<span class="unit">${field}<span>${esc(inp.unit)}</span></span>` : field;
  };
  const focused = box.contains(document.activeElement) ? (document.activeElement as HTMLElement).id || (document.activeElement as HTMLElement).dataset.i : undefined;
  box.innerHTML = `<header>
      <select id="part-pick" aria-label="Peça">${cardParts.map((p) => `<option value="${esc(p.id)}"${p.id === part.id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select>
      <button type="button" class="ghost" data-act="close" aria-label="Fechar a ficha">✕</button>
    </header>
    ${part.rows.map((row, i) => `<div class="r${row.status ? ` ${row.status}` : ''}"><span${row.hint ? ` title="${esc(row.hint)}"` : ''}>${esc(row.label)}</span>${row.input ? input(row, i) : `<b>${esc(row.value ?? '')}</b>`}${row.note ? `<small>${esc(row.note)}</small>` : ''}</div>`).join('')}
    ${part.note ? `<p class="note">${esc(part.note)}</p>` : ''}`;
  box.hidden = false;
  if (focused) box.querySelector<HTMLElement>(focused === 'part-pick' ? '#part-pick' : `[data-i="${focused}"]`)?.focus();
  if (scroll && matchMedia('(max-width: 800px)').matches) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

$('inspector').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.id === 'part-pick') {
    if (isFree()) return editor.select(el.value);
    return void ((selPart = el.value), renderInspector());
  }
  const part = cardParts.find((p) => p.id === selPart);
  const inp = part?.rows[Number(el.dataset.i)]?.input;
  if (!inp) return;
  const apply = () => (inp.kind === 'number' ? Number.isFinite(+el.value) && el.value !== '' && inp.set(+el.value) : inp.set(el.value));
  if (isFree()) {
    editor.mutate(apply); // undoable; the editor redraws and reports back
    if (is3d()) preview();
    return;
  }
  apply();
  syncForm();
  run(); // re-shoot: new geometry, new checks
});
function closeCard() {
  if (isFree()) editor.select(undefined);
  else (selPart = undefined), renderInspector();
  $('parts-btn').focus(); // back where keyboard users open it
}
$('inspector').addEventListener('click', (e) => (e.target as HTMLElement).dataset.act === 'close' && closeCard());
$('inspector').addEventListener('keydown', (e) => e.key === 'Escape' && closeCard());
// keyboard (and a way to reach parts with no drawing of their own): open the card on the first part, or move to it
$('parts-btn').addEventListener('click', () => {
  if (selPart) return $('part-pick')?.focus();
  const first = partsNow()[0]?.id;
  if (!first) return;
  if (isFree()) editor.select(first);
  else (selPart = first), renderInspector();
  $('part-pick')?.focus();
});

// --- preset handles (drag points on the canvas) ---
type Handle = { label: string; pos: Vec; apply: (p: Vec) => void };
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v: number, f: keyof Params) => Math.min(RANGES[f][1], Math.max(RANGES[f][0], +v.toFixed(2)));
let handleView: View | undefined;

// The walking arm is drawn already tipped by the firing nudge, so its handles sit on the real pose and every
// handle sets a length or an angle measured from the axle (both survive the tip): no rest-pose geometry needed.
function walkingHandles(m: Mechanism): Handle[] {
  const q = initialState(m).q;
  const axle = m.joints.find((j) => j.kind === 'pin' && j.b !== 'ground');
  const finger = m.joints.find((j) => j.kind === 'foot');
  const spikes = m.joints.find((j) => j.kind === 'spike');
  if (axle?.kind !== 'pin' || finger?.kind !== 'foot' || spikes?.kind !== 'spike' || m.counterweight === undefined) return [];
  const pivot = world(q, axle.a, axle.pa);
  const tip = world(q, finger.a, finger.pa);
  const legEnd = world(q, spikes.a, spikes.pa);
  const deg = (u: Vec, w: Vec) => (Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]) * 180) / Math.PI;
  const rel = (p: Vec): Vec => [p[0] - pivot[0], p[1] - pivot[1]];
  return [
    { label: 'braço longo', pos: tip, apply: (p) => (params.longArm = clamp(dist(p, pivot), 'longArm')) },
    { label: 'braço curto', pos: [q[3 * m.counterweight], q[3 * m.counterweight + 1]], apply: (p) => (params.shortArm = clamp(dist(p, pivot), 'shortArm')) },
    // leg: its length, and its angle off the long arm (the tuning string's setting)
    { label: 'perna', pos: legEnd, apply: (p) => ((params.legLength = clamp(dist(p, pivot), 'legLength')), (params.cockDeg = clamp(deg(rel(tip), rel(p)), 'cockDeg'))) },
    { label: 'funda', pos: m.bodies[m.projectile].pos, apply: (p) => (params.slingLength = clamp(dist(p, tip), 'slingLength')) },
  ];
}

function handles(m: Mechanism): Handle[] {
  if (kindSel.value === 'walking') return walkingHandles(m);
  const g = geometry(params, kindSel.value as Kind);
  const h: Handle[] = [
    { label: 'eixo', pos: g.pivot, apply: (p) => (params.pivotHeight = clamp(p[1], 'pivotHeight')) },
    { label: 'braço longo', pos: g.tip, apply: (p) => (params.longArm = clamp(dist(p, g.pivot), 'longArm')) },
    { label: 'braço curto', pos: g.shortTip, apply: (p) => (params.shortArm = clamp(dist(p, g.pivot), 'shortArm')) },
    { label: 'funda', pos: m.bodies[m.projectile].pos, apply: (p) => (params.slingLength = clamp(dist(p, g.tip), 'slingLength')) },
  ];
  if (['hinged', 'whipper', 'ka', 'faka'].includes(kindSel.value) && m.counterweight !== undefined)
    h.push({ label: 'articulação', pos: m.bodies[m.counterweight].pos, apply: (p) => (params.hingeLength = clamp(dist(p, g.shortTip), 'hingeLength')) });
  return h;
}

// static cocked pose (no simulation): free mode shows the editor, presets show draggable handles
function preview() {
  cancelAnimationFrame(raf);
  if (view3d && is3d()) return preview3d(view3d);
  if (isFree()) {
    machine.dataset.mode = 'edit';
    return editor.draw();
  }
  const m = mechanismOrError();
  if (!m) return;
  machine.dataset.mode = 'handles';
  handleView = drawMachine(machine, m, stillResult(m), 0, bounds(), hlKeys);
  const g = machine.getContext('2d')!; // same transform drawMachine just set
  g.font = '11px system-ui, sans-serif';
  for (const hd of handles(m)) {
    const [x, y] = handleView.P(hd.pos);
    g.strokeStyle = css('--accent');
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 8, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = css('--muted');
    g.fillText(hd.label, x + 11, y - 9);
  }
}

let dragHandle: Handle | undefined;
machine.addEventListener('pointerdown', (e) => {
  if (isFree()) {
    if (machine.dataset.mode !== 'edit') preview(); // click on a finished shot → back to editing
    return;
  }
  const m = mechanismOrError();
  if (!m) return;
  const rect = machine.getBoundingClientRect();
  const pt: Vec = [e.clientX - rect.left, e.clientY - rect.top];
  if (machine.dataset.mode === 'play' && current && playView) {
    // a click on a shot: the part where it is drawn at this instant; then back to the cocked pose, part still selected
    const { r } = current;
    const dtF = r.frames.length > 1 ? r.frames[1].t - r.frames[0].t : 1;
    const q = r.frames[Math.min(r.frames.length - 1, Math.round(lastT / dtF))].q;
    const key = partAt(current.m, q, playView.W(...pt), 8 / playView.s, current.b);
    if (key) {
      selPart = presetOwner(m).get(key);
      preview();
      return renderInspector(true);
    }
  }
  if (machine.dataset.mode !== 'handles') preview();
  dragHandle = handles(m).find((h) => dist(handleView!.P(h.pos), pt) < 12);
  if (dragHandle) return void machine.setPointerCapture(e.pointerId);
  const key = partAt(m, initialState(m).q, handleView!.W(...pt), 8 / handleView!.s, bounds());
  selPart = key && presetOwner(m).get(key);
  renderInspector(true);
});
machine.addEventListener('pointermove', (e) => {
  if (!dragHandle || !handleView) return;
  const rect = machine.getBoundingClientRect();
  dragHandle.apply(handleView.W(e.clientX - rect.left, e.clientY - rect.top));
  syncForm();
  preview();
  const m = mechanismOrError();
  if (m) dragHandle = handles(m).find((h) => h.label === dragHandle!.label); // geometry moved: refresh the handle's anchor
});
machine.addEventListener('pointerup', () => {
  if (dragHandle) (dragHandle = undefined), run();
});

function syncForm() {
  form.querySelectorAll<HTMLInputElement>('input').forEach((el) => {
    const f = (el.name || el.dataset.num) as keyof Params;
    if (document.activeElement !== el) el.value = String(params[f]);
  });
}

// 3D still pose with draggable nodes: preset handles move in their plane (xy) and the sling pin across it (z);
// free-sketch points move in x, y and z
function preview3d(v: View3d) {
  machine.dataset.mode = isFree() ? 'edit' : 'handles';
  const m = mechanismOrError();
  let m3: Mechanism3 | undefined;
  try {
    m3 = m && mechanism3(m);
  } catch (e) {
    $('err').textContent = (e as Error).message;
  }
  $('tools3d').hidden = !isFree();
  if (!isFree() && tool3 !== 'move') setTool3('move'); // building tools belong to the free editor
  if ((!m || !m3) && !isFree()) return v.setHandles(undefined);
  if (m3) v.draw(m3, still3(m3), 0, bounds());
  else v.drawSketch(editor.get(), bounds()); // still being built: show the parts as drawn
  const status = (label?: string) => ($('node3d').textContent = label ? `Nó: ${label}. Arraste as setas (ou use as do teclado; Enter confirma).` : 'Clique num ponto laranja para movê-lo (teclado: N escolhe um nó).');
  if (isFree()) {
    const sk = editor.get();
    const nodes = nodes3(sk);
    return v.setHandles(nodes.map((n) => ({ p: n.p, axes: 'xyz', label: n.label })), {
      move: (i, p) => (moveNode(sk, nodes[i], p), preview()),
      end: () => saveCurrent(design()),
      select: status,
    });
  }
  if (!m || !m3) return;
  const hs = handles(m);
  const sling = m3.joints[m3.sling];
  const pinWorld = sling.kind === 'rope' && (sling.a === m3.projectile ? sling.b : sling.a) !== 'ground'
    ? (() => {
        const [b, p] = sling.a === m3.projectile ? [sling.b as number, sling.pb] : [sling.a, sling.pa];
        return add(m3.bodies[b].pos, rotate(m3.bodies[b].quat, 0, p));
      })()
    : undefined;
  // the pin sits at the long arm's tip: one node there, xy = arm geometry, z = pin offset across the arm
  const pinAt = pinWorld ? hs.findIndex((h) => Math.hypot(h.pos[0] - pinWorld[0], h.pos[1] - pinWorld[1]) < 1e-6) : -1;
  const list = hs.map((h, i) => ({ p: [h.pos[0], h.pos[1], i === pinAt ? pinWorld![2] : 0] as [number, number, number], axes: i === pinAt ? 'xyz' : 'xy', label: i === pinAt ? `${h.label} + pino da funda (z)` : h.label }));
  if (pinWorld && pinAt < 0) list.push({ p: pinWorld, axes: 'z', label: 'pino da funda (desvio lateral)' });
  v.setHandles(list, {
    move: (i, p) => {
      if (i < hs.length) hs[i].apply([p[0], p[1]]), syncForm();
      if (i === pinAt || i >= hs.length) $<HTMLInputElement>('pin').value = String(Math.max(-50, Math.min(50, Math.round(p[2] * 100)))); // same limits as the field
      preview();
    },
    end: run,
    select: status,
  });
}

function run() {
  cancelAnimationFrame(raf);
  view3d?.setHandles(undefined);
  view3d?.setScatter(undefined);
  const m = mechanismOrError();
  if (!m || (isFree() && !editor.validate())) {
    $('stats').innerHTML = $('physics').innerHTML = '';
    $('data-table').hidden = true; // don't leave a previous shot's numbers next to an invalid design
    return;
  }
  saveCurrent(design());
  const id = ++runId;
  if (!is3d()) return show(m, simulate(m, { afterRelease: 1.5, loadEvery: 2 }));
  // the 3D view checks the structure with the planar shot's joint forces and the 3D solver's rod loads (they match in the
  // plane; the 3D ones add the sideways bending from a pin offset or crosswind). Sample k of both runs is the same step.
  const loads = isFree() ? undefined : simulate(m, { afterRelease: 0, frameEvery: 1e9, loadEvery: 2 }).loads;
  let m3: Mechanism3;
  try {
    m3 = mechanism3(m);
  } catch (e) {
    return void ($('err').textContent = (e as Error).message);
  }
  $('node3d').textContent = 'Simulando em 3D…';
  sim3(m3).then((r3) => {
    if (id !== runId) return; // a newer shot was asked for meanwhile
    $('node3d').textContent = '';
    show(m, { ...planar(r3), loads: loads?.map((S, k) => (r3.loads?.[k] ? { ...S, rods: r3.loads[k].rods } : S)) }, m3, r3);
  });
}

// One 3D shot at a time in a worker; asking for another while one runs drops the old one (its worker is terminated).
let runId = 0;
let simWorker: Worker | undefined;
let simBusy = false;
function sim3(m3: Mechanism3): Promise<Result3> {
  if (simBusy) simWorker?.terminate(), (simWorker = undefined);
  const w = (simWorker ??= new Worker(new URL('./sim3.worker.ts', import.meta.url), { type: 'module' }));
  simBusy = true;
  return new Promise((resolve) => {
    w.onmessage = (e: MessageEvent<Result3>) => ((simBusy = false), resolve(e.data));
    w.onerror = (e) => ((simBusy = false), ($('err').textContent = `Erro no solver 3D: ${e.message}`));
    w.postMessage({ m3, opts: { afterRelease: 1.5, loadEvery: 2 } });
  });
}

// Many quick 3D shots split over a pool of workers (landing points only); the pool is dropped afterwards.
function simBatch(m3s: Mechanism3[]): Promise<Result3[]> {
  const n = Math.min(m3s.length, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
  const out: Result3[] = [];
  let next = 0;
  return new Promise((resolve) => {
    let left = m3s.length;
    for (let k = 0; k < n; k++) {
      const w = new Worker(new URL('./sim3.worker.ts', import.meta.url), { type: 'module' });
      const feed = () => {
        if (next >= m3s.length) return w.terminate();
        const i = next++;
        w.onmessage = (e: MessageEvent<Result3>) => ((out[i] = e.data), --left ? feed() : (w.terminate(), resolve(out)));
        w.postMessage({ m3: m3s[i], opts: { afterRelease: 0, frameEvery: 1e9 } });
      };
      feed();
    }
  });
}

// Dispersion: the same machine fired SHOTS times with small random changes; where it lands, and the 1σ/2σ ellipses.
const SHOTS = 40;
const JITTER = { releaseDeg: 1, gust: 1.5, pin: 0.01 }; // σ: release timing (°), wind gusts (m/s, both axes), pin play (m)
$('disp3d').addEventListener('click', async () => {
  const m = mechanismOrError();
  if (!m || !view3d) return;
  view3d.setScatter(undefined);
  const g = gaussian(seeded(1)); // the same 40 perturbations every time: changes in the result come from the design
  const e = env3();
  let m3s: Mechanism3[];
  try {
    m3s = Array.from({ length: SHOTS }, () => {
      const m3 = apply3d(isFree() ? compile3(editor.get()) : lift(m), { ...e, windZ: e.windZ + JITTER.gust * g(), windX: JITTER.gust * g(), pinOffset: e.pinOffset + JITTER.pin * g() });
      m3.releaseAngle += (JITTER.releaseDeg * g() * Math.PI) / 180;
      return m3;
    });
  } catch (err) {
    return void ($('err').textContent = (err as Error).message);
  }
  const btn = $<HTMLButtonElement>('disp3d');
  btn.disabled = true;
  $('node3d').textContent = `Dispersão: ${SHOTS} tiros…`;
  const rs = await simBatch(m3s);
  btn.disabled = false;
  const ok = rs.filter((r) => !r.error && r.release);
  if (ok.length < 3) return void ($('node3d').textContent = 'Dispersão: tiros demais falharam com essas variações.');
  const pts = ok.map((r): [number, number] => [r.range, r.lateral]);
  const s = scatterStats(pts);
  view3d.setScatter(pts, s);
  $('node3d').textContent = `Dispersão (${ok.length}/${SHOTS} tiros): alcance ${s.mean[0].toFixed(1)} ± ${s.sd[0].toFixed(1)} m, lateral ${s.mean[1].toFixed(1)} ± ${s.sd[1].toFixed(1)} m; elipse 2σ ${(4 * s.axes[0]).toFixed(1)} × ${(4 * s.axes[1]).toFixed(1)} m.`;
});

function show(m: Mechanism, r: Result, m3?: Mechanism3, r3?: Result3) {
  if (r.error) $('err').textContent = r.error;
  const checks = isFree() ? undefined : checksFor(m, r, spec);
  const mode = breakMode(), f = mode ? checks?.[mode].failure : undefined;
  const fail: Broken | undefined = f && { check: f, t: f.fail.t, ...(f.key.startsWith('b:') ? { body: +f.key.slice(2), x: f.fail.x } : {}) };
  stats(r, m, r3?.lateral, !!fail);
  physicsPanel(r, m, checks);
  const broke = $('broke');
  broke.hidden = !fail;
  broke.textContent = fail ? `Falha estrutural, critério de ${mode === 'rupture' ? 'ruptura' : 'projeto (NBR)'}: ${fail.check.label.toLowerCase()} em t = ${fail.t.toFixed(3).replace('.', ',')} s. ${fail.check.fail.detail}. O disparo para aqui; reforce a peça na ficha (clique nela).` : '';
  current = { m, r, b: bounds(), specs: chartSpecs(r, m), m3, r3, sketch: isFree() ? shape(editor.get()) : undefined, checks, fail };
  view3d?.setBroken(fail && { keys: [fail.check.key], t: fail.t, body: fail.body, x: fail.x });
  dataTable(current.specs);
  renderInspector();
  const flightTime = fail ? fail.t : r.release ? r.release.t + (r.flight.length - 1) * 1e-3 : r.frames.at(-1)!.t;
  const speed = Number($<HTMLSelectElement>('speed').value);
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(flightTime, Math.max(0, ((now - start) / 1000) * speed)); // rAF time can precede start
    drawAt(t);
    if (t < flightTime) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// hovering a chart pauses the animation and scrubs the machine to that instant
chartEls.forEach((c, i) => {
  c.addEventListener('mousemove', (e) => {
    if (!current) return;
    cancelAnimationFrame(raf);
    drawAt(timeAt(c, current.specs[i], e.clientX));
  });
});

form.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const f = (el.name || el.dataset.num) as keyof Params;
  const v = Number(el.value);
  if (el.value === '' || !Number.isFinite(v)) return;
  params[f] = v;
  syncForm();
  preview();
});
form.addEventListener('change', run);
form.addEventListener('focusin', (e) => {
  const f = (e.target as HTMLElement).closest('label')?.dataset.f as keyof Params | undefined;
  if (f) $('hint').textContent = HINTS[f];
});
kindSel.addEventListener('change', () => {
  // Between two standard kinds your values carry over (compare types like for like). Into or out of a kind with its
  // own geometry (whipper, walking, MURLIN…) they would break the other machine: load the new kind's values instead.
  const prev = kindSel.dataset.prev as Kind | 'free' | undefined;
  const next = kindSel.value as Kind;
  if (!isFree() && (!prev || prev === 'free' || KINDS[prev].preset || KINDS[next].preset)) Object.assign(params, defaultsFor(next)), (spec = {});
  selPart = undefined;
  if (isFree() && !editor.get()) editor.set(toSketch(build('fixed', defaults), { troughMu: defaults.troughMu }));
  buildForm();
  if (isFree()) preview();
  else run();
});
$('run').addEventListener('click', run);
$('break').addEventListener('change', run);
$('info-btn').addEventListener('click', () => $<HTMLDialogElement>('info-dlg').showModal());
$('to-free').addEventListener('click', () => {
  const m = mechanismOrError();
  if (!m) return;
  const sk = toSketch(m, { troughMu: params.troughMu });
  const arm = (m.joints[m.axle] as { a: number }).a; // bodies keep their order; find the sling rope and the ground axle
  if (spec.arm) sk.bodies[arm].spec = { ...spec.arm };
  const slingJ = sk.joints.find((j) => j.kind === 'rope' && (j.a === m.projectile || j.b === m.projectile));
  if (spec.sling && slingJ) slingJ.spec = { ...spec.sling };
  const axleJ = sk.joints.find((j) => j.kind === 'pin' && j.b === 'ground' && j.a === arm);
  if (spec.axle && axleJ) axleJ.spec = { ...spec.axle };
  editor.set(sk);
  kindSel.value = 'free';
  buildForm();
  preview();
});
$('fit').addEventListener('click', () => (editor.fit(), preview()));
$('new-sketch').addEventListener('click', () => {
  if (confirm('Começar um esboço vazio? O esboço atual se perde se não estiver salvo.')) (editor.set(emptySketch()), preview());
});

// --- designs: localStorage + JSON files ---

function refreshSaved() {
  $('saved').innerHTML = '<option value="">Meus designs…</option>' + listDesigns().map((d) => `<option>${esc(d.name)}</option>`).join('');
}
function load(d: Design) {
  kindSel.value = d.kind;
  Object.assign(params, d.params);
  spec = d.spec ?? {};
  $<HTMLSelectElement>('break').value = d.breakMode ?? '';
  selPart = undefined;
  $<HTMLInputElement>('name').value = d.name;
  if (d.kind === 'free') editor.set(d.sketch ?? emptySketch());
  buildForm();
  run();
}
$('save').addEventListener('click', () => (saveDesign(design()), refreshSaved()));
$('saved').addEventListener('change', (e) => {
  const d = listDesigns().find((x) => x.name === (e.target as HTMLSelectElement).value);
  if (d) load(d);
});
$('delete').addEventListener('click', () => {
  const name = $<HTMLSelectElement>('saved').value;
  if (name && confirm(`Apagar "${name}"?`)) (deleteDesign(name), refreshSaved());
});
$('export').addEventListener('click', () => download(`${design().name}.trebuchet.json`, JSON.stringify(design(), null, 2)));
$('import').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    load(await importFile(file));
  } catch (err) {
    $('err').textContent = (err as Error).message;
  }
});
$('csv').addEventListener('click', () => {
  if (!current) return;
  const { specs } = current;
  const cols = specs.flatMap((s) => s.series.map((x) => `${s.title} ${x.label} (${s.unit})`));
  const rows = specs[0].t.map((t, i) => [t.toFixed(4), ...specs.flatMap((s) => s.series.map((x) => x.values[i].toPrecision(6)))].join(','));
  download(`${design().name}.csv`, ['t (s),' + cols.join(','), ...rows].join('\n'), 'text/csv');
});

$('share').addEventListener('click', async (e) => {
  const url = `${location.href.split(/[#?]/)[0]}#d=${encodeDesign(design())}`;
  const btn = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = url.length > 8000 ? `Link copiado, mas longo (${Math.round(url.length / 1000)} kB): use Exportar JSON se não abrir` : 'Link copiado'; // a big free sketch
    setTimeout(() => (btn.textContent = 'Copiar link'), 2000);
  } catch {
    prompt('Copie o link do design:', url); // no clipboard access (insecure page, blocked)
  }
});

const saved = loadCurrent();
const want = new URLSearchParams(location.search).get('kind') as Kind | null; // deep link from the article: ./?kind=walking
let linked: Design | undefined; // a design shared by link: #d=…
let linkErr = '';
if (location.hash.startsWith('#d=')) {
  try {
    linked = decodeDesign(location.hash.slice(3));
    // opening it replaces the browser's current design: ask first when that one is different
    if (saved && JSON.stringify(saved) !== JSON.stringify(linked) && !confirm(`Este link traz o design "${linked.name}". Abrir substitui o design atual do navegador ("${saved.name}"). Continuar?`)) linked = undefined;
  } catch {
    linkErr = 'O link do design está quebrado ou incompleto.';
  }
  history.replaceState(null, '', location.pathname + location.search); // the fragment goes stale at the first edit
}
if (linked) load(linked);
else if (want && want in KINDS) {
  kindSel.value = want;
  Object.assign(params, defaultsFor(want));
  buildForm();
  run();
} else if (saved) load(saved);
else (buildForm(), run());
if (linkErr) $('err').textContent = linkErr; // after the first run, which clears it
refreshSaved();
