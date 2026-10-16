import { RANGES } from './labels';
import { defaults, KINDS, type Kind, type Params } from './presets';
import { sanitizeSketch, type Sketch } from './sketch';

export interface Design {
  version: 1;
  name: string;
  kind: Kind | 'free';
  params: Params;
  sketch?: Sketch; // only for kind 'free'
}

const KEY = 'trebuchet.designs';
const CURRENT = 'trebuchet.current';

// localStorage can throw (private mode, blocked) — treat as empty
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: designs live only in this session */
  }
}

// Anything coming from a file or storage is untrusted: keep only known kind + numeric params.
export function sanitize(raw: unknown): Design {
  const d = raw as Partial<Design>;
  if (!d || typeof d !== 'object' || !d.kind || (d.kind !== 'free' && !Object.hasOwn(KINDS, d.kind))) throw new Error('Arquivo não é um design de trebuchet válido');
  const params = { ...defaults };
  for (const k of Object.keys(defaults) as (keyof Params)[]) {
    const v = (d.params as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) params[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], v)); // e.g. density 0 → infinite CW
  }
  const name = String(d.name ?? 'Sem nome').slice(0, 80);
  if (d.kind === 'free') return { version: 1, name, kind: 'free', params, sketch: sanitizeSketch(d.sketch) };
  return { version: 1, name, kind: d.kind, params };
}

export const listDesigns = (): Design[] => read<unknown[]>(KEY, []).flatMap((d) => {
  try {
    return [sanitize(d)];
  } catch {
    return [];
  }
});

export function saveDesign(d: Design) {
  write(KEY, [...listDesigns().filter((x) => x.name !== d.name), d]);
}

export function deleteDesign(name: string) {
  write(KEY, listDesigns().filter((x) => x.name !== name));
}

export const saveCurrent = (d: Design) => write(CURRENT, d);
export function loadCurrent(): Design | undefined {
  try {
    return sanitize(read(CURRENT, null));
  } catch {
    return undefined;
  }
}

export function download(filename: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function importFile(file: File): Promise<Design> {
  return sanitize(JSON.parse(await file.text()));
}
