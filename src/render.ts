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

// hl: keys of the selected part (b:i body, j:i joint, s:i spring, p:i crew pull), drawn in the accent color
export function drawMachine(c: HTMLCanvasElement, m: Mechanism, r: Result, t: number, b: Bounds, hl?: Set<string>): View {
  const { g, w, h } = fitCanvas(c);
  const v = view(w, h, b);
  const { line, disk } = painter(g, v);
  const ink = css('--ink');
  const accent = css('--accent');
  const muted = css('--muted');
  const span = b.x1 - b.x0;
  const on = (k: string) => !!hl?.has(k);
  const tint = (k: string, base: string) => (on(k) ? accent : base);
  const wide = (k: string, w: number) => (on(k) ? w + 2 : w);
  g.clearRect(0, 0, w, h);
  g.lineCap = 'round';

  line([b.x0 - span, 0], [b.x1 + span, 0], muted, 2);
  const dtF = r.frames.length > 1 ? r.frames[1].t - r.frames[0].t : 1;
  const f = r.frames[Math.min(r.frames.length - 1, Math.round(t / dtF))];
  m.joints.forEach((j, ji) => {
    const k = `j:${ji}`;
    const mu = tint(k, muted);
    if (j.kind === 'pin' && j.b === 'ground') {
      // A-frame under a fixed axle
      line([j.pb[0] - j.pb[1] * 0.5, 0], j.pb, mu, wide(k, 4));
      line([j.pb[0] + j.pb[1] * 0.5, 0], j.pb, mu, wide(k, 4));
    } else if (j.kind === 'slider') {
      const kk = span / Math.hypot(...j.dir);
      line([j.origin[0] - kk * j.dir[0], Math.max(0, j.origin[1] - kk * j.dir[1])], [j.origin[0] + kk * j.dir[0], j.origin[1] + kk * j.dir[1]], mu, wide(k, 3), [8, 6]);
    } else if ((j.kind === 'pin' || j.kind === 'weld') && j.b !== 'ground' && m.bodies[j.a].shape.kind === 'disk' && (j.pa[0] || j.pa[1])) {
      line(world(f.q, j.a, [0, 0]), world(f.q, j.b, j.pb), tint(k, ink), wide(k, 3)); // hanger of a hinged counterweight
    } else if (j.kind === 'roller') {
      line([j.at[0], 0], j.at, mu, wide(k, 3));
      disk(j.at, 0.06 * span / 10, mu);
    } else if (j.kind === 'floor' && m.bodies[j.a].shape.kind === 'rod') {
      line([b.x0 - span, j.y], [b.x1 + span, j.y], mu, wide(k, 3), [8, 6]); // track the wheels land on
    } else if (on(k) && (j.kind === 'pin' || j.kind === 'weld' || j.kind === 'foot' || j.kind === 'spike' || j.kind === 'stop' || j.kind === 'floor')) {
      ring(jointPoint(m, f.q, j)); // a joint with no drawing of its own: mark where it is
    } else if (j.kind === 'cam') {
      // drum at its current radius; rope off its back side, up over the pulley (if any) and down to the counterweight
      const hub = world(f.q, j.b, j.hub);
      const { r } = camRope(j, (j.dir ?? 1) * (j.theta0 - f.q[3 * j.b + 2]));
      g.strokeStyle = mu;
      g.lineWidth = wide(k, 2);
      g.beginPath(); g.arc(...v.P(hub), r * v.s, 0, 2 * Math.PI); g.stroke();
      const cw = world(f.q, j.a, [0, 0]);
      const side: Vec = [hub[0] - (j.dir ?? 1) * r, hub[1]];
      if (j.over) {
        const pr = (j.over[0] - cw[0]) / 2; // pulley spans the two rope sides
        const c: Vec = [cw[0] + pr, j.over[1]];
        line([0.5 * (c[0] + j.over[0]), 0], c, mu, wide(k, 3)); // post
        g.beginPath(); g.arc(...v.P(c), Math.abs(pr) * v.s, Math.PI, 0); g.stroke();
        line(side, j.over, tint(k, ink), wide(k, 1.5));
        line([cw[0], j.over[1]], cw, tint(k, ink), wide(k, 1.5));
      } else line(side, cw, tint(k, ink), wide(k, 1.5));
    } else if (j.kind === 'rope' && j !== m.joints[m.sling]) {
      line(world(f.q, j.a, j.pa), j.b === 'ground' ? j.pb : world(f.q, j.b, j.pb), mu, wide(k, 1.5));
    }
  });
  (m.springs ?? []).forEach((sp, i) => line(world(f.q, sp.body, sp.local), sp.anchor, accent, wide(`s:${i}`, 2.5), [2, 3])); // spring
  (m.pulls ?? []).forEach((pl, i) => {
    const a = world(f.q, pl.body, pl.local);
    line(a, [a[0], 0], accent, wide(`p:${i}`, 1.5), [3, 4]); // crew rope
  });
  m.bodies.forEach((bd, i) => {
    if (bd.shape.kind === 'rod') line(world(f.q, i, [-bd.shape.length / 2, 0]), world(f.q, i, [bd.shape.length / 2, 0]), tint(`b:${i}`, ink), wide(`b:${i}`, 6));
  });
  const sling = m.joints[m.sling];
  const released = r.release && t >= r.release.t;
  const proj: Vec = released ? flightPos(r, t) : [f.q[3 * m.projectile], f.q[3 * m.projectile + 1]];
  if (sling.kind === 'rope' && !released) {
    const other = sling.a === m.projectile ? { b: sling.b, p: sling.pb } : { b: sling.a as number | 'ground', p: sling.pa };
    line(other.b === 'ground' ? other.p : world(f.q, other.b, other.p), proj, accent, wide(`j:${m.sling}`, 2));
  }
  m.bodies.forEach((bd, i) => {
    if (bd.shape.kind === 'disk' && i !== m.projectile) disk(world(f.q, i, [0, 0]), bd.shape.radius, tint(`b:${i}`, ink));
  });
  const ps = m.bodies[m.projectile].shape;
  disk(proj, ps.kind === 'disk' ? ps.radius : 0.1, accent);
  if (on(`b:${m.projectile}`)) ring(proj, ps.kind === 'disk' ? ps.radius : 0.1);
  return v;

  function ring(p: Vec, rad = 0) {
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.beginPath(); g.arc(...v.P(p), Math.max(3, rad * v.s) + 6, 0, 2 * Math.PI); g.stroke();
  }
}

// where a joint sits (for the ones drawn as nothing but their bodies)
function jointPoint(m: Mechanism, q: Float64Array, j: Mechanism['joints'][number]): Vec {
  if (j.kind === 'foot') return j.at;
  if (j.kind === 'roller') return j.at;
  if (j.kind === 'stop') return world(q, j.a, [0, 0]);
  if (j.kind === 'floor') {
    const s = m.bodies[j.a].shape;
    const p = world(q, j.a, j.pa);
    return s.kind === 'disk' ? [p[0], p[1] - s.radius] : p;
  }
  if (j.kind === 'cam') return world(q, j.b, j.hub);
  return world(q, j.a, j.pa);
}

const segDist = (p: Vec, a: Vec, b: Vec) => {
  const ab: Vec = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
  return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
};

// The part under a click (world point p, tolerance tol in m) at pose q: b:i, j:i, s:i or p:i, or undefined.
// Joints and ropes win a near-tie against the bodies they sit on, so a pin on an arm can be picked.
export function partAt(m: Mechanism, q: Float64Array, p: Vec, tol: number, b: Bounds): string | undefined {
  let best: string | undefined, bestD = Infinity;
  const consider = (key: string, d: number, bonus = 0) => d <= tol && d - bonus < bestD && ((bestD = d - bonus), (best = key));
  const span = b.x1 - b.x0;
  m.bodies.forEach((bd, i) => {
    const s = bd.shape;
    if (s.kind === 'rod') consider(`b:${i}`, segDist(p, world(q, i, [-s.length / 2, 0]), world(q, i, [s.length / 2, 0])));
    else {
      const d = Math.max(0, Math.hypot(p[0] - q[3 * i], p[1] - q[3 * i + 1]) - s.radius);
      consider(`b:${i}`, d, d ? 0 : tol); // inside the drawn disk: it, not the rope or pin ending at its center
    }
  });
  const jb = 0.5 * tol;
  m.joints.forEach((j, ji) => {
    const k = `j:${ji}`;
    if (j.kind === 'pin' && j.b === 'ground') {
      consider(k, Math.min(segDist(p, [j.pb[0] - j.pb[1] * 0.5, 0], j.pb), segDist(p, [j.pb[0] + j.pb[1] * 0.5, 0], j.pb)), jb);
    } else if (j.kind === 'slider') {
      const kk = span / Math.hypot(...j.dir);
      consider(k, segDist(p, [j.origin[0] - kk * j.dir[0], Math.max(0, j.origin[1] - kk * j.dir[1])], [j.origin[0] + kk * j.dir[0], j.origin[1] + kk * j.dir[1]]));
    } else if ((j.kind === 'pin' || j.kind === 'weld') && j.b !== 'ground' && m.bodies[j.a].shape.kind === 'disk' && (j.pa[0] || j.pa[1])) {
      consider(k, segDist(p, world(q, j.a, [0, 0]), world(q, j.b, j.pb)), jb);
    } else if (j.kind === 'roller') {
      consider(k, segDist(p, [j.at[0], 0], j.at), jb);
    } else if (j.kind === 'floor' && m.bodies[j.a].shape.kind === 'rod') {
      consider(k, Math.abs(p[1] - j.y));
    } else if (j.kind === 'cam') {
      const hub = world(q, j.b, j.hub);
      const { r } = camRope(j, (j.dir ?? 1) * (j.theta0 - q[3 * j.b + 2]));
      const cw = world(q, j.a, [0, 0]);
      const side: Vec = [hub[0] - (j.dir ?? 1) * r, hub[1]];
      consider(k, Math.min(Math.abs(Math.hypot(p[0] - hub[0], p[1] - hub[1]) - r), j.over ? Math.min(segDist(p, side, j.over), segDist(p, [cw[0], j.over[1]], cw)) : segDist(p, side, cw)), jb);
    } else if (j.kind === 'rope') {
      const A = world(q, j.a, j.pa), B = j.b === 'ground' ? j.pb : world(q, j.b, j.pb);
      consider(k, segDist(p, A, B), jb);
    } else {
      const jp = jointPoint(m, q, j);
      consider(k, Math.hypot(p[0] - jp[0], p[1] - jp[1]), jb);
    }
  });
  (m.springs ?? []).forEach((sp, i) => consider(`s:${i}`, segDist(p, world(q, sp.body, sp.local), sp.anchor), jb));
  (m.pulls ?? []).forEach((pl, i) => {
    const a = world(q, pl.body, pl.local);
    consider(`p:${i}`, segDist(p, a, [a[0], 0]), jb);
  });
  return best;
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
