import { point } from './physics/constraints';
import type { Body, Joint, Mechanism, Vec } from './physics/model';
import { initialState } from './physics/solver';

// Parameters a user edits; each preset turns them into a Mechanism.
export const defaults = {
  pivotHeight: 3, // m
  longArm: 5, // pivot → sling hook
  shortArm: 1.25, // pivot → counterweight / rope attachment
  armMass: 60, // kg, uniform beam
  cwMass: 1000,
  hingeLength: 1.2, // hinged: hinge → counterweight center
  crewForce: 8000, // N, traction: total crew pull (~40 people × 200 N)
  pullStroke: 2, // m, traction: how far the crew can pull the rope down
  projMass: 10,
  projRadius: 0.1,
  slingLength: 4.5,
  releaseDeg: 45, // projectile velocity angle at release
  airDensity: 1.225,
  dragCd: 0.47, // sphere
  axleMu: 0.1, // journal friction coeff (greased iron on wood ~0.1)
  axleRadius: 0.05, // m
  troughMu: 0.3, // projectile sliding in the trough
  cockDeg: 45, // whipper: long arm angle above horizontal; walking arm: leg angle off the arm (tuning string)
  legLength: 0.52, // walking arm: axle → spiked foot
  legMass: 0.6, // walking arm: the triangular leg
  pulleyHeight: 6, // MURLIN: fixed pulley at the top of the frame the counterweight hangs from
  camStart: 0.8, // MURLIN / wheel: drum radius where the rope starts unwinding (m)
  camEnd: 0.2, // ... and where it ends, when the counterweight lands
  axleLift: 0.6, // F2K: how far above the track the axle wheels start
  rollerOffset: 0.5, // F2K: fixed roller under the arm, this far from the axle toward the long end
  springK: 7000, // spring trebuchet: total stiffness of the springs (N/m)
  springRest: 1.5, // ... and their unstretched length (m), anchored on the ground under the short arm
};
export type Params = typeof defaults;
export type Kind = 'fixed' | 'hinged' | 'floating' | 'traction' | 'whipper' | 'walking' | 'murlin' | 'wheel' | 'f2k' | 'fet' | 'ka' | 'faka' | 'spring';

const BASE: (keyof Params)[] = ['pivotHeight', 'longArm', 'shortArm', 'armMass'];
const SHOT: (keyof Params)[] = ['projMass', 'projRadius', 'slingLength', 'releaseDeg', 'airDensity', 'dragCd', 'axleMu', 'axleRadius', 'troughMu'];

// preset: starting values for kinds whose geometry differs from the shared defaults
export const KINDS: Record<Kind, { label: string; info: string; fields: (keyof Params)[]; preset?: Partial<Params> }> = {
  fixed: {
    label: 'Contrapeso fixo',
    info: 'O contrapeso é rígido no braço e cai num arco. Parte da energia vira balanço e rotação do contrapeso, e a eficiência fica em torno de 55–60%.',
    fields: [...BASE, 'cwMass', ...SHOT],
  },
  hinged: {
    label: 'Contrapeso articulado',
    info: 'O contrapeso pende de uma articulação e cai quase na vertical, o que tira menos energia do braço. Foi o grande salto medieval (séc. XII–XIII).',
    fields: [...BASE, 'cwMass', 'hingeLength', ...SHOT],
  },
  floating: {
    label: 'Floating arm',
    info: 'Design moderno: o contrapeso desce numa guia vertical e o eixo rola num trilho horizontal. Quase toda a queda vira energia útil.',
    fields: [...BASE, 'cwMass', ...SHOT],
  },
  traction: {
    label: 'Tração humana',
    info: 'O antecessor (China, séc. IV a.C. → Europa, séc. VI): uma equipe puxa cordas presas ao braço curto. A energia vem do trabalho da equipe, força × curso.',
    fields: [...BASE, 'crewForce', 'pullStroke', ...SHOT],
  },
  whipper: {
    label: 'Whipper',
    info: 'Variante moderna do articulado: armado com o braço longo apontando para a frente e o contrapeso deitado sobre o braço, acima do eixo. O braço tomba à frente, passa por baixo do eixo e dá a volta (~270° de giro no padrão, contra ~125° do articulado), e o contrapeso cai de cima do eixo até abaixo dele: mais energia pelo mesmo peso. A funda afrouxa e reestica com trancos, e é difícil de ajustar. Pede eixo mais alto que o braço longo. Geometria reconstruída de descrições de construtores (sem desenhos publicados).',
    fields: [...BASE, 'cwMass', 'hingeLength', 'cockDeg', ...SHOT],
    // reconstructed from build descriptions (no published drawings): 5:1 arm ratio, axle above the long arm's reach
    preset: { pivotHeight: 5, longArm: 4, shortArm: 0.8, armMass: 50, hingeLength: 2, slingLength: 3.5, cockDeg: 45 },
  },
  walking: {
    label: 'Walking arm',
    info: 'Design de 2015 (J. Stapleton): sem estrutura, só o braço e uma perna triangular com espinhos. Armado, fica em pé sobre a ponta do braço longo, contrapeso no topo, com a perna pendurada à frente, presa num ângulo por uma corda de ajuste e com os espinhos no ar. Solto, tomba inteiro para a frente; os espinhos cravam onde tocam o chão, a corda afrouxa e o braço chicoteia por cima da perna plantada: a máquina "anda". Medidas das instruções do próprio autor (máquina do recorde leve de 2018: bola de 85 g a 81 m); ângulo da perna, funda e soltura ajustados pelo otimizador. O modelo dá ~54 m neste ajuste com folga e até ~68 m no limite (contrapeso raspando o chão na soltura, que é como o autor recomenda ajustar). A diferença restante pode vir do projétil, que no real parte de uma plataforma sobre o braço (aqui parte do chão), da plataforma de lançamento (+5 cm de queda) e do arrasto real da bola.',
    fields: ['longArm', 'shortArm', 'armMass', 'legLength', 'legMass', 'cwMass', 'cockDeg', ...SHOT],
    // Stapleton's Instructables (the 2018 lightweight record machine), inches → m: finger 20", counterweight
    // 17.5 lb centered ~17.5" behind the axle, leg 20.5", 1/4" axle bolt, racquetball topped up with water to 3 oz
    preset: {
      longArm: 0.508, shortArm: 0.445, armMass: 0.6, legLength: 0.52, legMass: 0.6, cwMass: 7.94,
      // leg angle, sling, release: best point that still works ±2°/±3 cm/±3° around it (~54 m). The optimizer,
      // free inside the 41" rule, picks leg ≈ 0.53 m and counterweight ≈ 0.44 m by itself (Stapleton's own numbers)
      // and reaches ~68 m, but only with the counterweight grazing the ground at release
      projMass: 0.085, projRadius: 0.0286, slingLength: 0.53, releaseDeg: 44, cockDeg: 30, axleRadius: 0.0032,
    },
  },
  murlin: {
    label: 'MURLIN',
    info: 'Design moderno (L. Vance, "Multi-Radius Linear Nodes"): o contrapeso pende de uma polia no alto da estrutura e a corda vai enrolada no eixo do braço sobre "nós" de raio decrescente. No começo o raio grande dá torque para arrancar o braço; no fim o raio pequeno deixa o braço girar rápido enquanto o contrapeso quase para, e quase toda a energia fica no braço. A polia deixa o contrapeso cair de bem acima do eixo. Aqui os nós viram uma espiral contínua (raio linear do início ao fim) e o contrapeso cai na vertical (no real, braço e contrapeso giram em planos diferentes, sem colidir). As plantas do autor não são públicas: geometria reconstruída, braço com metade do articulado padrão.',
    fields: [...BASE, 'pulleyHeight', 'camStart', 'camEnd', 'cwMass', ...SHOT],
    // drum ≤ half the long arm, end radius ≥ 0.1 m (rope can't wind tighter than the hub); pulley, sling and
    // release from this project's optimizer at those radii (≈318 m vs 225 m for the default hinged with a 5 m arm)
    preset: { longArm: 2.5, shortArm: 0.5, armMass: 30, pulleyHeight: 4.3, camStart: 1.25, camEnd: 0.1, slingLength: 3.8, releaseDeg: 35 },
  },
  wheel: {
    label: 'Roda (wheel)',
    info: 'Parente do MURLIN sem polia: a corda do contrapeso enrola direto num tambor de raio variável no eixo do braço, e o contrapeso pende embaixo dele. Mesma ideia de "câmbio" (raio grande arranca, raio pequeno acelera), mas a queda fica limitada à altura do eixo. Tambor modelado como espiral de raio linear; contrapeso cai na vertical.',
    fields: [...BASE, 'camStart', 'camEnd', 'cwMass', ...SHOT],
    preset: { longArm: 2.5, shortArm: 0.5, armMass: 30, camStart: 0.9, camEnd: 0.1, slingLength: 3.8, releaseDeg: 42 }, // optimizer, same bounds as MURLIN
  },
  f2k: {
    label: 'F2K',
    info: 'Floating Axle Trebuchet 2000: um floating arm cujas rodas do eixo começam erguidas acima do trilho. No início o braço se apoia num rolete fixo e gira sobre ele enquanto o contrapeso desce na guia; quando as rodas pousam no trilho (com tranco), segue como floating arm. Ganha queda extra do contrapeso e alcance; o pouso custa eficiência, e quanto depende da geometria: com o rolete a 0,5 m (padrão) o tranco leva ~13% da energia, com o rolete a 1 m o pouso é suave e a eficiência passa a do floating arm. Só o princípio é documentado (The Hurl): posição do rolete e altura inicial reconstruídas.',
    fields: [...BASE, 'axleLift', 'rollerOffset', 'cwMass', ...SHOT],
    // the floating arm's default geometry, so the two compare like for like
    preset: { pivotHeight: defaults.pivotHeight, longArm: defaults.longArm, shortArm: defaults.shortArm, armMass: defaults.armMass, slingLength: defaults.slingLength, releaseDeg: defaults.releaseDeg, axleLift: defaults.axleLift, rollerOffset: defaults.rollerOffset },
  },
  fet: {
    label: 'FET (tudo flutua)',
    info: 'Floating Everything Trebuchet: um floating arm sem a guia vertical do contrapeso. Eixo rola no trilho e o contrapeso pende livre da ponta do braço curto; como nada empurra o conjunto na horizontal, o contrapeso pesado cai quase na vertical sozinho, e o braço leve é que se desloca. Mais compacto que o floating arm; no real, mais sujeito a descarrilar.',
    fields: [...BASE, 'cwMass', ...SHOT],
  },
  ka: {
    label: 'King Arthur',
    info: 'Variante moderna do articulado, "super escorada": armado com o braço longo quase na vertical para baixo e a haste do contrapeso em pé sobre a ponta do braço curto, travada nele. Ao soltar, o contrapeso tomba do alto: a queda é muito maior que a do articulado comum com a mesma estrutura, e pouco contrapeso joga longe. Difícil de armar e de ajustar. Armado aqui com a haste 2° à frente da vertical; ângulo do braço = quanto a ponta fica atrás da vertical.',
    fields: [...BASE, 'cwMass', 'hingeLength', 'cockDeg', ...SHOT],
    // the hinged's frame (short arm, hanger) raised to fit the hanging long arm; sling/release/arm angle from this
    // project's optimizer with that frame fixed (≈384 m, η ≈ 58 %, vs 225 m and 79 % for the default hinged)
    preset: { pivotHeight: 5.3, cockDeg: 6, slingLength: 6.1, releaseDeg: 38, hingeLength: defaults.hingeLength, shortArm: defaults.shortArm, longArm: defaults.longArm },
  },
  faka: {
    label: 'FAKA (King Arthur flutuante)',
    info: 'Floating Axle King Arthur (C. Macomber, 2006): o King Arthur com o eixo sobre rodas, livre para rolar para a frente e para trás num trilho no alto da estrutura. Junta a queda enorme do King Arthur com a eficiência do eixo flutuante. No real, nada absorve a energia que sobra: as rodas batem nos batentes e o braço pode descarrilar se o ajuste estiver errado (aqui o trilho não tem fim; no ajuste padrão o eixo rola ~1,3 m).',
    fields: [...BASE, 'cwMass', 'hingeLength', 'cockDeg', ...SHOT],
    // King Arthur's frame; sling/release/arm angle re-optimized (≈499 m, η ≈ 85 %; the axle rolls ~1.3 m)
    preset: { pivotHeight: 5.3, cockDeg: 37, slingLength: 6.2, releaseDeg: 39, hingeLength: defaults.hingeLength, shortArm: defaults.shortArm, longArm: defaults.longArm },
  },
  spring: {
    label: 'Mola',
    info: 'Molas presas na ponta do braço curto e ancoradas no chão puxam o braço para baixo, no lugar do contrapeso. A energia elástica é ½k·x², e sem um contrapeso pesado para acelerar junto, a máquina fica leve e rápida. Molas sem massa no modelo (no real, parte da energia vai para acelerar a própria mola, e elas cansam e quebram).',
    fields: [...BASE, 'springK', 'springRest', ...SHOT],
  },
};

export const defaultsFor = (kind: Kind): Params => ({ ...defaults, ...KINDS[kind].preset });

const STONE = 2500; // kg/m³, counterweight drawn as a stone block of this density

// Cocked pose. Classic: long arm points back-down (tip on the ground if it reaches), short arm up front.
// Whipper: long arm points forward, cockDeg above horizontal; the counterweight lies on the arm above the axle.
// Walking arm: standing upright on the long arm's end, counterweight on top; axle height = long arm.
export function geometry(p: Params, kind: Kind = 'fixed') {
  const { longArm: L1, shortArm: L2 } = p;
  const tilt = (p.cockDeg * Math.PI) / 180;
  const h = kind === 'walking' ? L1 : kind === 'f2k' ? p.pivotHeight + p.axleLift : p.pivotHeight;
  const th = kind === 'whipper' ? tilt : kind === 'walking' ? -Math.PI / 2 : kind === 'ka' || kind === 'faka' ? -Math.PI / 2 - tilt : -Math.PI + Math.asin(Math.min(h / L1, 0.95));
  const u: Vec = [Math.cos(th), Math.sin(th)];
  return {
    th,
    u,
    pivot: [0, h] as Vec,
    tip: [L1 * u[0], h + L1 * u[1]] as Vec,
    shortTip: [-L2 * u[0], h - L2 * u[1]] as Vec,
  };
}

export function build(kind: Kind, p: Params): Mechanism {
  const { longArm: L1, shortArm: L2 } = p;
  const { th, u, pivot, tip, shortTip } = geometry(p, kind);
  const d = (L1 - L2) / 2; // arm COM offset from pivot, along the long arm
  const r = p.projRadius;
  const dy = tip[1] - r;
  // Classic machines start with the stone in the trough; a whipper's raised tip lets it hang in the sling.
  const hanging = kind === 'whipper' && p.slingLength < dy;
  if (!hanging && p.slingLength <= Math.abs(dy)) throw new Error('Funda curta demais para alcançar o chão');
  const cwR = Math.cbrt(p.cwMass / STONE / ((4 / 3) * Math.PI));

  const bodies: Body[] = [
    {
      name: 'braço',
      mass: p.armMass,
      inertia: (p.armMass * (L1 + L2) ** 2) / 12,
      pos: [pivot[0] + d * u[0], pivot[1] + d * u[1]],
      angle: th,
      shape: { kind: 'rod', length: L1 + L2 },
    },
    {
      name: 'projétil',
      mass: p.projMass,
      inertia: 0.4 * p.projMass * r * r,
      pos: hanging ? [tip[0], tip[1] - p.slingLength] : [tip[0] + Math.sqrt(p.slingLength ** 2 - dy * dy), r],
      angle: 0,
      shape: { kind: 'disk', radius: r },
    },
  ];
  const ARM = 0;
  const PROJ = 1;
  const local = { pivot: [-d, 0] as Vec, tip: [L1 - d, 0] as Vec, short: [-L2 - d, 0] as Vec };
  const axleFriction = { mu: p.axleMu, radius: p.axleRadius };
  const joints: Joint[] = [{ kind: 'rope', a: PROJ, pa: [0, 0], b: ARM, pb: local.tip, length: p.slingLength }]; // sling
  joints.push({ kind: 'floor', a: PROJ, pa: [0, 0], y: r, mu: p.troughMu }); // trough (starts open if the stone hangs)
  const m: Mechanism = {
    bodies,
    joints,
    projectile: PROJ,
    sling: 0,
    axle: joints.length, // the next joint pushed is the axle (pin or rolling track)
    releaseAngle: (p.releaseDeg * Math.PI) / 180,
    air: { density: p.airDensity, cd: p.dragCd },
  };
  const addCW = (pos: Vec) => {
    bodies.push({ name: 'contrapeso', mass: p.cwMass, inertia: 0.5 * p.cwMass * cwR * cwR, pos, angle: kind === 'fixed' || kind === 'walking' ? th : 0, shape: { kind: 'disk', radius: cwR } }); // welded kinds start aligned with the arm
    m.counterweight = bodies.length - 1;
    return m.counterweight;
  };

  if (kind === 'floating' || kind === 'fet') {
    joints.push({ kind: 'slider', a: ARM, pa: local.pivot, origin: pivot, dir: [1, 0] }); // axle rolls on a horizontal track
    const cw = addCW(shortTip);
    joints.push({ kind: 'pin', a: cw, pa: [0, 0], b: ARM, pb: local.short });
    if (kind === 'floating') joints.push({ kind: 'slider', a: cw, pa: [0, 0], origin: shortTip, dir: [0, 1] }); // vertical guide
    // ponytail: rollers are frictionless; add rolling resistance to 'slider' if it matters
    return m;
  }

  if (kind === 'f2k') {
    // floating arm whose axle starts lifted: the arm rests on a fixed roller instead, until the wheels land on the track
    if (p.axleLift <= 0) throw new Error('No F2K as rodas começam acima do trilho: altura inicial > 0');
    if (p.rollerOffset <= 0 || p.rollerOffset >= L1 - 0.1) throw new Error('O rolete precisa ficar sob o braço longo, entre o eixo e a ponta');
    const roller: Vec = [pivot[0] + p.rollerOffset * u[0], pivot[1] + p.rollerOffset * u[1]];
    // the arm lies on top of the roller: pick the rod face whose normal points up
    joints.push({ kind: 'roller', a: ARM, at: roller, side: u[0] <= 0 ? -1 : 1 });
    m.axle = joints.length;
    joints.push({ kind: 'floor', a: ARM, pa: local.pivot, y: p.pivotHeight }); // wheels on the track (start open)
    const cw = addCW(shortTip);
    joints.push({ kind: 'pin', a: cw, pa: [0, 0], b: ARM, pb: local.short });
    joints.push({ kind: 'slider', a: cw, pa: [0, 0], origin: shortTip, dir: [0, 1] }); // vertical guide
    return m;
  }

  if (kind === 'murlin' || kind === 'wheel') {
    joints.push({ kind: 'pin', a: ARM, pa: local.pivot, b: 'ground', pb: pivot, friction: axleFriction });
    // MURLIN: rope leaves the drum's back side straight up to the pulley and the counterweight hangs from the pulley's
    // far side, clear of the drum. Wheel: it hangs from the drum's back side. Starts high, lands on the ground.
    const x = kind === 'murlin' ? -(p.camStart + cwR + 0.1) : -p.camStart;
    const top = kind === 'murlin' ? p.pulleyHeight : pivot[1];
    if (kind === 'murlin' && p.pulleyHeight <= pivot[1]) throw new Error('A polia precisa ficar acima do eixo');
    const y0 = top - 0.3 - cwR;
    const drop = y0 - cwR;
    if (drop < 0.1) throw new Error('Sem espaço para o contrapeso cair: suba o eixo (ou a polia)');
    const cw = addCW([x, y0]);
    // spiral sized so the rope runs out exactly as the counterweight lands
    const cam: Joint = { kind: 'cam', a: cw, b: ARM, hub: local.pivot, theta0: th, r0: p.camStart, r1: p.camEnd, span: (2 * drop) / (p.camStart + p.camEnd), length: 0, ...(kind === 'murlin' ? { over: [-p.camStart, p.pulleyHeight] as Vec } : {}) };
    joints.push(cam, { kind: 'floor', a: cw, pa: [0, 0], y: cwR });
    // length = whatever makes the rope exactly taut in the cocked pose
    cam.length = (kind === 'murlin' ? p.pulleyHeight + Math.hypot(pivot[0] - cam.over![0], pivot[1] - cam.over![1]) : pivot[1]) - y0;
    return m;
  }

  if (kind === 'faka') joints.push({ kind: 'slider', a: ARM, pa: local.pivot, origin: pivot, dir: [1, 0] }); // axle trucks roll on a track
  else if (kind !== 'walking') joints.push({ kind: 'pin', a: ARM, pa: local.pivot, b: 'ground', pb: pivot, friction: axleFriction }); // axle
  if (kind === 'fixed') {
    const cw = addCW(shortTip);
    joints.push({ kind: 'weld', a: cw, pa: [0, 0], b: ARM, pb: local.short, angle: 0 });
  } else if (kind === 'walking') {
    // Rest (Stapleton's instructions): standing on the arm's finger end, counterweight on top; the leg (the triangle
    // seen edge-on) hangs from the axle cockDeg forward of the arm's lower half, held there by the tuning string, its
    // spikes in the air. Released, the whole machine topples forward about the finger; the spikes bite where they
    // land and the arm whips over the planted leg. Only gravity acts (tipped 1° past balance if needed).
    const tilt = (p.cockDeg * Math.PI) / 180;
    const dir: Vec = [Math.sin(tilt), -Math.cos(tilt)]; // leg direction from the axle
    const spikes: Vec = [pivot[0] + p.legLength * dir[0], pivot[1] + p.legLength * dir[1]];
    if (spikes[1] < 0.02) throw new Error('A perna já toca o chão na posição armada: diminua a perna ou aumente o ângulo dela');
    const half = p.legLength / 2;
    bodies.push({ name: 'perna', mass: p.legMass, inertia: (p.legMass * p.legLength ** 2) / 12, pos: [pivot[0] + half * dir[0], pivot[1] + half * dir[1]], angle: Math.atan2(dir[1], dir[0]), shape: { kind: 'rod', length: p.legLength } });
    const LEG = bodies.length - 1;
    const cw = addCW(shortTip);
    const machine = [ARM, cw, LEG].map((i) => bodies[i]);
    const M = machine.reduce((t, b) => t + b.mass, 0);
    const com = machine.reduce((c, b) => [c[0] + (b.mass * b.pos[0]) / M, c[1] + (b.mass * b.pos[1]) / M] as Vec, [0, 0] as Vec);
    const lean = Math.atan2(com[0] - tip[0], com[1]); // how far the center of mass already sits ahead of the finger
    const nudge = Math.max(0, Math.PI / 180 - lean); // clockwise about the finger
    const c = Math.cos(-nudge);
    const sn = Math.sin(-nudge);
    const turn = (q: Vec): Vec => [tip[0] + c * (q[0] - tip[0]) - sn * (q[1] - tip[1]), tip[1] + sn * (q[0] - tip[0]) + c * (q[1] - tip[1])];
    for (const b of machine) (b.pos = turn(b.pos)), (b.angle -= nudge);
    bodies[PROJ].pos = [tip[0] + Math.sqrt(p.slingLength ** 2 - r * r), r]; // on the ground ahead of the finger
    joints.push({ kind: 'pin', a: ARM, pa: local.pivot, b: LEG, pb: [-half, 0], friction: axleFriction }); // axle on top of the leg
    joints.push({ kind: 'spike', a: LEG, pa: [half, 0] }); // spikes: bite where they land, then no slip, may lift
    joints.push({ kind: 'foot', a: ARM, pa: local.tip, at: [tip[0], 0] }); // finger stuck in the turf until it lifts
    joints.push({ kind: 'weld', a: cw, pa: [0, 0], b: ARM, pb: local.short, angle: 0 }); // counterweight bolted on
    // after the throw the machine topples over and the counterweight lands. Set 2 cm (the solver's ground tolerance) below
    // the surface: the author tunes it to scrape the ground AT release, and a rigid floor there would steal energy from the shot
    joints.push({ kind: 'floor', a: cw, pa: [0, 0], y: cwR - 0.02 });
    // tuning string: from the leg to the arm above the axle (both 40% of the leg out), taut at rest; slackens later
    const legPt: Vec = [-half + 0.4 * p.legLength, 0];
    const armPt: Vec = [-d - 0.4 * p.legLength, 0];
    const st = initialState(m);
    const A = point(st, LEG, legPt).p, B = point(st, ARM, armPt).p;
    joints.push({ kind: 'rope', a: LEG, pa: legPt, b: ARM, pb: armPt, length: Math.hypot(A[0] - B[0], A[1] - B[1]) });
  } else if (kind === 'whipper') {
    // the long arm swings under the axle: it must clear the ground
    if (p.pivotHeight - L1 < 0.1) throw new Error('No whipper o braço longo passa por baixo do eixo: suba o eixo acima do comprimento do braço longo');
    if (p.hingeLength <= cwR) throw new Error('Haste curta demais: o contrapeso não alcança o topo do braço');
    // In arm coordinates (x toward the tip, y up off the arm): hinge at (−L2, 0); the counterweight lies on
    // the arm, its center one radius above it, at hanger distance from the hinge → usually right over the axle.
    const xc = -L2 + Math.sqrt(p.hingeLength ** 2 - cwR * cwR);
    const nrm: Vec = [-u[1], u[0]];
    const cw = addCW([pivot[0] + xc * u[0] + cwR * nrm[0], pivot[1] + xc * u[1] + cwR * nrm[1]]);
    bodies[cw].angle = th; // aligned with the arm, so the stop angle below is 0
    joints.push({ kind: 'pin', a: cw, pa: [-L2 - xc, -cwR], b: ARM, pb: local.short }); // hanger
    joints.push({ kind: 'stop', a: cw, b: ARM, angle: 0 }); // lies on the arm: can swing up off it, not through it
  } else if (kind === 'ka' || kind === 'faka') {
    // counterweight standing on the hinge, 2° forward of upright so it topples toward the throw
    const lean = (2 * Math.PI) / 180;
    const cw = addCW([shortTip[0] + p.hingeLength * Math.sin(lean), shortTip[1] + p.hingeLength * Math.cos(lean)]);
    joints.push({ kind: 'pin', a: cw, pa: [-p.hingeLength * Math.sin(lean), -p.hingeLength * Math.cos(lean)], b: ARM, pb: local.short });
  } else if (kind === 'hinged') {
    if (shortTip[1] - p.hingeLength < cwR) throw new Error('Contrapeso articulado bate no chão — encurte a articulação');
    const cw = addCW([shortTip[0], shortTip[1] - p.hingeLength]);
    joints.push({ kind: 'pin', a: cw, pa: [0, p.hingeLength], b: ARM, pb: local.short });
  } else if (kind === 'spring') {
    if (p.springRest >= shortTip[1]) throw new Error('Mola frouxa já na posição armada: encurte o comprimento livre');
    m.springs = [{ body: ARM, local: local.short, anchor: [shortTip[0], 0], k: p.springK, rest: p.springRest }];
  } else {
    m.pulls = [{ body: ARM, local: local.short, force: p.crewForce, untilY: Math.max(0.3, shortTip[1] - p.pullStroke) }];
  }
  return m;
}
