// Free editor: tools on the machine canvas + property panel for the selection.
import { css, cssHeight, fitCanvas } from './charts';
import type { Vec } from './physics/model';
import { painter, view, type Bounds, type View } from './render';
import { allPoints, analyze, attachments, camDir, compile, detachedJoints, removeBody, segDist, type Role, type SBody, type SJoint, type Sketch } from './sketch';

export type Tool = 'select' | 'rod' | 'disk' | 'projectile' | 'cw' | 'pin' | 'weld' | 'rope' | 'hslider' | 'vslider' | 'pull' | 'foot' | 'spike' | 'roller' | 'floor' | 'spring' | 'cam';
export const TOOLS: [Tool, string, string][] = [
  ['select', 'Selecionar', 'Clique para selecionar; arraste pontos (pontos coincidentes andam juntos). Del apaga, Ctrl+Z desfaz.'],
  ['rod', 'Barra', 'Arraste de uma ponta à outra para criar uma barra (braço, haste).'],
  ['disk', 'Massa', 'Clique para criar uma massa (disco).'],
  ['projectile', 'Projétil', 'Clique para criar o projétil. Perto do chão, ele fica apoiado na calha.'],
  ['cw', 'Contrapeso', 'Clique para criar o contrapeso: sua queda é a energia de entrada.'],
  ['pin', 'Pino', 'Clique num ponto: sobre 1 corpo prende ao chão (eixo); sobre 2, articula os dois mais recentes.'],
  ['weld', 'Solda', 'Clique num ponto sobre 2 corpos para uni-los rigidamente.'],
  ['rope', 'Corda', 'Arraste de um corpo (ou do chão) a outro. A corda que toca o projétil é a funda.'],
  ['hslider', 'Trilho ─', 'Clique num ponto de um corpo: ele passa a correr num trilho horizontal.'],
  ['vslider', 'Trilho │', 'Clique num ponto de um corpo: ele passa a correr numa guia vertical.'],
  ['foot', 'Pé', 'Clique na ponta de um corpo encostada no chão: ela fica presa por espinhos (não escorrega), mas pode descolar se for puxada para cima.'],
  ['pull', 'Equipe', 'Clique num ponto de um corpo: uma equipe puxa uma corda dali para baixo (tração humana). Ajuste força e curso no painel.'],
  ['spike', 'Espetos', 'Clique num ponto de um corpo, no ar: onde ele tocar o chão, os espetos cravam (não escorrega, pode descolar). É a perna do walking arm.'],
  ['roller', 'Rolete', 'Clique sobre uma barra: um rolete fixo passa a apoiá-la por baixo. Ela desliza sobre ele e pode levantar (F2K).'],
  ['floor', 'Chão', 'Clique num ponto de um corpo: ele não desce abaixo de uma altura (padrão: o chão). Para rodas que pousam num trilho, ajuste a altura no painel.'],
  ['spring', 'Mola', 'Arraste de um ponto de um corpo até a âncora fixa. A mola puxa k·(esticado − livre) enquanto esticada. Ajuste k e o comprimento livre no painel.'],
  ['cam', 'Tambor', 'Clique sobre a barra no centro do tambor (o eixo do braço): a corda do contrapeso se desenrola dele em espiral, do raio inicial ao final (MURLIN, roda). Precisa de um contrapeso.'],
];

export const FREE_BOUNDS: Bounds = { x0: -10, x1: 10, y0: -0.5, y1: 12 };
const SNAP_PX = 10;
const GRID = 0.05;

type Sel = { type: 'body' | 'joint'; i: number } | undefined;

export function createEditor(o: {
  canvas: HTMLCanvasElement;
  toolbar: HTMLElement;
  panel: HTMLElement;
  status: HTMLElement;
  onChange: () => void;
  active: () => boolean; // the canvas is shared with the presets
  onView: () => void; // zoom changed while a shot is displayed
}) {
  let sk: Sketch;
  let tool: Tool = 'select';
  let sel: Sel;
  let v: View;
  // followers: joint points elsewhere on a body being reshaped, kept at the same spot along it
  type Follower = { group: Vec[]; body: number; t: number; off: Vec };
  let drag: { from: Vec; to: Vec; moving?: Vec[]; followers?: Follower[] } | undefined;
  let bounds: Bounds = { ...FREE_BOUNDS };
  let pan: { x: number; y: number } | undefined; // last pointer position, screen px
  const undo: string[] = [];

  const snapshot = () => (undo.push(JSON.stringify(sk)), undo.length > 50 && undo.shift());
  const changed = () => (draw(), renderPanel(), o.onChange());

  // --- geometry helpers ---
  const tol = () => SNAP_PX / v.s;
  const d2 = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // existing point > grid node, except near a rod: there the point lands ON the rod (a diagonal rod falls between grid
  // nodes, and a joint snapped off it would read as a loose connection); a grid node already on the rod is kept
  const snap = (p: Vec, exclude: Vec[] = []): Vec => {
    let best: Vec | undefined;
    for (const q of allPoints(sk)) if (!exclude.includes(q) && d2(p, q) < tol() && (!best || d2(p, q) < d2(p, best))) best = q;
    if (best) return [best[0], best[1]];
    const grid: Vec = [Math.round(p[0] / GRID) * GRID, Math.max(0, Math.round(p[1] / GRID) * GRID)];
    let foot: Vec | undefined;
    let bd = tol();
    for (const b of sk.bodies) {
      if (b.kind !== 'rod' || exclude.includes(b.a) || exclude.includes(b.b)) continue; // not onto the rod being reshaped
      if (segDist(grid, b.a, b.b) <= 0.005) return grid;
      const ab: Vec = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - b.a[0]) * ab[0] + (p[1] - b.a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
      const q: Vec = [b.a[0] + t * ab[0], b.a[1] + t * ab[1]];
      if (d2(p, q) < bd) (bd = d2(p, q)), (foot = q);
    }
    return foot ?? grid;
  };
  const bodiesAt = (p: Vec) =>
    sk.bodies.map((b, i) => [b, i] as const)
      .filter(([b]) => (b.kind === 'rod' ? segDist(p, b.a, b.b) < tol() : d2(p, b.c) <= b.r + tol()))
      .map(([, i]) => i);
  const jointAt = (p: Vec) =>
    sk.joints.findIndex((j) => (j.kind === 'rope' ? segDist(p, j.pa, j.pb) < tol() : d2(p, j.at) < tol()));
  const eventPos = (e: PointerEvent): Vec => {
    const r = o.canvas.getBoundingClientRect();
    return v.W(e.clientX - r.left, e.clientY - r.top);
  };

  // --- drawing ---
  function draw() {
    const { g, w, h } = fitCanvas(o.canvas);
    if (!w) return; // hidden (3D view on): a zero-width view would make the grid loop forever
    v = view(w, h, bounds);
    const { line, disk } = painter(g, v);
    const ink = css('--ink');
    const muted = css('--muted');
    const accent = css('--accent');
    const grid = css('--line');
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    const [x0, y1] = v.W(0, 0);
    const [x1, y0] = v.W(w, h);
    const step = [0.1, 0.5, 1, 5, 10, 50, 100].find((k) => k * v.s >= 14) ?? 500; // keep grid lines ≥14 px apart
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) line([x, Math.max(0, y0)], [x, y1], grid, 1);
    for (let y = step; y <= y1; y += step) line([x0, y], [x1, y], grid, 1);
    line([x0, 0], [x1, 0], muted, 2);
    g.fillStyle = muted;
    g.font = '11px system-ui, sans-serif';
    g.fillText(`grade de ${step} m · roda = zoom · arraste o fundo = mover`, 8, h - 8);

    const isSel = (type: 'body' | 'joint', i: number) => sel?.type === type && sel.i === i;
    sk.joints.forEach((j, i) => {
      const c = isSel('joint', i) ? accent : muted;
      if (j.kind === 'rope') line(j.pa, j.pb, isSel('joint', i) ? accent : ink, 1.5, [5, 4]);
      if (j.kind === 'spring') line(j.at, j.anchor, c, 2, [2, 3]);
      if (j.kind === 'floor') line([j.at[0] - 0.4, j.y], [j.at[0] + 0.4, j.y], c, 3, [6, 4]);
      if (j.kind === 'cam') {
        const cw = sk.bodies[j.a];
        const hang: Vec = cw.kind === 'disk' ? cw.c : [(cw.a[0] + cw.b[0]) / 2, (cw.a[1] + cw.b[1]) / 2];
        g.strokeStyle = c; g.lineWidth = 2;
        g.beginPath(); g.arc(...v.P(j.at), j.r0 * v.s, 0, 2 * Math.PI); g.stroke();
        const side: Vec = [j.at[0] - camDir(j.at, j.over ? j.over[0] : hang[0]) * j.r0, j.at[1]];
        if (j.over) (line(side, j.over, ink, 1.5), line(j.over, [hang[0], j.over[1]], ink, 1.5), line([hang[0], j.over[1]], hang, ink, 1.5));
        else line(side, hang, ink, 1.5);
      }
      if (j.kind === 'slider') {
        const k = 30 / Math.hypot(...j.dir);
        line([j.at[0] - k * j.dir[0], j.at[1] - k * j.dir[1]], [j.at[0] + k * j.dir[0], j.at[1] + k * j.dir[1]], c, 2, [8, 6]);
      }
    });
    sk.bodies.forEach((b, i) => {
      const c = isSel('body', i) ? accent : ink;
      if (b.kind === 'rod') line(b.a, b.b, c, 6);
      else disk(b.c, b.r, b.role === 'projectile' ? accent : c);
      if (b.kind === 'disk' && isSel('body', i)) {
        g.strokeStyle = accent; g.lineWidth = 2;
        g.beginPath(); g.arc(...v.P(b.c), Math.max(3, b.r * v.s) + 4, 0, 2 * Math.PI); g.stroke();
      }
    });
    // loose connections: dashed red ring where the joint point misses its body
    const loose = new Set(detachedJoints(sk));
    g.strokeStyle = css('--danger');
    g.lineWidth = 2;
    g.setLineDash([4, 3]);
    for (const i of loose) for (const [pt] of attachments(sk.joints[i])) {
      g.beginPath(); g.arc(...v.P(pt), 11, 0, 2 * Math.PI); g.stroke();
    }
    g.setLineDash([]);
    sk.joints.forEach((j, i) => {
      if (j.kind === 'pull') { // crew rope: dashed line down to the ground, ends at the stroke limit
        line(j.at, [j.at[0], 0], isSel('joint', i) ? accent : css('--accent'), 2, [3, 4]);
        line([j.at[0] - 0.15, Math.max(0, j.at[1] - j.stroke)], [j.at[0] + 0.15, Math.max(0, j.at[1] - j.stroke)], css('--accent'), 2);
        return;
      }
      if (j.kind === 'rope' || j.kind === 'slider' || j.kind === 'floor') return;
      const [x, y] = v.P(j.at);
      g.strokeStyle = isSel('joint', i) ? accent : ink;
      g.fillStyle = css('--bg');
      g.lineWidth = 2;
      if (j.kind === 'foot') { // spiked foot: three spikes into the ground
        for (const dx of [-6, 0, 6]) { g.beginPath(); g.moveTo(x + dx - 3, y); g.lineTo(x + dx, y + 7); g.lineTo(x + dx + 3, y); g.stroke(); }
        return;
      }
      if (j.kind === 'spike') { // spikes in the air, pointing down
        for (const dx of [-6, 0, 6]) { g.beginPath(); g.moveTo(x + dx - 3, y); g.lineTo(x + dx, y + 7); g.lineTo(x + dx + 3, y); g.stroke(); }
        return;
      }
      if (j.kind === 'roller') { // fixed roller on a post
        line([j.at[0], 0], j.at, muted, 3);
        g.beginPath(); g.arc(x, y + 6, 6, 0, 2 * Math.PI); g.fill(); g.stroke();
        return;
      }
      if (j.kind === 'spring' || j.kind === 'cam') { g.beginPath(); g.arc(x, y, 4, 0, 2 * Math.PI); g.fill(); g.stroke(); return; }
      if (j.kind === 'stop') { // resting contact: small wedge
        g.beginPath(); g.moveTo(x - 6, y + 4); g.lineTo(x + 6, y + 4); g.lineTo(x, y - 5); g.closePath(); g.fill(); g.stroke();
        return;
      }
      if (j.kind === 'weld') { g.fillRect(x - 5, y - 5, 10, 10); g.strokeRect(x - 5, y - 5, 10, 10); }
      else { g.beginPath(); g.arc(x, y, 5, 0, 2 * Math.PI); g.fill(); g.stroke(); }
      if (j.b === 'ground') { // ground pin: little A-frame
        line(j.at, [j.at[0] - j.at[1] * 0.5, 0], muted, 3);
        line(j.at, [j.at[0] + j.at[1] * 0.5, 0], muted, 3);
      }
    });
    if (drag && (tool === 'rod' || tool === 'rope' || tool === 'spring')) line(drag.from, drag.to, accent, tool === 'rod' ? 6 : 1.5, tool === 'rod' ? [] : tool === 'rope' ? [5, 4] : [2, 3]);
  }

  // Joint points on bodies whose handle is moving (e.g. the axle in the middle of an arm whose tip is dragged).
  function followersOf(moving: Vec[]): Follower[] {
    const reshaped = new Set(sk.bodies.flatMap((b, i) => ((b.kind === 'rod' ? [b.a, b.b] : [b.c]).some((q) => moving.includes(q)) ? [i] : [])));
    const out: Follower[] = [];
    const taken = new Set<Vec>(moving);
    for (const j of sk.joints) for (const [pt, bi] of attachments(j)) {
      if (bi === 'ground' || !reshaped.has(bi) || taken.has(pt)) continue;
      const group = allPoints(sk).filter((q) => !taken.has(q) && d2(q, pt) < 1e-6);
      group.forEach((q) => taken.add(q));
      const b = sk.bodies[bi];
      if (b.kind === 'rod') {
        const ab: Vec = [b.b[0] - b.a[0], b.b[1] - b.a[1]];
        const t = ((pt[0] - b.a[0]) * ab[0] + (pt[1] - b.a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1);
        out.push({ group, body: bi, t, off: [0, 0] });
      } else out.push({ group, body: bi, t: 0, off: [pt[0] - b.c[0], pt[1] - b.c[1]] });
    }
    return out;
  }

  // --- pointer ---
  o.canvas.addEventListener('pointerdown', (e) => {
    if (!sk || o.canvas.dataset.mode !== 'edit') return;
    const p = eventPos(e);
    const s = snap(p);
    o.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) return void (e.preventDefault(), (pan = { x: e.clientX, y: e.clientY })); // middle button pans with any tool
    if (tool === 'select') {
      const near = allPoints(sk).filter((q) => d2(q, p) < tol());
      if (!near.length && jointAt(p) < 0 && !bodiesAt(p).length) {
        pan = { x: e.clientX, y: e.clientY }; // empty background: pan
        sel = undefined;
        draw(); renderPanel();
        return;
      }
      if (near.length) {
        const anchor = near[0];
        const moving = allPoints(sk).filter((q) => d2(q, anchor) < 1e-6);
        snapshot();
        drag = { from: [anchor[0], anchor[1]], to: s, moving, followers: followersOf(moving) };
      }
      const j = jointAt(p);
      const b = bodiesAt(p).at(-1);
      sel = j >= 0 ? { type: 'joint', i: j } : b !== undefined ? { type: 'body', i: b } : undefined;
      draw(); renderPanel();
      return;
    }
    if (tool === 'rod' || tool === 'rope' || tool === 'spring') { drag = { from: s, to: s }; return; }

    snapshot();
    const hits = bodiesAt(s);
    const add = (b: SBody) => { sk.bodies.push(b); sel = { type: 'body', i: sk.bodies.length - 1 }; };
    const named = (base: string) => `${base} ${sk.bodies.filter((b) => b.name.startsWith(base)).length + 1}`;
    if (tool === 'disk') add({ kind: 'disk', name: named('massa'), c: s, r: 0.3, mass: 100 });
    else if (tool === 'cw') add({ kind: 'disk', name: 'contrapeso', c: s, r: 0.45, mass: 1000, role: 'counterweight' });
    else if (tool === 'projectile') {
      sk.bodies.forEach((b) => b.kind === 'disk' && b.role === 'projectile' && delete b.role); // only one projectile
      add({ kind: 'disk', name: 'projétil', c: s[1] < 0.3 ? [s[0], 0.1] : s, r: 0.1, mass: 10, role: 'projectile' });
    } else if (tool === 'pin' || tool === 'weld') {
      if (!hits.length || (tool === 'weld' && hits.length < 2)) { undo.pop(); o.status.textContent = tool === 'weld' ? 'A solda precisa de 2 corpos no ponto.' : 'Clique sobre um corpo.'; return; }
      const [b, a] = hits.length >= 2 ? hits.slice(-2) : ['ground' as const, hits[0]];
      sk.joints.push(tool === 'pin' ? { kind: 'pin', at: s, a, b, ...(b === 'ground' ? { mu: 0.1, radius: 0.05 } : {}) } : { kind: 'weld', at: s, a, b });
      sel = { type: 'joint', i: sk.joints.length - 1 };
    } else if (tool === 'hslider' || tool === 'vslider') {
      if (!hits.length) { undo.pop(); o.status.textContent = 'Clique sobre um corpo.'; return; }
      sk.joints.push({ kind: 'slider', a: hits.at(-1)!, at: s, dir: tool === 'hslider' ? [1, 0] : [0, 1] });
      sel = { type: 'joint', i: sk.joints.length - 1 };
    } else if (tool === 'foot') {
      if (!hits.length || s[1] > 0.05) { undo.pop(); o.status.textContent = 'O pé precisa ficar sobre um corpo, rente ao chão (até 5 cm).'; return; }
      sk.joints.push({ kind: 'foot', a: hits.at(-1)!, at: [s[0], 0] });
      sel = { type: 'joint', i: sk.joints.length - 1 };
    } else if (tool === 'spike' || tool === 'floor') {
      if (!hits.length) { undo.pop(); o.status.textContent = 'Clique sobre um corpo.'; return; }
      const a = hits.at(-1)!;
      const b = sk.bodies[a];
      if (tool === 'floor' && b.kind === 'disk' && b.role === 'projectile') { undo.pop(); o.status.textContent = 'O projétil já tem a calha (o chão sob ele).'; return; }
      // a disk is held at its center, its rim resting on the ground; any other point simply can't go below ground
      if (tool === 'floor') sk.joints.push(b.kind === 'disk' ? { kind: 'floor', a, at: [b.c[0], b.c[1]], y: b.r } : { kind: 'floor', a, at: s, y: 0 });
      else sk.joints.push({ kind: 'spike', a, at: s });
      sel = { type: 'joint', i: sk.joints.length - 1 };
    } else if (tool === 'roller' || tool === 'cam') {
      const a = hits.filter((i) => sk.bodies[i].kind === 'rod').at(-1);
      const cw = sk.bodies.findIndex((b) => b.kind === 'disk' && b.role === 'counterweight');
      if (a === undefined || (tool === 'cam' && cw < 0)) { undo.pop(); o.status.textContent = a === undefined ? 'Clique sobre uma barra.' : 'Crie antes o contrapeso: é ele que pende da corda do tambor.'; return; }
      if (tool === 'roller') sk.joints.push({ kind: 'roller', a, at: s });
      else {
        const c = sk.bodies[cw] as Extract<SBody, { kind: 'disk' }>;
        // spiral sized so the rope runs out as the counterweight reaches the ground (same rule as the presets)
        sk.joints.push({ kind: 'cam', a: cw, b: a, at: s, r0: 0.8, r1: 0.2, span: Math.max(0.1, (2 * (c.c[1] - c.r)) / (0.8 + 0.2)) });
        // past the spiral's end the rope keeps paying out: the counterweight must land on the ground, as in the presets
        if (!sk.joints.some((j) => j.kind === 'floor' && j.a === cw)) sk.joints.push({ kind: 'floor', a: cw, at: [c.c[0], c.c[1]], y: c.r });
        // ponytail: the drum unwinds as the arm turns clockwise (the presets' direction); a mirrored machine winds it up instead
      }
      sel = { type: 'joint', i: sk.joints.length - 1 };
    } else if (tool === 'pull') {
      if (!hits.length) { undo.pop(); o.status.textContent = 'Clique sobre um corpo para prender a corda da equipe.'; return; }
      // ~40 people × 200 N; stroke limited by how far the rope point can come down
      sk.joints.push({ kind: 'pull', a: hits.at(-1)!, at: s, force: 8000, stroke: Math.min(2, Math.max(0.1, s[1] - 0.1)) });
      sel = { type: 'joint', i: sk.joints.length - 1 };
    }
    changed();
  });

  o.canvas.addEventListener('pointermove', (e) => {
    if (pan) {
      const dx = (e.clientX - pan.x) / v.s;
      const dy = (e.clientY - pan.y) / v.s;
      bounds = { x0: bounds.x0 - dx, x1: bounds.x1 - dx, y0: bounds.y0 + dy, y1: bounds.y1 + dy };
      pan = { x: e.clientX, y: e.clientY };
      return draw();
    }
    if (!drag) return;
    drag.to = snap(eventPos(e), drag.moving);
    if (drag.moving) for (const q of drag.moving) (q[0] = drag.to[0]), (q[1] = drag.to[1]);
    for (const f of drag.followers ?? []) {
      const b = sk.bodies[f.body];
      const at: Vec = b.kind === 'rod' ? [b.a[0] + f.t * (b.b[0] - b.a[0]), b.a[1] + f.t * (b.b[1] - b.a[1])] : [b.c[0] + f.off[0], b.c[1] + f.off[1]];
      for (const q of f.group) (q[0] = at[0]), (q[1] = at[1]);
    }
    draw();
  });

  o.canvas.addEventListener('pointerup', () => {
    pan = undefined;
    if (!drag) return;
    const { from, to, moving } = drag;
    drag = undefined;
    if (moving) return changed();
    if (d2(from, to) < 0.05) return draw();
    snapshot();
    if (tool === 'rod') {
      sk.bodies.push({ kind: 'rod', name: `barra ${sk.bodies.filter((b) => b.kind === 'rod').length + 1}`, a: from, b: to, mass: Math.round(12 * d2(from, to)) });
      sel = { type: 'body', i: sk.bodies.length - 1 };
    } else if (tool === 'spring') {
      const a = bodiesAt(from).at(-1);
      if (a === undefined) { undo.pop(); o.status.textContent = 'Comece a mola sobre um corpo e termine na âncora fixa.'; return draw(); }
      sk.joints.push({ kind: 'spring', a, at: from, anchor: to, k: 7000, rest: +(0.5 * d2(from, to)).toFixed(2) });
      sel = { type: 'joint', i: sk.joints.length - 1 };
    } else {
      const a = bodiesAt(from).at(-1) ?? 'ground';
      const b = bodiesAt(to).at(-1) ?? 'ground';
      if (a === b) { undo.pop(); o.status.textContent = 'A corda precisa ligar dois corpos diferentes (ou um corpo ao chão).'; return draw(); }
      // keep body (not ground) on side a
      sk.joints.push(a === 'ground' ? { kind: 'rope', a: b as number, pa: to, b: a, pb: from } : { kind: 'rope', a, pa: from, b, pb: to });
      sel = { type: 'joint', i: sk.joints.length - 1 };
    }
    changed();
  });

  // wheel zoom anchored at the cursor: scaling the bounds about the cursor's world point keeps it still on screen
  o.canvas.addEventListener('wheel', (e) => {
    if (!sk || !o.active()) return;
    e.preventDefault();
    const r = o.canvas.getBoundingClientRect();
    const vv = view(o.canvas.clientWidth, cssHeight(o.canvas), bounds);
    const [px, py] = vv.W(e.clientX - r.left, e.clientY - r.top);
    const f = Math.exp(e.deltaY * 0.0015);
    const span = (bounds.x1 - bounds.x0) * f;
    if (span < 0.5 || span > 2000) return;
    bounds = { x0: px + (bounds.x0 - px) * f, x1: px + (bounds.x1 - px) * f, y0: py + (bounds.y0 - py) * f, y1: py + (bounds.y1 - py) * f };
    if (o.canvas.dataset.mode === 'edit') draw();
    else o.onView();
  }, { passive: false });
  o.canvas.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());

  // frame the whole sketch (plus the ground near it) with a 1 m margin
  function fit() {
    const pts = allPoints(sk);
    const rad = Math.max(0, ...sk.bodies.map((b) => (b.kind === 'disk' ? b.r : 0)));
    if (!pts.length) return void (bounds = { ...FREE_BOUNDS });
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const m = 1 + rad;
    bounds = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(0, ...ys) - 0.5, y1: Math.max(...ys) + m };
  }

  window.addEventListener('keydown', (e) => {
    if (o.canvas.dataset.mode !== 'edit' || (e.target as HTMLElement).closest('input,select,textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) (e.preventDefault(), deleteSel());
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && undo.length) {
      sk = JSON.parse(undo.pop()!);
      sel = undefined;
      changed();
    }
  });

  function deleteSel() {
    if (!sel) return;
    snapshot();
    if (sel.type === 'body') removeBody(sk, sel.i);
    else sk.joints.splice(sel.i, 1);
    sel = undefined;
    changed();
  }

  // --- side panel ---
  o.toolbar.innerHTML = TOOLS.map(([t, label, help]) => `<button type="button" class="ghost" data-tool="${t}" title="${help}">${label}</button>`).join('');
  o.toolbar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).dataset.tool as Tool | undefined;
    if (!t) return;
    tool = t;
    o.toolbar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    o.status.textContent = TOOLS.find((x) => x[0] === t)![2];
  });

  const field = (label: string, key: string, value: number, step = 'any') =>
    `<label>${label}<input type="number" step="${step}" data-k="${key}" value="${+value.toPrecision(6)}"></label>`;

  function renderPanel() {
    let html = '';
    if (sel?.type === 'body') {
      const b = sk.bodies[sel.i];
      html += `<label>Nome<input type="text" data-k="name" value="${b.name.replace(/"/g, '&quot;')}"></label>` + field('Massa (kg)', 'mass', b.mass);
      if (b.kind === 'rod') html += `<p class="muted">Comprimento: ${d2(b.a, b.b).toFixed(2)} m</p>`;
      else html += field('Raio (m)', 'r', b.r) + `<label>Papel<select data-k="role">
        ${[['', 'nenhum'], ['projectile', 'projétil'], ['counterweight', 'contrapeso']].map(([v, l]) => `<option value="${v}" ${(b.role ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    } else if (sel?.type === 'joint') {
      const j = sk.joints[sel.i];
      const names: Record<SJoint['kind'], string> = { pin: 'Pino', weld: 'Solda', rope: 'Corda', slider: 'Trilho', pull: 'Equipe (tração)', stop: 'Apoio (pode descolar)', foot: 'Pé com espinhos (não escorrega, pode descolar)',
        spike: 'Espetos no ar (cravam onde tocarem o chão)', roller: 'Rolete fixo (a barra desliza sobre ele)', floor: 'Chão sob este ponto', spring: 'Mola até uma âncora fixa', cam: 'Tambor em espiral (corda do contrapeso)' };
      html += `<p><b>${names[j.kind]}</b>${'b' in j && j.b === 'ground' ? ' (preso ao chão)' : ''}</p>`;
      if (j.kind === 'pin') html += field('Atrito μ', 'mu', j.mu ?? 0) + field('Raio do eixo (m)', 'radius', j.radius ?? 0.05) +
        field('Eixo: inclinação (°, 3D)', 'pitch', j.pitch ?? 0) + field('Eixo: guinada (°, 3D)', 'yaw', j.yaw ?? 0) +
        `<p class="muted">Inclinação ergue um lado do eixo; guinada o gira em planta. Só valem na Vista 3D: o eixo deixa de ser perpendicular ao plano e o braço gira num plano torto (máximo ±45°).</p>`;
      if (j.kind === 'pull') html += field('Força da equipe (N)', 'force', j.force) + field('Curso do puxão (m)', 'stroke', j.stroke) +
        `<p class="muted">Uma pessoa puxa ~200–300 N num puxão curto. Energia = força × curso = ${((j.force * j.stroke) / 1000).toFixed(1)} kJ.</p>`;
      if (j.kind === 'rope') html += `<p class="muted">Comprimento: ${d2(j.pa, j.pb).toFixed(2)} m</p>`;
      if (j.kind === 'floor') html += field('Altura do chão (m)', 'y', j.y) + field('Atrito ao pousar e deslizar (μ; rodas: Crr)', 'mu', j.mu ?? 0);
      if (j.kind === 'slider' || j.kind === 'roller') html += field('Resistência ao rolamento (Crr)', 'mu', j.mu ?? 0) +
        `<p class="muted">Força contra o rolamento = Crr × carga. Rodas duras em trilho ≈ 0,001–0,005; madeira ou skate ≈ 0,005–0,02.</p>`;
      if (j.kind === 'spring') html += field('Rigidez k (N/m)', 'k', j.k) + field('Comprimento livre (m)', 'rest', j.rest) +
        `<p class="muted">Agora: ${d2(j.at, j.anchor).toFixed(2)} m. Energia armazenada: ${((0.5 * j.k * Math.max(0, d2(j.at, j.anchor) - j.rest) ** 2) / 1000).toFixed(2)} kJ.</p>`;
      if (j.kind === 'cam') html += field('Raio inicial (m)', 'r0', j.r0) + field('Raio final (m)', 'r1', j.r1) + field('Giro da espiral (rad)', 'span', j.span) +
        field('Altura da polia (m, 0 = sem)', 'over', j.over?.[1] ?? 0) +
        `<p class="muted">A corda desenrola ${((j.span * (j.r0 + j.r1)) / 2).toFixed(2)} m até o raio final.</p>`;
    }
    if (sel) html += `<button type="button" class="ghost" data-act="delete">Apagar seleção</button>`;
    html += `<h2>Disparo</h2>` + field('Ângulo de liberação (°)', 'g.releaseDeg', sk.releaseDeg) + field('Densidade do ar', 'g.airDensity', sk.airDensity) +
      field('Coef. de arrasto Cd', 'g.dragCd', sk.dragCd) + field('Atrito na calha μ', 'g.troughMu', sk.troughMu);
    o.panel.innerHTML = html;
    validate();
  }

  o.panel.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k;
    if (!k) return;
    snapshot();
    const num = Number(el.value);
    if (k.startsWith('g.')) {
      if (Number.isFinite(num)) (sk as unknown as Record<string, number>)[k.slice(2)] = num;
    } else if (sel?.type === 'body') {
      const b = sk.bodies[sel.i];
      if (k === 'name') b.name = el.value.slice(0, 40);
      else if (k === 'role' && b.kind === 'disk') {
        if (el.value === 'projectile') sk.bodies.forEach((x) => x.kind === 'disk' && x.role === 'projectile' && delete x.role);
        if (el.value) b.role = el.value as Role; else delete b.role;
      } else if (Number.isFinite(num) && num > 0) (b as unknown as Record<string, number>)[k] = num;
    } else if (sel?.type === 'joint') {
      const j = sk.joints[sel.i];
      if (j.kind === 'pin' && (k === 'pitch' || k === 'yaw') && Number.isFinite(num)) {
        if (num) j[k] = Math.max(-45, Math.min(45, num));
        else delete j[k];
      } else if (j.kind === 'pin' && Number.isFinite(num) && num >= 0) j[k as 'mu' | 'radius'] = num;
      if (j.kind === 'pull' && Number.isFinite(num) && num > 0) j[k as 'force' | 'stroke'] = num;
      if ((j.kind === 'floor' || j.kind === 'slider' || j.kind === 'roller') && k === 'mu' && Number.isFinite(num) && num >= 0) {
        if (num) j.mu = Math.min(1, num);
        else delete j.mu;
      } else if (j.kind === 'floor' && Number.isFinite(num)) j.y = num;
      if (j.kind === 'spring' && Number.isFinite(num) && num > 0) j[k as 'k' | 'rest'] = num;
      if (j.kind === 'cam' && Number.isFinite(num)) {
        if (k === 'over') { if (num > j.at[1]) j.over = [j.at[0] - j.r0, num]; else delete j.over; } // pulley above the drum, over its back side
        else if (num > 0) {
          j[k as 'r0' | 'r1' | 'span'] = num;
          if (k === 'r0' && j.over) j.over = [j.at[0] - j.r0, j.over[1]];
        }
      }
    }
    changed();
  });
  o.panel.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.act === 'delete') deleteSel();
  });

  function validate() {
    try {
      const { dof, redundant } = analyze(compile(sk));
      const msg = dof <= 0 ? '⚠ Travado: o mecanismo não consegue se mover.' : `✓ ${dof} grau${dof > 1 ? 's' : ''} de liberdade.`;
      o.status.textContent = msg + (redundant > 0 ? ` ${redundant} restrição(ões) redundante(s): o motor tolera, mas as forças nessas juntas ficam ambíguas.` : '');
      return dof > 0;
    } catch (err) {
      o.status.textContent = '⚠ ' + (err as Error).message;
      return false;
    }
  }

  return {
    set(next: Sketch) { sk = next; sel = undefined; undo.length = 0; fit(); draw(); renderPanel(); },
    fit() { fit(); draw(); },
    bounds: () => bounds,
    get: () => sk,
    draw: () => sk && draw(),
    validate,
  };
}
