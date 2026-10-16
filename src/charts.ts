// Minimal time-series line chart on canvas: recessive grid, 2px lines, legend with values at the cursor.
export interface Series {
  label: string;
  color: string;
  values: number[];
}
export interface ChartSpec {
  title: string;
  unit: string;
  t: number[];
  series: Series[];
  marker?: number; // release time (or current value in a sweep)
  markerLabel?: string;
  xUnit?: string; // default 's'
}

export const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// CSS height in px; the height attribute becomes the hi-DPI backing size, so the layout value is kept in data-h
export const cssHeight = (c: HTMLCanvasElement) => Number((c.dataset.h ??= c.getAttribute('height')!));

export function fitCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const h = cssHeight(c);
  c.style.height = `${h}px`;
  c.width = c.clientWidth * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: c.clientWidth, h };
}

function niceStep(range: number, n: number) {
  const raw = range / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
}

const PAD = { l: 48, r: 12, t: 44, b: 22 };

// time under a canvas x, for hover scrubbing
export function timeAt(c: HTMLCanvasElement, spec: ChartSpec, clientX: number) {
  const x = clientX - c.getBoundingClientRect().left;
  const t0 = spec.t[0];
  const tMax = spec.t.at(-1)!;
  return Math.max(t0, Math.min(tMax, t0 + ((x - PAD.l) / (c.clientWidth - PAD.l - PAD.r)) * (tMax - t0)));
}

export function drawChart(c: HTMLCanvasElement, spec: ChartSpec, cursor?: number) {
  const { g, w, h } = fitCanvas(c);
  const muted = css('--muted');
  const ink = css('--ink');
  g.clearRect(0, 0, w, h);
  g.font = '12px system-ui, sans-serif';
  const all = spec.series.flatMap((s) => s.values).filter(Number.isFinite);
  const yMin = Math.min(0, ...all);
  const yMax0 = Math.max(...all, 1e-9);
  const step = niceStep(yMax0 - yMin, 4);
  const yMax = Math.ceil(yMax0 / step) * step;
  const t0 = spec.t[0];
  const tMax = spec.t.at(-1)!;
  const X = (t: number) => PAD.l + ((t - t0) / (tMax - t0)) * (w - PAD.l - PAD.r);
  const Y = (v: number) => h - PAD.b - ((v - yMin) / (yMax - yMin)) * (h - PAD.t - PAD.b);

  g.strokeStyle = css('--line');
  g.fillStyle = muted;
  g.lineWidth = 1;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    g.beginPath(); g.moveTo(PAD.l, Y(v)); g.lineTo(w - PAD.r, Y(v)); g.stroke();
    g.fillText(+v.toPrecision(3) + '', PAD.l - 6, Y(v));
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const ts = niceStep(tMax - t0, 6);
  for (let t = Math.ceil(t0 / ts) * ts; t <= tMax + 1e-9; t += ts) g.fillText(`${+t.toFixed(2)} ${spec.xUnit ?? 's'}`, X(t), h - PAD.b + 6);

  if (spec.marker !== undefined && spec.marker >= t0 && spec.marker <= tMax) {
    g.setLineDash([3, 3]);
    g.strokeStyle = muted;
    g.beginPath(); g.moveTo(X(spec.marker), PAD.t); g.lineTo(X(spec.marker), h - PAD.b); g.stroke();
    g.setLineDash([]);
    g.textAlign = 'left';
    g.fillText(spec.markerLabel ?? 'liberação', X(spec.marker) + 4, PAD.t);
  }

  g.lineWidth = 2;
  g.lineJoin = 'round';
  for (const s of spec.series) {
    g.strokeStyle = s.color;
    g.beginPath();
    s.values.forEach((v, i) => (i ? g.lineTo(X(spec.t[i]), Y(v)) : g.moveTo(X(spec.t[i]), Y(v))));
    g.stroke();
  }

  // title + legend (values at cursor); text in ink, color only on the swatch
  const i = cursor === undefined ? -1 : Math.min(spec.t.length - 1, Math.round(((cursor - t0) / (tMax - t0)) * (spec.t.length - 1)));
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = ink;
  g.font = '600 13px system-ui, sans-serif';
  g.fillText(`${spec.title} (${spec.unit})`, PAD.l, 10);
  let lx = PAD.l;
  g.font = '12px system-ui, sans-serif';
  for (const s of spec.series) {
    const v = s.values[i];
    const label = i >= 0 ? `${s.label}: ${Math.abs(v) < 5e-3 ? '0' : +v.toPrecision(3)}` : s.label;
    if (spec.series.length > 1) {
      g.fillStyle = s.color;
      g.fillRect(lx, 24, 12, 8);
      lx += 16;
    }
    g.fillStyle = ink;
    if (spec.series.length > 1 || i >= 0) g.fillText(label, lx, 28);
    lx += g.measureText(label).width + 14;
  }

  if (i >= 0) {
    g.strokeStyle = ink;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(spec.t[i]), PAD.t); g.lineTo(X(spec.t[i]), h - PAD.b); g.stroke();
    for (const s of spec.series) {
      g.fillStyle = s.color;
      g.strokeStyle = css('--bg');
      g.lineWidth = 2;
      g.beginPath(); g.arc(X(spec.t[i]), Y(s.values[i]), 4, 0, 2 * Math.PI); g.fill(); g.stroke();
    }
  }
}

// Sequential one-hue ramp (light = low, dark = high) from the validated blue scale.
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
function rampColor(u: number) {
  const x = Math.min(1, Math.max(0, u)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  return `rgb(${RAMP[i].map((v, k) => Math.round(v + f * (RAMP[i + 1][k] - v))).join(',')})`;
}

export interface HeatSpec {
  title: string;
  unit: string;
  xs: number[];
  ys: number[];
  z: number[][]; // z[j][i] for ys[j], xs[i]
  xLabel: string;
  yLabel: string;
  current: [number, number];
}

const HPAD = { l: 56, r: 70, t: 30, b: 40 };

export function heatCell(c: HTMLCanvasElement, s: HeatSpec, clientX: number, clientY: number): [number, number] | undefined {
  const r = c.getBoundingClientRect();
  const w = c.clientWidth;
  const h = cssHeight(c);
  const i = Math.floor(((clientX - r.left - HPAD.l) / (w - HPAD.l - HPAD.r)) * s.xs.length);
  const j = Math.floor(((h - HPAD.b - (clientY - r.top)) / (h - HPAD.t - HPAD.b)) * s.ys.length);
  return i >= 0 && j >= 0 && i < s.xs.length && j < s.ys.length ? [i, j] : undefined;
}

export function drawHeatmap(c: HTMLCanvasElement, s: HeatSpec, hover?: [number, number]) {
  const { g, w, h } = fitCanvas(c);
  const ink = css('--ink');
  const muted = css('--muted');
  g.clearRect(0, 0, w, h);
  const all = s.z.flat();
  const lo = Math.min(...all);
  const hi = Math.max(...all, lo + 1e-9);
  const cw = (w - HPAD.l - HPAD.r) / s.xs.length;
  const ch = (h - HPAD.t - HPAD.b) / s.ys.length;
  const cx = (i: number) => HPAD.l + i * cw;
  const cy = (j: number) => h - HPAD.b - (j + 1) * ch;
  s.z.forEach((row, j) => row.forEach((v, i) => {
    g.fillStyle = rampColor((v - lo) / (hi - lo));
    g.fillRect(cx(i), cy(j), cw + 0.5, ch + 0.5);
  }));
  // best cell
  let bi = 0;
  let bj = 0;
  s.z.forEach((row, j) => row.forEach((v, i) => v > s.z[bj][bi] && ((bi = i), (bj = j))));
  g.strokeStyle = css('--accent');
  g.lineWidth = 2;
  g.strokeRect(cx(bi) + 1, cy(bj) + 1, cw - 2, ch - 2);
  // current design
  const ux = (s.current[0] - s.xs[0]) / (s.xs.at(-1)! - s.xs[0]);
  const uy = (s.current[1] - s.ys[0]) / (s.ys.at(-1)! - s.ys[0]);
  if (ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1) {
    const px = HPAD.l + ux * (w - HPAD.l - HPAD.r);
    const py = h - HPAD.b - uy * (h - HPAD.t - HPAD.b);
    g.strokeStyle = ink;
    g.beginPath(); g.arc(px, py, 6, 0, 2 * Math.PI); g.stroke();
  }

  g.font = '12px system-ui, sans-serif';
  g.fillStyle = muted;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const i of [0, Math.floor(s.xs.length / 2), s.xs.length - 1]) g.fillText(+s.xs[i].toPrecision(3) + '', cx(i) + cw / 2, h - HPAD.b + 4);
  g.fillText(s.xLabel, HPAD.l + (w - HPAD.l - HPAD.r) / 2, h - 16);
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const j of [0, Math.floor(s.ys.length / 2), s.ys.length - 1]) g.fillText(+s.ys[j].toPrecision(3) + '', HPAD.l - 6, cy(j) + ch / 2);
  g.save();
  g.translate(12, HPAD.t + (h - HPAD.t - HPAD.b) / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillText(s.yLabel, 0, 0);
  g.restore();

  // legend bar
  const lx = w - HPAD.r + 16;
  for (let k = 0; k < 100; k++) {
    g.fillStyle = rampColor(k / 99);
    g.fillRect(lx, h - HPAD.b - ((k + 1) / 100) * (h - HPAD.t - HPAD.b), 12, (h - HPAD.t - HPAD.b) / 100 + 0.5);
  }
  g.textAlign = 'left';
  g.fillStyle = muted;
  g.fillText(+hi.toPrecision(3) + '', lx + 16, HPAD.t + 4);
  g.fillText(+lo.toPrecision(3) + '', lx + 16, h - HPAD.b - 4);

  g.fillStyle = ink;
  g.font = '600 13px system-ui, sans-serif';
  g.textBaseline = 'middle';
  const info = hover
    ? `${s.xLabel} ${+s.xs[hover[0]].toPrecision(4)}, ${s.yLabel} ${+s.ys[hover[1]].toPrecision(4)} → ${+s.z[hover[1]][hover[0]].toPrecision(4)} ${s.unit} (clique para aplicar)`
    : `${s.title} (${s.unit}) — contorno = melhor; círculo = design atual`;
  g.fillText(info, HPAD.l, 14);
  if (hover) {
    g.strokeStyle = ink;
    g.lineWidth = 1;
    g.strokeRect(cx(hover[0]), cy(hover[1]), cw, ch);
  }
}
