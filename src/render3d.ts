import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { css, cssHeight } from './charts';
import { camRope } from './physics/constraints';
import { twist } from './physics3d/constraints3';
import { add, rotate, type BodyRef, type Mechanism3, type V3 } from './physics3d/model3';
import type { Result3 } from './physics3d/solver3';
import type { Scatter } from './physics3d/dispersion';
import type { Sketch } from './sketch';
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
  const hlMat = new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.35 }); // the selected part
  let built: { m: Mechanism3; r: Result3; group: THREE.Group; machine: THREE.Group; update: (q: Float64Array, t: number) => void } | undefined;
  let span0 = 0;
  let shown: { q: Float64Array; t: number } | undefined; // the pose on screen
  const scatterGroup = new THREE.Group(); // landing points + 1σ/2σ ellipses (world frame, on the ground)
  scene.add(scatterGroup);

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
  // --- keyboard: the canvas takes focus. No node chosen: arrows pan, Shift+arrows turn (OrbitControls), + / − zoom,
  // 0 re-frames. N / Shift+N pick the next / previous node; then arrows move it in x and y, PageUp/PageDown in z
  // (5 cm, Shift: 1 cm), Enter commits (fires the shot for a preset), Esc lets go.
  canvas.tabIndex = 0;
  controls.keyRotateSpeed = 10; // ≈ 8° per press instead of < 1°
  let keyMoved = false;
  const commit = () => keyMoved && ((keyMoved = false), events?.end());
  const announce = (i: number) => {
    const h = handles[i], f = (v: number) => v.toFixed(2);
    events?.select?.(`${h.label} (x ${f(h.p[0])}, y ${f(h.p[1])}, z ${f(h.p[2])} m)`);
  };
  canvas.addEventListener('keydown', (e) => {
    const key = e.key;
    if ((key === 'n' || key === 'N') && handles.length) {
      e.preventDefault();
      const n = handles.length;
      select(key === 'N' ? (sel < 0 ? n - 1 : (sel + n - 1) % n) : (sel + 1) % n);
      return announce(sel);
    }
    if (sel >= 0) {
      const step = e.shiftKey ? 0.01 : 0.05;
      const d: V3 = [key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0, key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0, key === 'PageUp' ? step : key === 'PageDown' ? -step : 0];
      if (key === 'Enter' || key === 'Escape') {
        e.preventDefault();
        commit();
        if (key === 'Escape') select(-1);
        return;
      }
      if (!d[0] && !d[1] && !d[2]) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // the arrows move the node, not the camera
      const h = handles[sel], axis = d[0] ? 'x' : d[1] ? 'y' : 'z';
      if (!h.axes.includes(axis)) return void events?.select?.(`${h.label}: este nó não se move em ${axis}`);
      keyMoved = true;
      events?.move(sel, [h.p[0] + d[0], h.p[1] + d[1], h.p[2] + d[2]]);
      return announce(sel);
    }
    if (key === '+' || key === '=' || key === '-' || key === '0') {
      e.preventDefault();
      const off = camera.position.clone().sub(controls.target);
      if (key === '0') off.set(-0.3, 0.15, 0.8).multiplyScalar(span0 || 10);
      else off.multiplyScalar(key === '-' ? 1.2 : 1 / 1.2);
      camera.position.copy(controls.target).add(off);
      controls.update();
    }
  }, true); // capture: runs before OrbitControls' own key handler
  canvas.addEventListener('blur', commit);
  controls.listenToKeyEvents(canvas);

  const ray = new THREE.Raycaster();
  // building tools: a click lands on the work plane z = pickZ (snapped to a node within 12 px, else to the 5 cm grid)
  let pick: ((p: V3) => void) | undefined;
  let pickZ = 0;
  const planeGrid = new THREE.GridHelper(1, 1);
  planeGrid.visible = false;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ depthTest: false }));
  marker.visible = false;
  marker.renderOrder = 2;
  scene.add(planeGrid, marker);
  canvas.addEventListener('pointerdown', (e) => {
    const rc = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (pick && e.button === 0) {
      const near = handles.find((h) => {
        const s = new THREE.Vector3(...h.p).applyMatrix4(handleRoot.matrixWorld).project(camera);
        return Math.hypot(((s.x - ndc.x) * rc.width) / 2, ((s.y - ndc.y) * rc.height) / 2) < 12;
      });
      if (near) return pick(near.p);
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -pickZ), new THREE.Vector3());
      if (hit) pick([Math.round(hit.x / 0.05) * 0.05, Math.max(0, Math.round(hit.y / 0.05) * 0.05), pickZ]);
      return;
    }
    if (tc.axis) return; // on the gizmo: TransformControls handles it
    const hit = handles.length ? ray.intersectObjects(nodeGroup.children)[0] : undefined;
    if (hit) return select(nodeGroup.children.indexOf(hit.object));
    if (e.button === 0 && e.isPrimary) down = { x: e.clientX, y: e.clientY, ndc }; // a part click, unless it turns into an orbit drag
  });
  let down: { x: number; y: number; ndc: THREE.Vector2 } | undefined;
  let onPart: ((key: string | undefined) => void) | undefined;
  let hl = new Set<string>();
  canvas.addEventListener('pointercancel', () => (down = undefined));
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = undefined;
    if (!d || !onPart || !built?.r || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    ray.setFromCamera(d.ndc, camera);
    ray.params.Line = { threshold: 0.006 * (span0 || 10) };
    const hit = ray.intersectObjects(built.machine.children, false).find((h) => h.object.userData.key && h.object.visible);
    onPart(hit?.object.userData.key);
  });
  // selected part in the accent color (original material kept in userData to restore)
  function paint() {
    built?.machine.children.forEach((o) => {
      const obj = o as THREE.Mesh | THREE.Line;
      const key = o.userData.key as string | undefined;
      if (!key) return;
      o.userData.mat ??= obj.material;
      const isLine = (o as THREE.Line).isLine;
      obj.material = hl.has(key) ? (isLine ? wire.accent : hlMat) : o.userData.mat;
    });
  }

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

    // every object below carries the key of the part it draws (b:i, j:i, s:i, p:i): clicks find parts by it
    const tag = (n0: number, key: string) => group.children.slice(n0).forEach((o) => (o.userData.key = key));
    m.joints.forEach((j, ji) => {
      const n0 = group.children.length;
      drawJoint(j);
      tag(n0, `j:${ji}`);
    });
    function drawJoint(j: Mechanism3['joints'][number]) {
      if (j.kind === 'pin' && j.b === 'ground') {
        // axle along the pin's axis (tilted pins too), an A-frame under each end
        const ends = [-W, W].map((k): V3 => [j.pb[0] + k * j.axisB[0], j.pb[1] + k * j.axisB[1], j.pb[2] + k * j.axisB[2]]);
        for (const [x, y, z] of ends) {
          beam([x - y * 0.5, 0, z], [x, y, z], th, solid.muted, group);
          beam([x + y * 0.5, 0, z], [x, y, z], th, solid.muted, group);
        }
        beam(ends[0], ends[1], 0.7 * th, solid.muted, group); // axle
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
    (m.springs ?? []).forEach((sp, i) => {
      const set = seg(wire.accent, group);
      group.children.at(-1)!.userData.key = `s:${i}`;
      ups.push((q) => set(world(q, sp.body, sp.local), sp.anchor));
    });
    (m.pulls ?? []).forEach((pl, i) => {
      const set = seg(wire.accent, group); // crew rope
      group.children.at(-1)!.userData.key = `p:${i}`;
      ups.push((q) => {
        const a = world(q, pl.body, pl.local);
        set(a, [a[0], 0, a[2]]);
      });
    });

    m.bodies.forEach((bd, i) => {
      if (i === m.projectile) return;
      const mesh = bd.shape.kind === 'rod'
        ? new THREE.Mesh(new THREE.BoxGeometry(bd.shape.length, 1.4 * th, 1.4 * th), solid.ink)
        : new THREE.Mesh(new THREE.SphereGeometry(bd.shape.radius, 24, 16), solid.ink);
      mesh.userData.key = `b:${i}`;
      group.add(mesh);
      ups.push((q) => (mesh.position.set(q[7 * i], q[7 * i + 1], q[7 * i + 2]), mesh.quaternion.set(q[7 * i + 4], q[7 * i + 5], q[7 * i + 6], q[7 * i + 3])));
    });
    const ps = m.bodies[m.projectile].shape;
    const proj = new THREE.Mesh(new THREE.SphereGeometry(Math.max(ps.kind === 'disk' ? ps.radius : 0.1, 0.004 * span), 20, 14), solid.accent);
    proj.userData.key = `b:${m.projectile}`;
    group.add(proj);
    const slingSet = seg(wire.accent, group);
    const sling = m.joints[m.sling];
    const slingObj = group.children.at(-1)!;
    slingObj.userData.key = `j:${m.sling}`;

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
    if (sel >= 0 && span0) return { m, r, group: root, machine: group, update };
    const c = box.getCenter(new THREE.Vector3());
    const off = camera.position.clone().sub(controls.target);
    if (!span0 || span / span0 > 1.5 || span0 / span > 1.5) off.set(-0.3 * span, 0.15 * span, 0.8 * span), (span0 = span);
    controls.target.copy(c);
    camera.position.copy(c).add(off);
    controls.update();
    return { m, r, group: root, machine: group, update };
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
      hlMat.color.set(css('--accent'));
      hlMat.emissive.set(css('--accent'));
      if (built?.m !== m || built.r !== r) {
        if (built) scene.remove(built.group), built.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        built = build(m, r, b);
        scene.add(built.group);
        paint();
      }
      const dtF = r.frames.length > 1 ? r.frames[1].t - r.frames[0].t : 1;
      shown = { q: r.frames[Math.min(r.frames.length - 1, Math.round(t / dtF))].q, t };
      built.update(shown.q, t);
      render();
    },
    // The machine's solid parts in its cocked pose (stone in place), for CAD or a 3D printer: glTF binary in meters,
    // or binary STL in millimeters (STL has no units; CAD and slicers read mm). Ropes, flight path, grid, nodes left out.
    async exportModel(format: 'glb' | 'stl'): Promise<Blob | undefined> {
      if (!built?.r) return undefined; // a sketch still being built has no machine to export
      const keep = hl;
      hl = new Set(); // the file gets the parts' own colors, not the selection's
      paint();
      built.update(built.r.frames[0].q, 0);
      built.machine.updateMatrixWorld(true);
      const solid = new THREE.Group();
      built.machine.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const c = (o as THREE.Mesh).clone();
        c.matrixAutoUpdate = false;
        c.matrix.copy(o.matrixWorld);
        solid.add(c);
      });
      hl = keep;
      paint();
      if (shown) built.update(shown.q, shown.t), render(); // back to what was on screen
      if (format === 'stl') {
        solid.scale.setScalar(1000);
        solid.matrixAutoUpdate = true;
        solid.updateMatrixWorld(true);
        const data = new STLExporter().parse(solid, { binary: true });
        return new Blob([data.buffer as ArrayBuffer], { type: 'model/stl' });
      }
      const glb = await new GLTFExporter().parseAsync(solid, { binary: true });
      return new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
    },
    // A sketch that doesn't compile yet (still being built): its parts as drawn, no physics.
    drawSketch(sk: Sketch, b: Bounds) {
      if (built) scene.remove(built.group), built.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()), (built = undefined);
      const span = b.x1 - b.x0, th = 0.012 * span;
      const group = new THREE.Group();
      const z = (o: { z?: Partial<Record<string, number>> }, k: string) => o.z?.[k] ?? 0;
      for (const bd of sk.bodies) {
        if (bd.kind === 'rod') beam([bd.a[0], bd.a[1], z(bd, 'a')], [bd.b[0], bd.b[1], z(bd, 'b')], 1.4 * th, solid.ink, group);
        else {
          const s = new THREE.Mesh(new THREE.SphereGeometry(bd.r, 20, 14), bd.role === 'projectile' ? solid.accent : solid.ink);
          s.position.set(bd.c[0], bd.c[1], z(bd, 'c'));
          group.add(s);
        }
      }
      for (const j of sk.joints) {
        if (j.kind !== 'rope') continue;
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(j.pa[0], j.pa[1], z(j, 'pa')), new THREE.Vector3(j.pb[0], j.pb[1], z(j, 'pb'))]), wire.muted));
      }
      const size = 3 * span;
      const grid = new THREE.GridHelper(size, Math.round(size / 0.5), css('--line'), css('--line'));
      grid.position.x = (b.x0 + b.x1) / 2;
      const root = new THREE.Group();
      root.add(group, grid);
      built = { m: undefined as unknown as Mechanism3, r: undefined as unknown as Result3, group: root, machine: group, update: () => {} };
      scene.add(root);
      if (!span0) {
        const c = new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0);
        controls.target.copy(c);
        camera.position.set(c.x - 0.3 * span, c.y + 0.15 * span, 0.8 * span);
        controls.update();
        span0 = span;
      }
      render();
    },
    // building mode: clicks go to `on` (undefined: back to orbiting/moving nodes); the work plane z shows as a grid
    setPick(on: ((p: V3) => void) | undefined, z = 0, span = 10) {
      pick = on;
      pickZ = z;
      controls.enableRotate = !on; // left-drag would turn the view under the click; zoom and pan stay
      planeGrid.visible = !!on;
      if (on) {
        const g = new THREE.GridHelper(2 * span, Math.round((2 * span) / 0.5), css('--accent'), css('--line'));
        planeGrid.geometry.dispose();
        planeGrid.geometry = g.geometry;
        planeGrid.material = g.material;
        planeGrid.rotation.x = Math.PI / 2; // the vertical x–y plane at depth z
        planeGrid.position.set(controls.target.x, span, z);
        (planeGrid.material as THREE.Material).opacity = 0.35;
        (planeGrid.material as THREE.Material).transparent = true;
      }
      render();
    },
    // the first point of a two-click tool (rod, rope)
    setMarker(p: V3 | undefined, size = 0.05) {
      marker.visible = !!p;
      if (p) marker.position.set(...p), marker.scale.setScalar(size), (marker.material as THREE.MeshBasicMaterial).color.set(css('--accent'));
      render();
    },
    // landing scatter on the ground (undefined: clear); the camera flies over to it
    setScatter(pts: [number, number][] | undefined, s?: Scatter) {
      scatterGroup.children.forEach((o) => (o as THREE.Mesh).geometry.dispose());
      scatterGroup.clear();
      if (!pts || !s) return render();
      const lift = 0.02;
      const dots = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, lift, z))),
        new THREE.PointsMaterial({ color: css('--accent'), size: 6, sizeAttenuation: false }),
      );
      scatterGroup.add(dots);
      for (const k of [1, 2]) {
        const ring = Array.from({ length: 65 }, (_, i) => {
          const t = (i / 64) * 2 * Math.PI, u = k * s.axes[0] * Math.cos(t), v = k * s.axes[1] * Math.sin(t);
          return new THREE.Vector3(s.mean[0] + u * Math.cos(s.angle) - v * Math.sin(s.angle), lift, s.mean[1] + u * Math.sin(s.angle) + v * Math.cos(s.angle));
        });
        scatterGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), k === 1 ? wire.accent : wire.muted));
      }
      const c = new THREE.Vector3(s.mean[0], 0, s.mean[1]);
      const d = Math.max(8, 5 * s.axes[0]);
      controls.target.copy(c);
      camera.position.set(c.x - 0.5 * d, 0.9 * d, c.z + 0.6 * d);
      controls.update();
      render();
    },
    // a click on a part (no drag) reports its key; an empty spot reports undefined
    setPartListener(cb: ((key: string | undefined) => void) | undefined) {
      onPart = cb;
    },
    // keys of the selected part, drawn in the accent color
    highlight(keys: string[]) {
      hl = new Set(keys);
      paint();
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
