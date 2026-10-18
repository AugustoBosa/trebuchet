// Materials available in Brazil and the sections they are sold in, for the part card and the structural checks.
// Values are means (a test result, not a design value): structure.ts derives the design values from them.
//   Woods: IPT test sheets reproduced in "Madeira: uso sustentável na construção civil" (IPT/SVMA/SindusCon-SP, 2009),
//   air-dry (12–15 % moisture); Ipê and Cumaru: CIRAD Tropix sheets (2023, 12 %); Maçaranduba: EN 408 sheet (12 %).
//   est.: gaps filled from the same sheet (dry ≈ green × the species' dry/green ratio of another property) or, for
//   shear, NBR 7190's f_v0 ≈ 0,12·f_c0 (hardwoods).
//   Metals: typical yield (failure = permanent bend) and modulus; f_v = f_y/√3.

export type Shape = 'rect' | 'round' | 'rtube' | 'ctube';
// bar section b × h (h in the plane of the throw), round Ø d, tubes with wall t; rope / pin diameter d; F: a rope's
// breaking load from the maker's catalogue (N), overriding the estimate. Lengths in m.
export type PartSpec = { mat?: string; shape?: Shape; b?: number; h?: number; d?: number; t?: number; F?: number };

export interface BarMat {
  label: string;
  metal?: true;
  rho: number; // kg/m³
  fm: number; // bending strength (wood: modulus of rupture; metal: yield), Pa
  fc0: number; // compression along the grain (metal: yield), Pa
  fv: number; // shear, Pa
  E: number; // modulus of elasticity, Pa
  note?: string; // which values are estimates
}

const wood = (label: string, rho: number, fm: number, fc0: number, fv: number, E: number, note?: string): BarMat =>
  ({ label, rho, fm: fm * 1e6, fc0: fc0 * 1e6, fv: fv * 1e6, E: E * 1e6, ...(note ? { note } : {}) });
const metal = (label: string, rho: number, fy: number, E: number): BarMat =>
  ({ label, metal: true, rho, fm: fy * 1e6, fc0: fy * 1e6, fv: (fy / Math.sqrt(3)) * 1e6, E: E * 1e6 });

//                                                   ρ     fM     fc0    fv    E (MPa)
export const BAR_MATS: Record<string, BarMat> = {
  'euc-citriodora': wood('Eucalipto citriodora', 1040, 121.4, 62.8, 16.3, 13337),
  'euc-grandis': wood('Eucalipto grandis', 500, 75.6, 42.1, 5.1, 9689, 'fv est.'),
  'pinus-elliottii': wood('Pinus elliottii', 480, 69.6, 31.5, 5.8, 6463),
  'pinho-parana': wood('Pinho-do-paraná (araucária)', 550, 85.6, 41.4, 6.7, 10719),
  ipe: wood('Ipê', 1040, 166, 95, 11.4, 22760, 'fv est.'),
  cumaru: wood('Cumaru', 1070, 170, 103, 12.4, 26610, 'fv est.'),
  macaranduba: wood('Maçaranduba', 1100, 170, 89, 10.7, 24410, 'fv est.'),
  jatoba: wood('Jatobá', 960, 151.8, 82.2, 17.5, 14837),
  'pau-roxo': wood('Pau-roxo', 890, 184.5, 84.1, 14.9, 17721),
  sucupira: wood('Sucupira', 940, 186.1, 92.3, 13.6, 16060, 'fM est.'),
  goiabao: wood('Goiabão', 930, 155.5, 74, 18.1, 16377),
  itauba: wood('Itaúba', 960, 126.5, 68.4, 12.1, 14504),
  garapa: wood('Garapa', 830, 125.3, 54.3, 12.7, 14107),
  'angelim-vermelho': wood('Angelim-vermelho', 1090, 138.1, 80.9, 17.7, 14073),
  'angelim-pedra': wood('Angelim-pedra', 710, 109.3, 58.8, 7.1, 11572, 'fc0, fv est.'),
  cupiuba: wood('Cupiúba', 870, 122.1, 67.2, 8.1, 13690, 'fv est.'),
  curupixa: wood('Curupixá', 790, 126.3, 64.9, 14.4, 13925, 'fM est.'),
  'fava-orelha': wood('Fava-orelha-de-negro', 790, 113.1, 51.3, 14.3, 12386),
  piquiarana: wood('Piquiarana', 850, 103.6, 49.3, 10.1, 13258),
  'louro-vermelho': wood('Louro-vermelho', 770, 93.9, 49.5, 8.5, 10032),
  quaruba: wood('Quaruba (cambará-rosa)', 600, 91.2, 47.6, 10, 11180),
  tauari: wood('Tauari', 610, 88.8, 46.8, 8.5, 10591),
  cambara: wood('Cambará', 650, 87.3, 56.5, 7.8, 11023),
  jacareuba: wood('Jacareúba', 620, 80.4, 48.5, 9.1, 9277),
  cedrinho: wood('Cedrinho', 590, 80.2, 42.2, 7.4, 10395),
  cedrorana: wood('Cedrorana', 520, 77.8, 46.6, 7.2, 12847),
  amesclao: wood('Amesclão', 520, 76.3, 44.1, 8.2, 9611),
  'aco-1020': metal('Aço SAE 1020 (metalon, barra)', 7850, 210, 200000),
  'aco-a36': metal('Aço ASTM A36 (perfis, chapas)', 7850, 250, 200000),
  'aco-1045': metal('Aço SAE 1045 (eixos)', 7850, 310, 200000),
  'inox-304': metal('Inox 304', 7900, 205, 193000),
  'al-6063': metal('Alumínio 6063-T5 (perfis comuns)', 2700, 145, 69000),
  'al-6061': metal('Alumínio 6061-T6', 2700, 276, 69000),
};
export const METALS = Object.keys(BAR_MATS).filter((k) => BAR_MATS[k].metal);
// materials of designs saved before this table (EN 338 classes, S235/S355): the nearest one here
export const MAT_ALIAS: Record<string, string> = { c24: 'pinus-elliottii', d30: 'cupiuba', d40: 'euc-citriodora', al: 'al-6061', s235: 'aco-a36', s355: 'aco-1045' };
export const barMat = (k: string | undefined, fallback = 'cupiuba') => BAR_MATS[MAT_ALIAS[k ?? ''] ?? k ?? ''] ?? BAR_MATS[fallback];

// ropes: breaking load ≈ σᵤ·πd²/4 on the nominal diameter (12 mm: sisal ~9 kN, PP ~19 kN, nylon ~28 kN, steel 6×19 ~85 kN)
export const ROPE_MATS: Record<string, { label: string; su: number }> = {
  sisal: { label: 'Sisal', su: 80e6 },
  pp: { label: 'Polipropileno', su: 170e6 },
  poly: { label: 'Poliéster', su: 220e6 },
  nylon: { label: 'Nylon (poliamida)', su: 250e6 },
  steel: { label: 'Cabo de aço 6×19', su: 750e6 },
  dyneema: { label: 'Dyneema (UHMWPE)', su: 800e6 },
};

// --- sections ---
export interface Section {
  A: number; // area, m²
  I: number; // second moment in the plane of the throw (bending of the arm), m⁴
  W: number; // section modulus I / (h/2), m³
  Imin: number; // weakest axis (buckling of a strut), m⁴
  k: number; // τ_max = k·V/A
  bearing: number; // what a pin pushes on: solid width, or the two walls of a tube, m
  depth: number; // h, the dimension in the plane of the throw, m
}
export function section(s: PartSpec): Section {
  const b = s.b ?? 0.05, h = s.h ?? b, d = s.d ?? 0.05, t = Math.min(s.t ?? 0.002, (s.shape === 'ctube' ? d : Math.min(b, h)) / 2);
  switch (s.shape ?? 'rect') {
    case 'round': {
      const I = (Math.PI * d ** 4) / 64;
      return { A: (Math.PI * d * d) / 4, I, W: (2 * I) / d, Imin: I, k: 4 / 3, bearing: d, depth: d };
    }
    case 'ctube': {
      const di = d - 2 * t, I = (Math.PI * (d ** 4 - di ** 4)) / 64;
      return { A: (Math.PI * (d * d - di * di)) / 4, I, W: (2 * I) / d, Imin: I, k: 2, bearing: 2 * t, depth: d };
    }
    case 'rtube': {
      const bi = b - 2 * t, hi = h - 2 * t, A = b * h - bi * hi;
      const I = (b * h ** 3 - bi * hi ** 3) / 12, Iw = (h * b ** 3 - hi * bi ** 3) / 12;
      return { A, I, W: (2 * I) / h, Imin: Math.min(I, Iw), k: A / (2 * t * hi), bearing: 2 * t, depth: h }; // the two webs carry the shear
    }
    default:
      return { A: b * h, I: (b * h ** 3) / 12, W: (b * h * h) / 6, Imin: (Math.min(b, h) ** 3 * Math.max(b, h)) / 12, k: 1.5, bearing: b, depth: h };
  }
}
export const hasSection = (s: PartSpec | undefined) => !!s && ((s.shape ?? 'rect') === 'rect' || s.shape === 'rtube' ? !!(s.b && s.h) : !!s.d);

// commercial sizes (NBR 7203 lumber names; metalon and tubes as sold), b × h with h in the plane of the throw
const cm = (v: number) => v / 100, mm = (v: number) => v / 1000;
export const SIZES: { label: string; metal: boolean; spec: PartSpec }[] = [
  { label: 'Sarrafo 2,5 × 10 cm', metal: false, spec: { shape: 'rect', b: cm(2.5), h: cm(10) } },
  { label: 'Caibro 5 × 7 cm', metal: false, spec: { shape: 'rect', b: cm(5), h: cm(7) } },
  { label: 'Pontalete 7 × 7 cm', metal: false, spec: { shape: 'rect', b: cm(7), h: cm(7) } },
  { label: 'Vigota 6 × 12 cm', metal: false, spec: { shape: 'rect', b: cm(6), h: cm(12) } },
  { label: 'Viga 6 × 16 cm', metal: false, spec: { shape: 'rect', b: cm(6), h: cm(16) } },
  { label: 'Pilar 10 × 10 cm', metal: false, spec: { shape: 'rect', b: cm(10), h: cm(10) } },
  { label: 'Pilar 15 × 15 cm', metal: false, spec: { shape: 'rect', b: cm(15), h: cm(15) } },
  { label: 'Roliço Ø 10 cm', metal: false, spec: { shape: 'round', d: cm(10) } },
  { label: 'Roliço Ø 15 cm', metal: false, spec: { shape: 'round', d: cm(15) } },
  { label: 'Roliço Ø 20 cm', metal: false, spec: { shape: 'round', d: cm(20) } },
  { label: 'Metalon 20 × 20 × 1,2 mm', metal: true, spec: { shape: 'rtube', b: mm(20), h: mm(20), t: mm(1.2) } },
  { label: 'Metalon 30 × 30 × 1,5 mm', metal: true, spec: { shape: 'rtube', b: mm(30), h: mm(30), t: mm(1.5) } },
  { label: 'Metalon 40 × 40 × 1,5 mm', metal: true, spec: { shape: 'rtube', b: mm(40), h: mm(40), t: mm(1.5) } },
  { label: 'Metalon 30 × 50 × 1,5 mm', metal: true, spec: { shape: 'rtube', b: mm(30), h: mm(50), t: mm(1.5) } },
  { label: 'Metalon 50 × 50 × 2 mm', metal: true, spec: { shape: 'rtube', b: mm(50), h: mm(50), t: mm(2) } },
  { label: 'Metalon 40 × 80 × 2 mm', metal: true, spec: { shape: 'rtube', b: mm(40), h: mm(80), t: mm(2) } },
  { label: 'Metalon 50 × 100 × 2 mm', metal: true, spec: { shape: 'rtube', b: mm(50), h: mm(100), t: mm(2) } },
  { label: 'Metalon 100 × 100 × 3 mm', metal: true, spec: { shape: 'rtube', b: mm(100), h: mm(100), t: mm(3) } },
  { label: 'Tubo 1" (33,4 × 2,65 mm)', metal: true, spec: { shape: 'ctube', d: mm(33.4), t: mm(2.65) } },
  { label: 'Tubo 1 1/2" (48,3 × 3 mm)', metal: true, spec: { shape: 'ctube', d: mm(48.3), t: mm(3) } },
  { label: 'Tubo 2" (60,3 × 3 mm)', metal: true, spec: { shape: 'ctube', d: mm(60.3), t: mm(3) } },
  { label: 'Tubo 3" (88,9 × 3,2 mm)', metal: true, spec: { shape: 'ctube', d: mm(88.9), t: mm(3.2) } },
  { label: 'Barra redonda Ø 1"', metal: true, spec: { shape: 'round', d: mm(25.4) } },
];
export const sizesFor = (matKey: string | undefined) => SIZES.filter((s) => s.metal === !!barMat(matKey).metal);
