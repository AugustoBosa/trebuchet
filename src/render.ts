import { css, fitCanvas } from './charts';
import { camRope } from './physics/constraints';
import type { Mechanism, Vec } from './physics/model';
import type { Result } from './physics/solver';

export interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// world ↔ screen with y up, fitting the bounds into w×h
export function view(w: number, h: number, b: Bounds) {
  const s = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0));
  const ox = (w - s * (b.x1 - b.x0)) / 2 - s * b.x0;
  const oy = h - (h - s * (b.y1 - b.y0)) / 2 + s * b.y0;
  return {
    s,
    P: (p: Vec): Vec => [ox + s * p[0], oy - s * p[1]],
    W: (x: number, y: number): Vec => [(x - ox) / s, (oy - y) / s],
  };
}
export type View = ReturnType<typeof view>;

export const world = (q: Float64Array, b: number, local: Vec): Vec => {
  const c = Math.cos(q[3 * b + 2]);
  const s = Math.sin(q[3 * b + 2]);
  return [q[3 * b] + c * local[0] - s * local[1], q[3 * b + 1] + s * local[0] + c * local[1]];
};

export function painter(g: CanvasRenderingContext2D, v: View) {
  return {
    line(a: Vec, b: Vec, color: string, width: number, dash: number[] = []) {
      g.setLineDash(dash);
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath(); g.moveTo(...v.P(a)); g.lineTo(...v.P(b)); g.stroke();
      g.setLineDash([]);
    },
    disk(c: Vec, rad: number, color: string) {
      g.fillStyle = color;
      g.beginPath(); g.arc(...v.P(c), Math.max(3, rad * v.s), 0, 2 * Math.PI); g.fill();
    },
  };
}

export function flightPos(r: Result, t: number): Vec {
  return r.flight[Math.min(r.flight.length - 1, Math.round((t - r.release!.t) / 1e-3))];
}

export function drawMachine(c: HTMLCanvasElement, m: Mechanism, r: Result, t: number, b: Bounds): View {
  const { g, w, h } = fitCanvas(c);
  const v = view(w, h, b);
  const { line, disk } = painter(g, v);
  const ink = css('--ink');
  const accent = css('--accent');
  const muted = css('--muted');
  const span = b.x1 - b.x0;
  g.clearRect(0, 0, w, h);
  g.lineCap = 'round';

  line([b.x0 - span, 0], [b.x1 + span, 0], muted, 2);
  const dtF = r.frames.length > 1 ? r.frames[1].t - r.frames[0].t : 1;
  const f = r.frames[Math.min(r.frames.length - 1, Math.round(t / dtF))];
  for (const j of m.joints) {
    if (j.kind === 'pin' && j.b === 'ground') {
      // A-frame under a fixed axle
      line([j.pb[0] - j.pb[1] * 0.5, 0], j.pb, muted, 4);
      line([j.pb[0] + j.pb[1] * 0.5, 0], j.pb, muted, 4);
    } else if (j.kind === 'slider') {
      const k = span / Math.hypot(...j.dir);
      line([j.origin[0] - k * j.dir[0], Math.max(0, j.origin[1] - k * j.dir[1])], [j.origin[0] + k * j.dir[0], j.origin[1] + k * j.dir[1]], muted, 3, [8, 6]);
    } else if ((j.kind === 'pin' || j.kind === 'weld') && j.b !== 'ground' && m.bodies[j.a].shape.kind === 'disk' && (j.pa[0] || j.pa[1])) {
      line(world(f.q, j.a, [0, 0]), world(f.q, j.b, j.pb), ink, 3); // hanger of a hinged counterweight
    } else if (j.kind === 'roller') {
      line([j.at[0], 0], j.at, muted, 3);
      disk(j.at, 0.06 * span / 10, muted);
    } else if (j.kind === 'floor' && m.bodies[j.a].shape.kind === 'rod') {
      line([b.x0 - span, j.y], [b.x1 + span, j.y], muted, 3, [8, 6]); // track the wheels land on
    } else if (j.kind === 'cam') {
      // drum at its current radius; rope off its back side, up over the pulley (if any) and down to the counterweight
      const hub = world(f.q, j.b, j.hub);
      const { r } = camRope(j, j.theta0 - f.q[3 * j.b + 2]);
      g.strokeStyle = muted;
      g.lineWidth = 2;
      g.beginPath(); g.arc(...v.P(hub), r * v.s, 0, 2 * Math.PI); g.stroke();
      const cw = world(f.q, j.a, [0, 0]);
      const side: Vec = [hub[0] - r, hub[1]];
      if (j.over) {
        const pr = (j.over[0] - cw[0]) / 2; // pulley spans the two rope sides
        const c: Vec = [cw[0] + pr, j.over[1]];
        line([0.5 * (c[0] + j.over[0]), 0], c, muted, 3); // post
        g.beginPath(); g.arc(...v.P(c), Math.abs(pr) * v.s, Math.PI, 0); g.stroke();
        line(side, j.over, ink, 1.5);
        line([cw[0], j.over[1]], cw, ink, 1.5);
      } else line(side, cw, ink, 1.5);
    } else if (j.kind === 'rope' && j !== m.joints[m.sling]) {
      line(world(f.q, j.a, j.pa), j.b === 'ground' ? j.pb : world(f.q, j.b, j.pb), muted, 1.5);
    }
  }
  for (const sp of m.springs ?? []) line(world(f.q, sp.body, sp.local), sp.anchor, accent, 2.5, [2, 3]); // spring
  for (const pl of m.pulls ?? []) {
    const a = world(f.q, pl.body, pl.local);
    line(a, [a[0], 0], accent, 1.5, [3, 4]); // crew rope
  }
  m.bodies.forEach((bd, i) => {
    if (bd.shape.kind === 'rod') line(world(f.q, i, [-bd.shape.length / 2, 0]), world(f.q, i, [bd.shape.length / 2, 0]), ink, 6);
  });
  const sling = m.joints[m.sling];
  const released = r.release && t >= r.release.t;
  const proj: Vec = released ? flightPos(r, t) : [f.q[3 * m.projectile], f.q[3 * m.projectile + 1]];
  if (sling.kind === 'rope' && !released) {
    const other = sling.a === m.projectile ? { b: sling.b, p: sling.pb } : { b: sling.a as number | 'ground', p: sling.pa };
    line(other.b === 'ground' ? other.p : world(f.q, other.b, other.p), proj, accent, 2);
  }
  m.bodies.forEach((bd, i) => {
    if (bd.shape.kind === 'disk' && i !== m.projectile) disk(world(f.q, i, [0, 0]), bd.shape.radius, ink);
  });
  const ps = m.bodies[m.projectile].shape;
  disk(proj, ps.kind === 'disk' ? ps.radius : 0.1, accent);
  return v;
}

export function drawFlight(c: HTMLCanvasElement, r: Result, t: number, xMin: number) {
  const { g, w, h } = fitCanvas(c);
  g.clearRect(0, 0, w, h);
  if (!r.release) return;
  const xs = r.flight.map((q) => q[0]);
  const top = Math.max(...r.flight.map((q) => q[1]));
  const x0 = Math.min(xMin, ...xs);
  const x1 = Math.max(10, ...xs) * 1.05;
  const { P } = view(w, h, { x0, x1, y0: -2, y1: top * 1.15 + 2 });
  g.strokeStyle = css('--muted');
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(...P([x0, 0])); g.lineTo(...P([x1, 0])); g.stroke();
  g.setLineDash([4, 4]);
  g.beginPath();
  r.flight.forEach((q, i) => (i ? g.lineTo(...P(q)) : g.moveTo(...P(q))));
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = css('--accent');
  const pos = t >= r.release.t ? flightPos(r, t) : r.release.p;
  g.beginPath(); g.arc(...P(pos), 4, 0, 2 * Math.PI); g.fill();
  g.fillStyle = css('--ink');
  g.fillText(`${r.range.toFixed(1)} m`, P([r.range, 0])[0] - 20, P([0, 0])[1] - 6);
}
