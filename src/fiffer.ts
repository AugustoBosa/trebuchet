import type { Body, Joint, Mechanism, Vec } from './physics/model';
import type { Params } from './presets';

// Fiffer ("First in Fright", Trey Greer's team, Punkin Chunkin): a counterweight ramp hinged behind the axle, a
// two-link scissor between the ramp's end and a fixed hanger, and a rigid connector from the scissor's knee to the
// arm's short end. Dimensions are those of the inventors' own simulator (github.com/treygreer/treb,
// first_in_fright_2012/2013.py): the cocked pose is solved from the same constraints (link sum, scissor angle ω = 10°,
// 5 ft of counterweight drop), so the link lengths and the connector length come out as theirs.
// The arm is bent (its short arm sits at an angle β off the long arm), so it is two bodies welded together.
// ponytail: the beam's cross-section taper and the machine frame's mass (fixed, so irrelevant) are folded into the
// arm's mass and inertia; rods are drawn centered on their center of mass, so a few cm off where the part really is.
const FT = 0.3048, IN = 0.0254, LB = 0.45359, PINE = 521;
const rot = (a: number): Vec => [Math.cos(a), Math.sin(a)];
const at = (p: Vec, a: number, r: number): Vec => [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec) => Math.hypot(a[0], a[1]);
const ang = (a: Vec) => Math.atan2(a[1], a[0]);
// the intersection of two circles lying counterclockwise from the vector c1→c2 (as the inventors' code picks it)
function circles(c1: Vec, r1: number, c2: Vec, r2: number): Vec {
  const d = len(sub(c2, c1));
  return at(c1, Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)) + ang(sub(c2, c1)), r1);
}

interface Part { m: number; c: Vec; I: number } // mass, center (world), inertia about its own center
const rect = (m: number, l: number, w: number, c: Vec): Part => ({ m, c, I: (m * (l * l + w * w)) / 12 });
const disk = (m: number, r: number, c: Vec): Part => ({ m, c, I: (m * r * r) / 2 });
function merge(parts: Part[]): Part {
  const m = parts.reduce((s, p) => s + p.m, 0);
  const c: Vec = [parts.reduce((s, p) => s + p.m * p.c[0], 0) / m, parts.reduce((s, p) => s + p.m * p.c[1], 0) / m];
  return { m, c, I: parts.reduce((s, p) => s + p.I + p.m * len(sub(p.c, c)) ** 2, 0) };
}

export const FIFFER = {
  link_sum: 5.587 * FT, hanger: [11.38508 * FT, -2 * FT] as Vec, hinge: [(8 / 12) * FT, -4 * FT] as Vec,
  ramp: 11 * FT, omega: (10 * Math.PI) / 180, drop: 5 * FT, cwArm: 10.41 * FT,
  cwInertia4581: 3.516e6 * LB * IN * IN, // kg·m² for 4581 lb (lb·in² read as in the inventors' code)
  cwMass4581: 4581 * LB,
  armLength: 9 * FT, // long arm: axle to the sling hook; the slide sits that far below the axle
  slingLB: 1.7, // sling mass, lumped into the projectile
};
const F0 = FIFFER;

// x: the machine's extras in lb (the 2026 update: 11 oz sling, a 9.56 lb release pin, 9 oz of hardware at the tip)
export function buildFiffer(p: Params, x: { slingLB?: number; pinLB?: number; tipLB?: number } = {}): Mechanism {
  const { slingLB = F0.slingLB, pinLB = 9, tipLB = 0 } = x;
  const F = FIFFER, drop = F.drop, alpha = Math.PI / 2;
  // ---- cocked pose, in the inventors' frame: axle at the origin, slide 9 ft below ----
  const restCw = circles(F.hanger, F.link_sum, F.hinge, F.ramp);
  const cwY = restCw[1] + drop;
  const cockedCw: Vec = [F.hinge[0] + Math.sqrt(F.ramp ** 2 - (cwY - F.hinge[1]) ** 2), cwY];
  const d = len(sub(F.hanger, cockedCw)), s = F.link_sum, co = Math.cos(F.omega);
  const root = Math.sqrt(s * s * co * co + 2 * d * d * co - s * s + 2 * d * d);
  const sol1 = -(root - s * co - s) / (2 * co + 2), sol2 = (root + s * co + s) / (2 * co + 2);
  const upperL = Math.min(sol1, sol2), lowerL = Math.max(sol1, sol2);
  const knee = circles(cockedCw, lowerL, F.hanger, upperL);
  const upperAng = ang(sub(knee, F.hanger));
  const restUpperAng = ang(sub(restCw, F.hanger));
  const restKnee = at(F.hanger, restUpperAng, upperL);
  // the short arm's end lies on an ellipse (foci: axle and cocked knee) whose "string" is the axle→rest-knee distance
  const a = len(restKnee) / 2, f = len(knee) / 2, e = f / a;
  const connL = (a * (1 - e * e)) / (1 - e * Math.cos(ang([-knee[0], -knee[1]]) - upperAng));
  const shortEnd = at(knee, upperAng, connL);
  const shortL = len(shortEnd);
  const beta = Math.PI + alpha - ang(shortEnd);

  // ---- parts, in the inventors' world; shifted up so the slide is at y = 0 (pumpkin center at its radius) ----
  const D = -9 * FT; // slide height
  const armPt = (x: number, y: number): Vec => [-y, x]; // arm frame (long arm toward −x) → world, θ = 90°
  const tip: Vec = [0, D];
  const L = F.armLength, t0 = 3.125 * IN, d0 = 6.625 * IN, t1 = 5.25 * IN, d1 = 10.25 * IN;
  let bm = 0, bx = 0, bI = 0; // the tapered pine beam, x from −L to 0
  const N = 200, dx = L / N, thick = (x: number) => t0 * (-x / L) + t1 * (1 + x / L), depth = (x: number) => d0 * (-x / L) + d1 * (1 + x / L);
  for (let k = 0; k < N; k++) { const x = -L + (k + 0.5) * dx, w = PINE * thick(x) * depth(x) * dx; bm += w; bx += w * x; }
  bx /= bm;
  for (let k = 0; k < N; k++) { const x = -L + (k + 0.5) * dx; bI += PINE * thick(x) * dx * ((x - bx) ** 2 * depth(x) + depth(x) ** 3 / 12); }
  const longArm = merge([
    { m: bm, c: armPt(bx, 0), I: bI },
    rect(63 * LB, 27.5 * IN, 8 * IN, armPt(-6.25 * IN, 0)), // plate over the axle
    disk(pinLB * LB, 6 * IN, armPt(-L, 0)), // release pin at the tip
    ...(tipLB ? [disk(tipLB * LB, 0, armPt(-L, 0))] : []),
  ]);
  const sa: Vec = [-Math.cos(beta), Math.sin(beta)]; // short-arm direction in the arm frame
  const shortArm = merge([
    rect(53 * LB, 18.99 * IN, 8 * IN, armPt(15 * IN * sa[0], 15 * IN * sa[1])),
    disk(1 * LB, 2 * IN, shortEnd),
  ]);
  const RAMP_KG = 5; // the original's ramp is massless (folded into the counterweight): a light beam keeps the solver well-posed
  const cwM = p.cwMass - RAMP_KG;
  const rampAng = ang(sub(cockedCw, F.hinge));
  const cwC = at(F.hinge, rampAng, F.cwArm);
  const ramp = rect(RAMP_KG, F.ramp, 4 * IN, at(F.hinge, rampAng, F.ramp / 2));
  const lowerAng = ang(sub(cockedCw, knee)) - Math.PI; // frame x-axis points from the ramp's end to the knee
  const lower = merge([rect(104 * LB, lowerL, 6 * IN, at(cockedCw, lowerAng, lowerL / 2)), disk(106 * LB, 3 * IN, knee)]);
  const upper = rect(116 * LB, upperL, 6 * IN, at(F.hanger, upperAng, upperL / 2));
  const connAng = ang(sub(knee, shortEnd));
  // ponytail: the connector's 4 in stiffener sat 3 in off the rod's line in the original; here it is on the line
  // (the editor, the bending checks and the cards want every pin on its part's axis): the center of mass moves ~3.5 cm
  const connector = merge([
    rect(84.8 * LB, connL, 2 * IN, at(shortEnd, connAng, connL / 2)),
    rect(100 * LB, connL, 4 * IN, at(shortEnd, connAng, connL / 2)),
    rect(105 * LB, 2 * FT, 4 * IN, at(shortEnd, connAng, connL - FT)),
  ]);

  const up = (q: Vec): Vec => [q[0], q[1] - D + p.projRadius]; // the pumpkin's center rides the slide (their model), the engine wants it one radius above the ground
  const loc = (P: Part, angle: number, w: Vec): Vec => { const r = sub(w, P.c), c = Math.cos(-angle), sn = Math.sin(-angle); return [c * r[0] - sn * r[1], sn * r[0] + c * r[1]]; };
  // a rod is drawn centered on its center of mass: long enough that every pin of the part lies on it (the real part
  // ends at its last pin, so the drawn rod overhangs on the light side; its mass per length is a bit low there)
  const body = (name: string, P: Part, angle: number, pins: Vec[]): Body => ({ name, mass: P.m, inertia: P.I, pos: up(P.c), angle, shape: { kind: 'rod', length: 2 * Math.max(...pins.map((w) => Math.abs(loc(P, angle, w)[0]))) } });
  const armAng = Math.PI + alpha - 2 * Math.PI; // long arm points down; local x runs from the axle toward the tip
  const shortAng = ang(shortEnd);
  const r = p.projRadius;
  const bodies: Body[] = [
    body('braço', longArm, armAng, [[0, 0], tip]),
    { name: 'projétil', mass: p.projMass + slingLB * LB, inertia: 0.4 * p.projMass * r * r, pos: [p.slingLength, r], angle: 0, shape: { kind: 'disk', radius: r } },
    body('braço curto', shortArm, shortAng, [[0, 0], shortEnd]),
    { name: 'contrapeso', mass: cwM, inertia: F.cwInertia4581 * (p.cwMass / F.cwMass4581), pos: up(cwC), angle: rampAng, shape: { kind: 'disk', radius: 1.3 * FT } },
    body('elo superior', upper, upperAng, [F.hanger, knee]),
    body('elo inferior', lower, lowerAng, [cockedCw, knee]),
    body('biela', connector, connAng, [shortEnd, knee]),
    body('rampa', ramp, rampAng, [F.hinge, cockedCw]),
  ];
  const ARM = 0, PROJ = 1, SHORT = 2, CW = 3, UP = 4, LOW = 5, CON = 6, RAMP = 7;
  const A = (i: number) => bodies[i].angle;
    const joints: Joint[] = [
    { kind: 'rope', a: PROJ, pa: [0, 0], b: ARM, pb: loc(longArm, armAng, tip), length: p.slingLength }, // sling
    { kind: 'floor', a: PROJ, pa: [0, 0], y: r, mu: p.troughMu }, // the slide
    { kind: 'pin', a: ARM, pa: loc(longArm, armAng, [0, 0]), b: 'ground', pb: up([0, 0]), friction: { mu: p.axleMu, radius: p.axleRadius } },
    { kind: 'weld', a: SHORT, pa: loc(shortArm, shortAng, [0, 0]), b: ARM, pb: loc(longArm, armAng, [0, 0]), angle: A(SHORT) - A(ARM) }, // both arms meet at the axle
    { kind: 'pin', a: RAMP, pa: loc(ramp, rampAng, F.hinge), b: 'ground', pb: up(F.hinge) }, // hinge
    { kind: 'pin', a: UP, pa: loc(upper, upperAng, F.hanger), b: 'ground', pb: up(F.hanger) }, // hanger
    { kind: 'pin', a: UP, pa: loc(upper, upperAng, knee), b: LOW, pb: loc(lower, lowerAng, knee) }, // scissor's knee
    { kind: 'pin', a: RAMP, pa: loc(ramp, rampAng, cockedCw), b: LOW, pb: loc(lower, lowerAng, cockedCw) }, // ramp's end
    { kind: 'weld', a: CW, pa: [0, 0], b: RAMP, pb: loc(ramp, rampAng, cwC), angle: 0 }, // the counterweight box sits on the ramp
    { kind: 'pin', a: CON, pa: loc(connector, connAng, shortEnd), b: SHORT, pb: loc(shortArm, shortAng, shortEnd) },
    { kind: 'pin', a: CON, pa: loc(connector, connAng, knee), b: UP, pb: loc(upper, upperAng, knee) },
  ];
  return {
    bodies, joints, projectile: PROJ, counterweight: CW, sling: 0, axle: 2,
    releaseAngle: (p.releaseDeg * Math.PI) / 180,
    air: { density: p.airDensity, cd: p.dragCd },
  };
}
