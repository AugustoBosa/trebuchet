import { css, drawChart, sizeCanvases, timeAt, type ChartSpec } from './charts';
import { createEditor } from './editor';
import { HINTS, LABELS, RANGES } from './labels';
import { mountOptimizer } from './optimizer-ui';
import { G, type Mechanism, type Vec } from './physics/model';
import { initialState, simulate, type Result } from './physics/solver';
import { build, defaults, defaultsFor, geometry, KINDS, type Kind, type Params } from './presets';
import { drawFlight, drawMachine, type Bounds, type View } from './render';
import type { View3d } from './render3d';
import { apply3d, lift } from './physics3d/lift';
import type { Mechanism3 } from './physics3d/model3';
import { initialState3, simulate3, type Result3 } from './physics3d/solver3';
import { compile, emptySketch, toSketch } from './sketch';
import { deleteDesign, download, importFile, listDesigns, loadCurrent, saveCurrent, saveDesign, type Design } from './storage';

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
});
const optimizer = mountOptimizer({
  kind: () => kindSel.value as Kind,
  params,
  apply: (p) => (Object.assign(params, p), syncForm(), run()), // run() re-simulates at full accuracy
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

function stats(r: Result, m: Mechanism, lateral?: number) {
  const items: [string, string][] = [
    ['Alcance', `${r.range.toFixed(1)} m`],
    ...(lateral === undefined ? [] : [['Desvio lateral', `${lateral.toFixed(2)} m`] as [string, string]]),
    ['Eficiência', r.inputEnergy > 0 ? `${(r.efficiency * 100).toFixed(1)} %` : '—'],
    ['Velocidade de saída', `${r.release?.speed.toFixed(1) ?? '—'} m/s`],
    ['Ângulo / altura de saída', r.release ? `${((r.release.angle * 180) / Math.PI).toFixed(0)}° / ${r.release.p[1].toFixed(1)} m` : '—'],
    ['Pico de força no eixo', `${(r.peakForce[m.axle] / 1000).toFixed(1)} kN`],
    ['Pico de tração na funda', `${(r.peakForce[m.sling] / 1000).toFixed(2)} kN`],
    ['Perdas (atrito, ar, impactos)', joules(r.dissipated)],
  ];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
}

function physicsPanel(r: Result, m: Mechanism) {
  if (!r.release || r.inputEnergy <= 0) return void ($('physics').innerHTML = '');
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
    </ul>`;
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
let current: { m: Mechanism; r: Result; b: Bounds; specs: ChartSpec[]; m3?: Mechanism3; r3?: Result3 } | undefined;
let lastT = 0;

const is3d = () => !!view3d && !machine3d.hidden;
const mechanism3 = (m: Mechanism) => apply3d(lift(m), { windZ: +$<HTMLInputElement>('wind').value || 0, pinOffset: (+$<HTMLInputElement>('pin').value || 0) / 100 });
const still3 = (m3: Mechanism3): Result3 => ({
  frames: [{ t: 0, ...initialState3(m3), ke: 0, pe: 0, kes: [], forces: [], speed: 0 }],
  flight: [], range: 0, lateral: 0, efficiency: 0, inputEnergy: 0, peakForce: [], dissipated: 0,
});
const planar = (r: Result3): Result => ({
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
  view3d ??= (await import('./render3d')).createView3d(machine3d);
  btn.setAttribute('aria-pressed', String(on));
  machine.hidden = on;
  machine3d.hidden = $('opts3d').hidden = !on;
  if (current && machine.dataset.mode === 'play') run(); // re-simulate with the other solver
  else preview();
});
for (const id of ['wind', 'pin']) $(id).addEventListener('change', () => (current && machine.dataset.mode === 'play' ? run() : preview()));


function drawAt(t: number) {
  if (!current) return;
  lastT = t;
  const { m, r, b, specs, m3, r3 } = current;
  machine.dataset.mode = 'play';
  if (view3d && m3 && r3) view3d.draw(m3, r3, t, b);
  else drawMachine(machine, m, r, t, b);
  drawFlight($('flight'), r, t, b.x0);
  specs.forEach((s, i) => drawChart(chartEls[i], s, Math.min(t, s.t.at(-1)!)));
}

function design(): Design {
  const d: Design = { version: 1, name: $<HTMLInputElement>('name').value || 'Sem nome', kind: kindSel.value as Kind | 'free', params: { ...params } };
  if (isFree()) d.sketch = editor.get();
  return d;
}

// --- preset handles (drag points on the canvas) ---
type Handle = { label: string; pos: Vec; apply: (p: Vec) => void };
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v: number, f: keyof Params) => Math.min(RANGES[f][1], Math.max(RANGES[f][0], +v.toFixed(2)));
let handleView: View | undefined;

function handles(m: Mechanism): Handle[] {
  if (kindSel.value === 'walking') return []; // drawn tipped by the firing nudge: rest-pose handles wouldn't line up
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
  if (view3d && is3d()) { // 3D: still cocked pose, no handles (editing stays in 2D)
    const m = mechanismOrError();
    if (m) {
      const m3 = mechanism3(m);
      view3d.draw(m3, still3(m3), 0, bounds());
    }
    return;
  }
  if (isFree()) {
    machine.dataset.mode = 'edit';
    return editor.draw();
  }
  const m = mechanismOrError();
  if (!m) return;
  machine.dataset.mode = 'handles';
  handleView = drawMachine(machine, m, stillResult(m), 0, bounds());
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
  if (machine.dataset.mode !== 'handles') preview();
  const rect = machine.getBoundingClientRect();
  const pt: Vec = [e.clientX - rect.left, e.clientY - rect.top];
  dragHandle = handles(m).find((h) => dist(handleView!.P(h.pos), pt) < 12);
  if (dragHandle) machine.setPointerCapture(e.pointerId);
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

function run() {
  cancelAnimationFrame(raf);
  const m = mechanismOrError();
  if (!m || (isFree() && !editor.validate())) {
    $('stats').innerHTML = $('physics').innerHTML = '';
    $('data-table').hidden = true; // don't leave a previous shot's numbers next to an invalid design
    return;
  }
  saveCurrent(design());
  const m3 = is3d() ? mechanism3(m) : undefined;
  const r3 = m3 && simulate3(m3, { afterRelease: 1.5 });
  const r = r3 ? planar(r3) : simulate(m, { afterRelease: 1.5 });
  if (r.error) $('err').textContent = r.error;
  stats(r, m, r3?.lateral);
  physicsPanel(r, m);
  current = { m, r, b: bounds(), specs: chartSpecs(r, m), m3, r3 };
  dataTable(current.specs);
  const flightTime = r.release ? r.release.t + (r.flight.length - 1) * 1e-3 : r.frames.at(-1)!.t;
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
  if (!isFree() && (!prev || prev === 'free' || KINDS[prev].preset || KINDS[next].preset)) Object.assign(params, defaultsFor(next));
  if (isFree() && !editor.get()) editor.set(toSketch(build('fixed', defaults), { troughMu: defaults.troughMu }));
  buildForm();
  if (isFree()) preview();
  else run();
});
$('run').addEventListener('click', run);
$('info-btn').addEventListener('click', () => $<HTMLDialogElement>('info-dlg').showModal());
$('to-free').addEventListener('click', () => {
  const m = mechanismOrError();
  if (!m) return;
  // ponytail: no drum/roller/landing-spike tools in the free editor yet; add them if people want to sketch these kinds
  if (m.springs?.length || m.joints.some((j) => j.kind === 'cam' || j.kind === 'roller' || j.kind === 'spike')) return void ($('err').textContent = 'O editor livre ainda não tem as ferramentas de tambor, rolete, mola e espinhos que cravam ao cair: este tipo não pode ser aberto nele.');
  editor.set(toSketch(m, { troughMu: params.troughMu }));
  kindSel.value = 'free';
  buildForm();
  preview();
});
$('fit').addEventListener('click', () => (editor.fit(), preview()));
$('new-sketch').addEventListener('click', () => {
  if (confirm('Começar um esboço vazio? O esboço atual se perde se não estiver salvo.')) (editor.set(emptySketch()), preview());
});

// --- designs: localStorage + JSON files ---
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
function refreshSaved() {
  $('saved').innerHTML = '<option value="">Meus designs…</option>' + listDesigns().map((d) => `<option>${escape(d.name)}</option>`).join('');
}
function load(d: Design) {
  kindSel.value = d.kind;
  Object.assign(params, d.params);
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

const saved = loadCurrent();
const want = new URLSearchParams(location.search).get('kind') as Kind | null; // deep link from the article: ./?kind=walking
if (want && want in KINDS) {
  kindSel.value = want;
  Object.assign(params, defaultsFor(want));
  buildForm();
  run();
} else if (saved) load(saved);
else (buildForm(), run());
refreshSaved();
