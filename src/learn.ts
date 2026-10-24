import katex from 'katex';
import 'katex/dist/katex.min.css';
import { css, drawChart, FONT, drawHeatmap, fitCanvas, heatCell, sizeCanvases, timeAt, type ChartSpec, type HeatSpec } from './charts';
import { HINTS, LABELS, RANGES } from './labels';
import { fly } from './physics/ballistics';
import { G } from './physics/model';
import { simulate } from './physics/solver';
import { evaluate, FAST_DT, linspace } from './optimize';
import { build, defaults, defaultsFor, KINDS, type Kind, type Params } from './presets';
import { drawMachine, view } from './render';
import { apply3d, lift } from './physics3d/lift';
import { simulate3 } from './physics3d/solver3';

// equations: .tex = display, .itex = inline; source is the element's text
document.querySelectorAll<HTMLElement>('.tex, .itex').forEach((el) =>
  katex.render(el.textContent ?? '', el, { displayMode: el.classList.contains('tex'), throwOnError: false }),
);

const fmt = (v: number) => +v.toPrecision(4) + '';

function sliders(host: HTMLElement, fields: (keyof Params)[], p: Params, onChange: () => void) {
  host.innerHTML = fields
    .map((f) => {
      const [min, max, step] = RANGES[f];
      return `<label title="${HINTS[f]}"><span>${LABELS[f]}</span><output>${fmt(p[f])}</output>
        <input type="range" aria-label="${LABELS[f]}" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${p[f]}"></label>`;
    })
    .join('');
  host.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    p[el.dataset.f as keyof Params] = Number(el.value);
    el.previousElementSibling!.textContent = fmt(Number(el.value));
  });
  host.addEventListener('change', onChange);
}

// Animated mini-simulator: <div class="mini" data-kind="fixed" data-fields="a,b" data-chart>
function mini(host: HTMLElement) {
  const kind = host.dataset.kind as Kind;
  const fields = (host.dataset.fields ?? '').split(',').filter(Boolean) as (keyof Params)[];
  const p: Params = { ...defaults, ...JSON.parse(host.dataset.params ?? '{}') };
  host.innerHTML = `<canvas class="m" role="img" aria-label="Simulação animada do disparo. Clique para repetir." height="230" title="Clique para repetir"></canvas>
    ${host.hasAttribute('data-chart') ? '<canvas class="e" role="img" aria-label="Gráfico de energia do disparo" height="170"></canvas>' : ''}
    <div class="ctl"></div><p class="out"></p>`;
  const [machine, chart] = host.querySelectorAll('canvas');
  const out = host.querySelector('.out')!;
  let raf = 0;
  function run() {
    cancelAnimationFrame(raf);
    let m;
    try {
      m = build(kind, p);
    } catch (e) {
      out.textContent = (e as Error).message;
      return;
    }
    const r = simulate(m, { afterRelease: 1 });
    out.innerHTML = r.error
      ? r.error
      : `Alcance <b>${r.range.toFixed(0)} m</b> · eficiência <b>${(100 * r.efficiency).toFixed(0)}%</b> · saída a <b>${r.release!.speed.toFixed(0)} m/s</b>`;
    const R = p.longArm + p.slingLength + 1;
    const b = { x0: -R, x1: R, y0: -0.5, y1: p.pivotHeight + R };
    const end = r.release ? r.release.t + 0.4 : r.frames.at(-1)!.t;
    const fr = r.frames.filter((f) => f.t <= end);
    const ids = [m.projectile, ...(m.counterweight !== undefined ? [m.counterweight] : []), 0];
    const spec: ChartSpec = {
      title: 'Energia cinética', unit: 'kJ', t: fr.map((f) => f.t), marker: r.release?.t,
      series: ids.map((id, i) => ({ label: m.bodies[id].name, color: css(`--series-${i + 1}`), values: fr.map((f) => f.kes[id] / 1000) })),
    };
    const tEnd = r.frames.at(-1)!.t;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(tEnd, Math.max(0, ((now - start) / 1000) * 0.3)); // slow motion
      drawMachine(machine, m, r, t, b);
      if (chart) drawChart(chart, spec, Math.min(t, end));
      if (t < tEnd) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  sliders(host.querySelector('.ctl')!, fields, p, run);
  machine.addEventListener('click', run);
  // start when scrolled into view, so the reader sees the shot from the beginning
  new IntersectionObserver((es, ob) => es[0].isIntersecting && (ob.disconnect(), run())).observe(host);
}

// Same parameters, different machines: <div class="compare" data-kinds="fixed,hinged" data-fields="...">
function compare(host: HTMLElement) {
  const kinds = (host.dataset.kinds ?? '').split(',') as Kind[];
  const fields = (host.dataset.fields ?? '').split(',') as (keyof Params)[];
  const p: Params = { ...defaults };
  host.innerHTML = '<div class="ctl"></div><div class="bars"></div>';
  const bars = host.querySelector('.bars')!;
  function update() {
    const rows = kinds.map((k) => {
      try {
        const m = build(k, p);
        const r = simulate(m, { afterRelease: 0, frameEvery: 1e9, dt: FAST_DT });
        return { k, range: r.range, eff: r.efficiency, axle: r.peakForce[m.axle] };
      } catch {
        return { k, range: 0, eff: 0, axle: 0 };
      }
    });
    const max = Math.max(...rows.map((r) => r.range), 1);
    bars.innerHTML = rows
      .map((r) => `<div class="bar"><span>${KINDS[r.k].label}</span>
        <div class="track"><div style="width:${(100 * r.range) / max}%"></div></div>
        <span>${r.range.toFixed(0)} m · η ${(100 * r.eff).toFixed(0)}% · eixo ${(r.axle / 1000).toFixed(0)} kN</span></div>`)
      .join('');
  }
  sliders(host.querySelector('.ctl')!, fields, p, update);
  update();
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KIND_IDS = Object.keys(KINDS) as Kind[];
const lazy = (el: Element, f: () => void) => new IntersectionObserver((es, ob) => es[0].isIntersecting && (ob.disconnect(), f())).observe(el);
// static canvases are redrawn when the width or the color scheme changes
const redraws: (() => void)[] = [];
let redrawTimer = 0;
const redrawAll = () => (clearTimeout(redrawTimer), (redrawTimer = window.setTimeout(() => redraws.forEach((f) => f()), 150)));
addEventListener('resize', redrawAll);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);

// --- per-model sections: what each design is, what it is good and bad at, plus a live simulator
const NOTES: Record<Kind, { era: string; pro: string[]; con: string[]; knobs: (keyof Params)[] }> = {
  fixed: { era: 'Séc. XII · Mediterrâneo oriental', knobs: ['cwMass', 'longArm', 'slingLength', 'releaseDeg'],
    pro: ['Simples de construir e de ajustar', 'Sem peças móveis além do braço'], con: ['O contrapeso balança e leva parte da energia (η de 55–60%)'] },
  hinged: { era: 'Séc. XII–XIII', knobs: ['cwMass', 'hingeLength', 'slingLength', 'releaseDeg'],
    pro: ['Queda quase vertical: mais energia chega ao braço', 'Foi o padrão medieval'], con: ['A parada do balanço gera picos de força no eixo', 'A haste não pode tocar o chão'] },
  floating: { era: 'Moderno', knobs: ['cwMass', 'longArm', 'slingLength', 'releaseDeg'],
    pro: ['Mais eficiente que o fixo e o articulado (η ≈ 80%)', 'Contrapeso desce em linha reta'], con: ['Pede guia vertical e trilho: construção mais trabalhosa'] },
  traction: { era: 'China, séc. IV a.C. → Europa, séc. VI', knobs: ['crewForce', 'pullStroke', 'slingLength', 'releaseDeg'],
    pro: ['Sem contrapeso: leve e fácil de transportar', 'Cadência de tiro maior'], con: ['Energia limitada a força × curso da equipe', 'Depende de coordenação humana'] },
  whipper: { era: 'Moderno', knobs: ['cwMass', 'hingeLength', 'cockDeg', 'slingLength'],
    pro: ['~280° de giro: mais energia pelo mesmo peso'], con: ['A funda afrouxa e reestica com trancos', 'Difícil de ajustar', 'Pede eixo mais alto que o braço longo'] },
  walking: { era: 'Moderno · J. Stapleton', knobs: ['cockDeg', 'legLength', 'slingLength', 'releaseDeg'],
    pro: ['Só braço e perna, sem estrutura', 'Máquina leve e portátil'], con: ['Ajuste muito sensível (perna, funda e soltura)', 'Escala pequena: alcance absoluto menor'] },
  murlin: { era: 'Moderno · L. Vance', knobs: ['pulleyHeight', 'camStart', 'camEnd', 'slingLength'],
    pro: ['Câmbio contínuo: com metade do braço, vai mais longe que o articulado', 'Queda alta sem eixo alto'], con: ['Mais complexo (polia e tambor)', 'Plantas não públicas: geometria reconstruída'] },
  wheel: { era: 'Moderno', knobs: ['camStart', 'camEnd', 'slingLength', 'releaseDeg'],
    pro: ['Mesma ideia do MURLIN, sem polia', 'Compacto'], con: ['A queda fica limitada à altura do eixo'] },
  f2k: { era: 'Moderno · The Hurl', knobs: ['axleLift', 'rollerOffset', 'slingLength', 'releaseDeg'],
    pro: ['Queda extra do contrapeso', 'Alcance maior que o floating arm comum'], con: ['O pouso das rodas no trilho custa eficiência (~12 pontos de η no padrão)', 'Geometria do rolete reconstruída'] },
  fet: { era: 'Moderno', knobs: ['cwMass', 'longArm', 'slingLength', 'releaseDeg'],
    pro: ['Compacto', 'Sem a guia vertical do contrapeso'], con: ['No real, mais sujeito a descarrilar'] },
  ka: { era: 'Moderno', knobs: ['cwMass', 'hingeLength', 'cockDeg', 'slingLength'],
    pro: ['Queda muito maior que a do articulado comum', 'Pouco contrapeso joga longe'], con: ['Difícil de armar e de ajustar'] },
  faka: { era: 'Moderno', knobs: ['cwMass', 'cockDeg', 'slingLength', 'releaseDeg'],
    pro: ['Queda do King Arthur com a eficiência do eixo flutuante'], con: ['Nada absorve a energia que sobra: pode descarrilar se o ajuste errar'] },
  spring: { era: 'Experimental', knobs: ['springK', 'springRest', 'slingLength', 'releaseDeg'],
    pro: ['Leve e rápida: não acelera um contrapeso pesado'], con: ['Molas reais têm massa, cansam e quebram'] },
  fiffer: { era: '2010 (Punkin Chunkin)', knobs: ['cwMass', 'slingLength', 'releaseDeg', 'projMass'],
    pro: ['Transmissão sempre aberta: sem ponto morto no curso', 'Contrapeso gigante cai só 5 pés e ainda lança ~600 m'], con: ['Geometria fixa e precisa: pino e elos têm de bater na tesoura', 'Pesado e difícil de transportar (contrapeso de 2 t)'] },
};
$('models').innerHTML = KIND_IDS.map((k) => {
  const n = NOTES[k];
  const li = (a: string[]) => a.map((t) => `<li>${t}</li>`).join('');
  return `<article class="model" id="m-${k}">
    <header><h3>${KINDS[k].label}</h3><span class="chip">${n.era}</span></header>
    <div class="txt"><p>${KINDS[k].info}</p>
      <div class="pc"><div class="pro"><h4>Pontos fortes</h4><ul>${li(n.pro)}</ul></div><div class="con"><h4>Limitações</h4><ul>${li(n.con)}</ul></div></div>
      <a class="open" href="./?kind=${k}">Abrir no laboratório →</a></div>
    <div class="fig"><div class="mini" data-kind="${k}" data-fields="${n.knobs.join(',')}" data-params='${JSON.stringify(KINDS[k].preset ?? {})}' data-chart></div></div>
  </article>`;
}).join('');

// --- index: sections plus one entry per model; the current one is highlighted
const secs = [...document.querySelectorAll<HTMLElement>('.sec[id]')];
$('toc').insertAdjacentHTML('beforeend', '<h2>Neste guia</h2>' + secs.map((s) =>
  `<a href="#${s.id}">${s.querySelector('h2')!.textContent}</a>` +
  (s.id === 'modelos' ? `<div class="sub">${KIND_IDS.map((k) => `<a href="#m-${k}">${KINDS[k].label}</a>`).join('')}</div>` : '')).join(''));
const tocLinks = new Map([...$('toc').querySelectorAll('a[href^="#"]')].map((a) => [a.getAttribute('href')!.slice(1), a]));
const spy = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  tocLinks.forEach((l) => l.removeAttribute('aria-current'));
  tocLinks.get(e.target.id)?.setAttribute('aria-current', 'true');
}), { rootMargin: '0px 0px -70% 0px' });
[...secs, ...document.querySelectorAll('.model')].forEach((el) => spy.observe(el));

// --- crosswind drift in 3D (section 10): no correction, release pin 25 cm off center, machine aimed 1°
{
  const cv = $<HTMLCanvasElement>('drift');
  lazy(cv, async () => {
    const winds = linspace(-8, 8, 9);
    const m = lift(build('hinged', defaultsFor('hinged')));
    // one shot at a time, yielding between them: 27 3D shots would otherwise freeze the page for seconds
    const drift = async (env: { pinOffset: number; aimDeg: number }) => {
      const out: number[] = [];
      for (const w of winds) {
        out.push(simulate3(apply3d(m, { windZ: w, ...env }), { afterRelease: 0, frameEvery: 1e9, dt: FAST_DT }).lateral);
        await new Promise((r) => setTimeout(r));
      }
      return out;
    };
    const spec: ChartSpec = { title: 'Desvio lateral', unit: 'm', t: winds, xUnit: 'm/s', series: [
      { label: 'sem correção', color: '', values: await drift({ pinOffset: 0, aimDeg: 0 }) },
      { label: 'pino a 25 cm', color: '', values: await drift({ pinOffset: 0.25, aimDeg: 0 }) },
      { label: 'mira 1°', color: '', values: await drift({ pinOffset: 0, aimDeg: 1 }) },
    ] };
    const draw = (x?: number) => {
      spec.series.forEach((s, i) => (s.color = css(`--series-${i + 1}`)));
      drawChart(cv, spec, x === undefined ? undefined : timeAt(cv, spec, x));
    };
    redraws.push(draw);
    draw();
    const slope = (spec.series[0].values.at(-1)! - spec.series[0].values[0]) / (winds.at(-1)! - winds[0]);
    $('drift-out').textContent = `Sem correção: ${slope.toFixed(2)} m de desvio por m/s de vento. Passe o mouse para ler os valores.`;
    cv.addEventListener('mousemove', (e) => {
      draw(e.clientX);
      const t = timeAt(cv, spec, e.clientX);
      const i = Math.round(((t - winds[0]) / (winds.at(-1)! - winds[0])) * (winds.length - 1));
      $('drift-out').textContent = `Vento ${winds[i].toFixed(0)} m/s: ${spec.series.map((s) => `${s.label} ${s.values[i].toFixed(1)} m`).join(' · ')}`;
    });
    cv.addEventListener('mouseleave', () => draw());
  });
}

// --- timeline (section 1)
const EVENTS = [
  ['séc. IV–III a.C.', 'Textos chineses descrevem a máquina de tração'],
  ['séc. VI', 'Chega ao Mediterrâneo (cercos bizantinos e ávaros)'],
  ['séc. XII', 'O contrapeso substitui a equipe'],
  ['~1187', 'Tratado escrito para Saladino'],
  ['1268–1273', 'Xiangyang: trebuchets de contrapeso'],
  ['1304', 'Warwolf diante do Castelo de Stirling'],
  ['séc. XV', 'A pólvora aposenta a máquina'],
];
$('tl-svg').innerHTML = '<line class="th" x1="60" y1="24" x2="60" y2="336"/>' + EVENTS.map(([d, t], i) => {
  const y = 34 + i * 48;
  return `<circle class="${i === 2 ? 'ac' : 'dot'}" cx="60" cy="${y}" r="7"/><text x="84" y="${y - 2}" style="font-weight:600">${d}</text><text x="84" y="${y + 16}" class="m">${t}</text>`;
}).join('');

// --- diminishing returns of counterweight mass (section 2): v / v_queda = ρ·sqrt((μ−ρ)/(μ+ρ²))
{
  const cv = $<HTMLCanvasElement>('returns');
  const mu = linspace(5, 300, 150);
  const spec: ChartSpec = { title: 'v / v_queda', unit: 'adimensional', t: mu, xUnit: 'M/m',
    series: [2, 4, 6].map((rho) => ({ label: `ρ = ${rho}`, color: '', values: mu.map((m) => (m > rho ? rho * Math.sqrt((m - rho) / (m + rho * rho)) : 0)) })) };
  const draw = (x?: number) => {
    spec.series.forEach((s, i) => (s.color = css(`--series-${i + 1}`)));
    drawChart(cv, spec, x === undefined ? undefined : timeAt(cv, spec, x));
  };
  redraws.push(draw);
  draw();
  cv.addEventListener('mousemove', (e) => {
    draw(e.clientX);
    const t = timeAt(cv, spec, e.clientX);
    const i = Math.round(((t - mu[0]) / (mu.at(-1)! - mu[0])) * (mu.length - 1));
    $('returns-out').textContent = `M/m = ${t.toFixed(0)}: ${spec.series.map((s) => `${s.label} → ${s.values[i].toFixed(2)}`).join(' · ')}`;
  });
  cv.addEventListener('mouseleave', () => draw());
}

// --- five frames of one real shot (section 3)
{
  const host = $('story');
  const p = defaults;
  const m = build('fixed', p);
  const r = simulate(m, { afterRelease: 0.6 });
  if (r.release) {
    const T = r.release.t;
    const R = p.longArm + p.slingLength + 1;
    const near = { x0: -R, x1: R, y0: -0.5, y1: p.pivotHeight + R };
    const far = { x0: -R, x1: 45, y0: -0.5, y1: 22 };
    const frames: [number, string, typeof near][] = [[0, '1. Armado', near], [0.5 * T, '2. Arrasto na calha', near], [0.85 * T, '3. Giro da funda', near], [T, '4. Liberação', near], [T + 0.5, '5. Voo', far]];
    host.innerHTML = frames.map(([, name]) => `<figure><canvas height="170" role="img" aria-label="${name}"></canvas><figcaption><b>${name}</b></figcaption></figure>`).join('');
    const cvs = host.querySelectorAll('canvas');
    const draw = () => frames.forEach(([t, , b], i) => drawMachine(cvs[i], m, r, t, b));
    redraws.push(draw);
    lazy(host, draw);
  }
}

// --- flight with and without air (section 5)
{
  const cv = $<HTMLCanvasElement>('air');
  const st: Record<string, number> = { v: 45, a: 45 };
  const ctl = [['v', 'Velocidade de saída (m/s)', 10, 100], ['a', 'Ângulo de saída (°)', 10, 70]] as const;
  $('air-ctl').innerHTML = ctl.map(([k, l, min, max]) => `<label><span>${l}</span><output>${st[k]}</output><input type="range" aria-label="${l}" data-k="${k}" min="${min}" max="${max}" step="1" value="${st[k]}"></label>`).join('');
  const rad = 0.1, mass = 10;
  const kDrag = (0.5 * 1.225 * 0.47 * Math.PI * rad * rad) / mass;
  const draw = () => {
    const th = (st.a * Math.PI) / 180;
    const v: [number, number] = [st.v * Math.cos(th), st.v * Math.sin(th)];
    const air = fly([0, 0], v, kDrag);
    const tVac = (2 * v[1]) / G;
    const vac = linspace(0, tVac, 80).map((t): [number, number] => [v[0] * t, v[1] * t - 0.5 * G * t * t]);
    const range = v[0] * tVac;
    const top = (v[1] * v[1]) / (2 * G);
    const { g, w, h } = fitCanvas(cv);
    const P = view(w, h, { x0: -range * 0.04, x1: range * 1.06, y0: -top * 0.12, y1: top * 1.25 }).P;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = css('--muted');
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(...P([-range * 0.04, 0])); g.lineTo(...P([range * 1.06, 0])); g.stroke();
    g.setLineDash([6, 5]);
    g.beginPath(); vac.forEach((q, i) => (i ? g.lineTo(...P(q)) : g.moveTo(...P(q)))); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = css('--accent');
    g.lineWidth = 2.5;
    g.beginPath(); air.path.forEach((q, i) => (i % 5 === 0 || i === air.path.length - 1) && (i ? g.lineTo(...P(q)) : g.moveTo(...P(q)))); g.stroke();
    g.fillStyle = css('--ink');
    g.font = '12px ' + FONT;
    g.textAlign = 'center';
    g.fillText(`${range.toFixed(0)} m`, P([range, 0])[0], P([0, 0])[1] + 16);
    g.fillText(`${air.range.toFixed(0)} m`, P([air.range, 0])[0], P([0, 0])[1] - 8);
    $('air-out').innerHTML = `Sem ar <b>${range.toFixed(0)} m</b> · com ar <b>${air.range.toFixed(0)} m</b> (o ar tira <b>${(100 * (1 - air.range / range)).toFixed(0)}%</b>)`;
  };
  $('air-ctl').addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    st[el.dataset.k!] = Number(el.value);
    el.previousElementSibling!.textContent = el.value;
    draw();
  });
  redraws.push(draw);
  draw();
}

// --- sling × release-angle map (section 8): 81 real simulations, run when scrolled into view
{
  const cv = $<HTMLCanvasElement>('heat');
  lazy(cv, async () => {
    const xs = linspace(3, 6.5, 9); // stops before the 7.5 m collapse, which would swamp the color scale
    const ys = linspace(28, 52, 9);
    const z: number[][] = [];
    for (const y of ys) {
      z.push(xs.map((x) => evaluate('fixed', { ...defaults, slingLength: x, releaseDeg: y }, 'range')));
      await new Promise((r) => setTimeout(r)); // keep the page responsive between rows
    }
    const spec: HeatSpec = { title: 'Alcance', unit: 'm', xs, ys, z, xLabel: 'Funda (m)', yLabel: 'Ângulo de liberação (°)', current: [defaults.slingLength, defaults.releaseDeg] };
    let hover: [number, number] | undefined;
    const draw = () => drawHeatmap(cv, spec, hover);
    redraws.push(draw);
    draw();
    const best = z.flat().reduce((a, b) => Math.max(a, b));
    const bj = z.findIndex((row) => row.includes(best));
    $('heat-out').innerHTML = `Melhor célula: <b>${best.toFixed(0)} m</b> com funda de ${xs[z[bj].indexOf(best)].toFixed(1)} m e ângulo de ${ys[bj].toFixed(0)}°. Passe o mouse para ler outras células.`;
    cv.addEventListener('mousemove', (e) => ((hover = heatCell(cv, spec, e.clientX, e.clientY)), draw()));
    cv.addEventListener('mouseleave', () => ((hover = undefined), draw()));
  });
}

// --- ranking of every model at its lab default (section 9)
lazy($('rank'), () => setTimeout(() => {
  const rows = KIND_IDS.flatMap((k) => {
    try {
      const m = build(k, defaultsFor(k));
      const r = simulate(m, { afterRelease: 0, frameEvery: 1e9, dt: FAST_DT });
      return r.error ? [] : [{ k, range: r.range, eff: r.efficiency, axle: r.peakForce[m.axle] }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.range - a.range);
  const max = rows[0]?.range ?? 1;
  $('rank').innerHTML = rows.map((r) => `<div class="bar"><span><a href="#m-${r.k}">${KINDS[r.k].label}</a></span>
    <div class="track"><div style="width:${(100 * r.range) / max}%"></div></div>
    <span>${r.range.toFixed(0)} m · η ${(100 * r.eff).toFixed(0)}% · eixo ${(r.axle / 1000).toFixed(1)} kN</span></div>`).join('');
}));

document.querySelectorAll<HTMLElement>('.mini').forEach(mini);
document.querySelectorAll<HTMLElement>('.compare').forEach(compare);
sizeCanvases(); // after .mini built its canvases
