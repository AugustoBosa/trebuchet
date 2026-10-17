// Mechanism = what gets saved/loaded. SI units: m, kg, s, rad.
export type Vec = [number, number];
export type BodyRef = number | 'ground';

export interface Body {
  name: string;
  mass: number;
  inertia: number; // about the body's own center of mass
  pos: Vec; // center of mass, world
  angle: number;
  shape: { kind: 'rod'; length: number } | { kind: 'disk'; radius: number };
}

// pa/pb are points in each body's local frame (for 'ground', world coords).
export type Joint =
  | { kind: 'pin'; a: number; pa: Vec; b: BodyRef; pb: Vec; friction?: { mu: number; radius: number } } // journal friction
  | { kind: 'weld'; a: number; pa: Vec; b: BodyRef; pb: Vec; angle: number } // keeps θa - θb = angle
  | { kind: 'rope'; a: number; pa: Vec; b: BodyRef; pb: Vec; length: number }
  | { kind: 'floor'; a: number; pa: Vec; y: number; mu?: number } // unilateral: point can lift off, never sink
  | { kind: 'slider'; a: number; pa: Vec; origin: Vec; dir: Vec; mu?: number } // point rides a fixed straight track (rollers); mu = rolling resistance Crr
  | { kind: 'stop'; a: number; b: BodyRef; angle: number } // unilateral: θa − θb ≥ angle (a part resting against another, e.g. a counterweight lying on the arm)
  | { kind: 'foot'; a: number; pa: Vec; at: Vec } // spiked foot: pinned to the ground point `at` (no slip) until it would have to pull down, then lifts off
  | { kind: 'spike'; a: number; pa: Vec } // spikes in the air: become a 'foot' wherever they first touch the ground
  | { kind: 'roller'; a: number; at: Vec; side: 1 | -1; mu?: number } // rod a rests on a fixed roller at `at`: slides over it freely, may lift off (side: which face of the rod touches)
  | Cam;

// Counterweight rope wound on a spiral drum fixed to body b (MURLIN nodes, wheel trebuchet). As b turns forward
// (clockwise; counterclockwise when dir = −1) by φ = dir·(theta0 − θb), the rope unwinds F(φ) = ∫r dφ, the radius going linearly r0 → r1 over `span` rad.
// Body a hangs from the rope straight down (from the pulley `over`, or from the drum itself if there is none).
// Taut rope:  (top − ya) + span_to_drum − F(φ) = length.  Unilateral like a rope: it pulls, or goes slack.
export interface Cam {
  kind: 'cam';
  a: number; // hanging counterweight
  b: number; // arm carrying the drum
  hub: Vec; // drum center, b's local frame
  theta0: number;
  r0: number;
  r1: number;
  span: number;
  over?: Vec; // fixed pulley (world)
  length: number;
  dir?: 1 | -1; // 1 (default): the arm turns clockwise and the rope leaves the drum's −x side; −1: mirrored machine
}

export interface Mechanism {
  bodies: Body[];
  joints: Joint[];
  projectile: number; // body index
  counterweight?: number; // body index; its potential-energy drop is the energy input
  pulls?: Pull[]; // crews pulling ropes straight down
  springs?: Spring[]; // stretched springs pulling body points toward ground anchors

  sling: number; // joint index released at launch
  axle: number; // joint index, reported as main structural load
  releaseAngle: number; // release when projectile velocity angle drops to this (rad above horizontal)
  air: { density: number; cd: number };
}

// A crew pulling a rope straight down at a body point, until that point has come down to untilY (end of stroke).
export interface Pull {
  body: number;
  local: Vec;
  force: number;
  untilY: number;
}

// Massless extension spring from a body point to a fixed anchor: pulls with k·(L − rest) while stretched, slack when shorter.
export interface Spring {
  body: number;
  local: Vec;
  anchor: Vec;
  k: number; // N/m
  rest: number; // m
}

export const G = 9.81;
