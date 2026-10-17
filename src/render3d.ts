import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { css, cssHeight } from './charts';
import { camRope } from './physics/constraints';
import { twist } from './physics3d/constraints3';
import { add, rotate, type BodyRef, type Mechanism3, type V3 } from './physics3d/model3';
import type { Result3 } from './physics3d/solver3';
import type { Bounds } from './render';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const world = (q: Float64Array, b: BodyRef, local: V3): V3 => (b === 'ground' ? local : add([q[7 * b], q[7 * b + 1], q[7 * b + 2]], rotate(q, 7 * b + 3, local)));
// a draggable point of the design; axes = which world axes the gizmo offers ('xy', 'z', 'xyz')
export interface Handle3 { p: V3; axes: string; label: string }
export interface HandleEvents { move: (i: number, p: V3) => void; end: () => void; select?: (label: string | undefined) => void }

const flightPos = (r: Result3, t: number) => r.flight[Math.min(r.flight.length - 1, Math.round((t - r.release!.t) / 1e-3))];

// 3D view of a shot from the 3D solver: planar parts get a depth (twin A-frame across the axle, rails), orbit camera.
export function createView3d(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 5000);
  const controls = new OrbitControls(camera, canvas);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-2, 4, 3);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 1.8), sun);

  const solid = { ink: new THREE.MeshStandardMaterial({ roughness: 0.8 }), muted: new THREE.MeshStandardMaterial({ roughness: 0.9 }), accent: new THREE.MeshStandardMaterial({ roughness: 0.5 }) };
  const wire = { ink: new THREE.LineBasicMaterial(), muted: new THREE.LineBasicMaterial(), accent: new THREE.LineBasicMaterial() };
  const flightMat = new THREE.LineDashedMaterial({ dashSize: 1, gapSize: 1 });
  const nodeMat = new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.85 }); // nodes stay visible inside parts
  let built: { m: Mechanism3; r: Result3; group: THREE.Group; update: (q: Float64Array, t: number) => void } | undefined;
  let span0 = 0;

  // --- node editing: spheres on the design's points, a translate gizmo on the selected one
  const tc = new TransformControls(camera, canvas);
  const proxy = new THREE.Object3D();
  const nodeGroup = new THREE.Group();
  const handleRoot = new THREE.Group(); // turned with an aimed machine: node coordinates stay in the machine's frame
  handleRoot.add(proxy, nodeGroup);
  scene.add(handleRoot, tc.getHelper());
  tc.setSpace('local'); // arrows along the machine's axes (the proxy's parent turns with the aim)
  tc.setTranslationSnap(0.01);
  let handles: Handle3[] = [];
  let events: HandleEvents | undefined;
  let sel = -1;
  tc.addEventListener('change', render);
  tc.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (!e.value) events?.end();
  });
  tc.addEventListener('objectChange', () => sel >= 0 && events?.move(sel, [proxy.position.x, proxy.position.y, proxy.position.z]));
  const select = (i: number) => {
    sel = i;
    if (i < 0) tc.detach();
    else {
      proxy.position.set(...handles[i].p);
      tc.attach(proxy);
      tc.showX = handles[i].axes.includes('x');
      tc.showY = handles[i].axes.includes('y');
      tc.showZ = handles[i].axes.includes('z');
    }
    events?.select?.(handles[i]?.label);
    render();
  };
  const ray = new THREE.Raycaster();
  canvas.addEventListener('pointerdown', (e) => {
    if (!handles.length || tc.axis) return; // on the gizmo: TransformControls handles it
    const rc = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(nodeGroup.children)[0];
    if (hit) select(nodeGroup.children.indexOf(hit.object));
  });

  // straight line whose ends move every frame
  function seg(mat: THREE.LineBasicMaterial, group: THREE.Group) {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(6), 3);
    g.setAttribute('position', pos);
    const obj = new THREE.Line(g, mat);
    obj.frustumCulled = false;
    group.add(obj);
    return (a: V3, b: V3) => (pos.setXYZ(0, ...a), pos.setXYZ(1, ...b), (pos.needsUpdate = true), (obj.visible = true));
  }
  // square beam from a to b
  function beam(a: V3, b: V3, th: number, mat: THREE.Material, group: THREE.Group) {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.length(), th, th), mat);
    mesh.position.copy(A.addScaledVector(d, 0.5));
    mesh.quaternion.setFromUnitVectors(X, d.normalize());
    group.add(mesh);
    return mesh;
  }

  function build(m: Mechanism3, r: Result3, b: Bounds) {
    const span = b.x1 - b.x0, th = 0.012 * span, W = 0.08 * span;
    const group = new THREE.Group();
    const ups: ((q: Float64Array) => void)[] = [];
    const q0 = r.frames[0].q;

    for (const j of m.joints) {
      if (j.kind === 'pin' && j.b === 'ground') {
        const [px, py, pz] = j.pb;
        for (const z of [pz - W, pz + W]) {
          beam([px - py * 0.5, 0, z], [px, py, z], th, solid.muted, group);
          beam([px + py * 0.5, 0, z], [px, py, z], th, solid.muted, group);
        }
        beam([px, py, pz - W], [px, py, pz + W], 0.7 * th, solid.muted, group); // axle
      } else if (j.kind === 'slider') {
        const k = span / Math.hypot(...j.dir);
        for (const z of [-0.6 * W, 0.6 * W])
          beam([j.origin[0] - k * j.dir[0], Math.max(0, j.origin[1] - k * j.dir[1]), j.origin[2] + z], [j.origin[0] + k * j.dir[0], j.origin[1] + k * j.dir[1], j.origin[2] + z], 0.4 * th, solid.muted, group);
      } else if ((j.kind === 'pin' || j.kind === 'weld') && j.b !== 'ground' && m.bodies[j.a].shape.kind === 'disk' && (j.pa[0] || j.pa[1])) {
        const set = seg(wire.ink, group); // hanger of a hinged counterweight
        const jb = j.b, pb = j.pb;
        ups.push((q) => set(world(q, j.a, [0, 0, 0]), world(q, jb, pb)));
      } else if (j.kind === 'roller') {
        beam([j.at[0], 0, j.at[2]], j.at, th, solid.muted, group);
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.006 * span, 0.006 * span, 2 * W), solid.muted);
        roll.rotation.x = Math.PI / 2;
        roll.position.set(...j.at);
        group.add(roll);
      } else if (j.kind === 'floor' && m.bodies[j.a].shape.kind === 'rod') {
        for (const z of [-0.6 * W, 0.6 * W]) beam([b.x0 - span, j.y, z], [b.x1 + span, j.y, z], 0.4 * th, solid.muted, group); // track the wheels land on
      } else if (j.kind === 'cam') {
        // drum at its current radius; rope off its back side, over the pulley (if any) and down to the counterweight
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3 * th, 32), solid.muted);
        drum.quaternion.setFromUnitVectors(Y, new THREE.Vector3(...j.axis));
        group.add(drum);
        const toDrum = seg(wire.ink, group), down = seg(wire.ink, group);
        if (j.over) beam([j.over[0], 0, j.over[2]], j.over, th, solid.muted, group); // pulley post
        ups.push((q) => {
          const hub = world(q, j.b, j.hub);
          const { r: rad } = camRope(j, (j.dir ?? 1) * (j.theta0 - twist({ q, v: q }, j.b, 'ground', j.axis))); // twist reads only q
          drum.position.set(...hub);
          drum.scale.set(rad, 1, rad);
          const cw = world(q, j.a, [0, 0, 0]);
          const side: V3 = [hub[0] - (j.dir ?? 1) * rad, hub[1], hub[2]];
          if (j.over) toDrum(side, j.over), down([cw[0], j.over[1], cw[2]], cw);
          else toDrum(side, cw), down(cw, cw);
        });
      } else if (j.kind === 'rope' && j !== m.joints[m.sling]) {
        const set = seg(wire.muted, group);
        ups.push((q) => set(world(q, j.a, j.pa), world(q, j.b, j.pb)));
      }
    }
    for (const sp of m.springs ?? []) {
      const set = seg(wire.accent, group);
      ups.push((q) => set(world(q, sp.body, sp.local), sp.anchor));
    }
    for (const pl of m.pulls ?? []) {
      const set = seg(wire.accent, group); // crew rope
      ups.push((q) => {
        const a = world(q, pl.body, pl.local);
        set(a, [a[0], 0, a[2]]);
      });
    }

    m.bodies.forEach((bd, i) => {
      if (i === m.projectile) return;
      const mesh = bd.shape.kind === 'rod'
        ? new THREE.Mesh(new THREE.BoxGeometry(bd.shape.length, 1.4 * th, 1.4 * th), solid.ink)
        : new THREE.Mesh(new THREE.SphereGeometry(bd.shape.radius, 24, 16), solid.ink);
      group.add(mesh);
      ups.push((q) => (mesh.position.set(q[7 * i], q[7 * i + 1], q[7 * i + 2]), mesh.quaternion.set(q[7 * i + 4], q[7 * i + 5], q[7 * i + 6], q[7 * i + 3])));
    });
    const ps = m.bodies[m.projectile].shape;
    const proj = new THREE.Mesh(new THREE.SphereGeometry(Math.max(ps.kind === 'disk' ? ps.radius : 0.1, 0.004 * span), 20, 14), solid.accent);
    group.add(proj);
    const slingSet = seg(wire.accent, group);
    const sling = m.joints[m.sling];
    const slingObj = group.children.at(-1)!;

    const update = (q: Float64Array, t: number) => {
      ups.forEach((u) => u(q));
      const released = r.release && t >= r.release.t;
      const P = 7 * m.projectile;
      const p: V3 = released ? flightPos(r, t) : [q[P], q[P + 1], q[P + 2]];
      proj.position.set(...p);
      slingObj.visible = !released && sling.kind === 'rope';
      if (slingObj.visible && sling.kind === 'rope') {
        const other = sling.a === m.projectile ? { b: sling.b, p: sling.pb } : { b: sling.a as number | 'ground', p: sling.pa };
        slingSet(world(q, other.b, other.p), p);
        slingObj.visible = true;
      }
    };
    update(q0, 0);
    group.rotation.y = m.aim ?? 0; // aimed machine: it and its flight turn together, the ground grid doesn't
    const box = new THREE.Box3().setFromObject(group); // the machine alone: grid and flight come after
    const size = Math.max(2 * span, 1.2 * r.range + span);
    const step = 10 ** Math.round(Math.log10(span / 4)); // ~1 m for full-size machines
    const grid = new THREE.GridHelper(size, Math.min(200, Math.round(size / step)), css('--line'), css('--line'));
    grid.position.x = b.x0 - 0.5 * span + size / 2;
    const root = new THREE.Group();
    root.add(group, grid);
    if (m.aim) { // the target line (world x), so the aim reads at a glance
      const tl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(b.x0, 0.002 * span, 0), new THREE.Vector3(b.x0 + size, 0.002 * span, 0)]), wire.muted);
      root.add(tl);
    }
    handleRoot.rotation.y = m.aim ?? 0;

    if (r.release) {
      const g = new THREE.BufferGeometry().setFromPoints(r.flight.map((p) => new THREE.Vector3(...p)));
      const line = new THREE.Line(g, flightMat);
      line.computeLineDistances();
      group.add(line);
      flightMat.dashSize = flightMat.gapSize = 0.01 * span;
    }

    // recenter on every build, keeping the user's orbit angle (not while a node is being edited: the view would slide
    // under the cursor); reset the distance only if the machine changed size a lot
    if (sel >= 0 && span0) return { m, r, group: root, update };
    const c = box.getCenter(new THREE.Vector3());
    const off = camera.position.clone().sub(controls.target);
    if (!span0 || span / span0 > 1.5 || span0 / span > 1.5) off.set(-0.3 * span, 0.15 * span, 0.8 * span), (span0 = span);
    controls.target.copy(c);
    camera.position.copy(c).add(off);
    controls.update();
    return { m, r, group: root, update };
  }

  return {
    draw(m: Mechanism3, r: Result3, t: number, b: Bounds) {
      const w = canvas.clientWidth, h = cssHeight(canvas);
      if (!w) return; // hidden
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x !== w || size.y !== h) {
        renderer.setSize(w, h, false);
        canvas.style.height = `${h}px`;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      scene.background = new THREE.Color(css('--bg'));
      for (const k of ['ink', 'muted', 'accent'] as const) solid[k].color.set(css(`--${k}`)), wire[k].color.set(css(`--${k}`));
      flightMat.color.set(css('--accent'));
      nodeMat.color.set(css('--accent'));
      if (built?.m !== m || built.r !== r) {
        if (built) scene.remove(built.group), built.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        built = build(m, r, b);
        scene.add(built.group);
      }
      const dtF = r.frames.length > 1 ? r.frames[1].t - r.frames[0].t : 1;
      built.update(r.frames[Math.min(r.frames.length - 1, Math.round(t / dtF))].q, t);
      render();
    },
    // show draggable nodes (undefined: none, e.g. while a shot plays). Keeps the selection when the list keeps its length.
    setHandles(list: Handle3[] | undefined, on?: HandleEvents) {
      const keep = list && list.length === handles.length ? sel : -1;
      handles = list ?? [];
      events = on;
      nodeGroup.children.forEach((o) => (o as THREE.Mesh).geometry.dispose());
      nodeGroup.clear();
      const rad = 0.015 * (span0 || 10);
      for (const h of handles) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 12), nodeMat);
        s.renderOrder = 1;
        s.position.set(...h.p);
        nodeGroup.add(s);
      }
      if (keep >= 0 && !tc.dragging) proxy.position.set(...handles[keep].p); // snap the gizmo to where the design really went (clamped values)
      if (keep !== sel || keep < 0) select(keep);
      else render();
    },
  };
}
export type View3d = ReturnType<typeof createView3d>;
