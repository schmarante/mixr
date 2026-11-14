/**
 * Rundreise-Prüfung für den Importer: Original-Code und
 * compile(importStrudelCode(code)) werden mit echtem Strudel ausgewertet und
 * die Events (Zeit, Klang, Tonhöhe, wichtige Parameter) verglichen.
 */
import { expect } from 'vitest';
import { compile } from '../CompilerAgent';
import { importStrudelCode, type ImportResult } from '../importer';
import { noteMidi } from '../importer/convert';
import { core, evaluateStrudel, transpile } from './strudelHarness';

const KIT_INSTRUMENTS = new Set(['bd', 'sd', 'cp', 'hh', 'oh', 'rim']);
const VISUALS = ['pianoroll', '_pianoroll', 'punchcard', '_punchcard', 'scope', '_scope', 'spectrum', '_spectrum', 'spiral', '_spiral', 'pitchwheel', '_pitchwheel', 'markcss', 'theme'];

let stubbed = false;
/** REPL-Widgets und Sample-Laden gibt es im Test-Harness nicht → neutrale Stubs. */
function installStubs(): void {
  if (stubbed) return;
  stubbed = true;
  const proto = (core as { Pattern: { prototype: Record<string, unknown> } }).Pattern.prototype;
  for (const name of VISUALS) {
    proto[name] = function (this: unknown) {
      return this;
    };
  }
  const g = globalThis as Record<string, unknown>;
  g['sliderWithID'] = (_id: string, value: number) => value;
  g['samples'] = async () => {};
}

export interface CompareOptions {
  /** Zyklen [0, cycles) vergleichen. */
  cycles?: number;
  /** Parameter, die nicht verglichen werden (bewusst weggelassene Zeilen-Einstellungen). */
  ignore?: string[];
  /** Zeiten nur auf diese Genauigkeit vergleichen (z. B. weggelassenes `.late(0.01)`). */
  timeTolerance?: number;
  /** Event-Enden ignorieren (Drum-Raster dürfen Dauern ändern). Standard: nur bei Kit-Drums. */
  ignoreEnds?: (value: Record<string, unknown>) => boolean;
}

/** Klang-Ersetzungen aus den Hinweisen (alter Name → neuer Name). */
export function soundMap(result: ImportResult): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of result.notes) {
    const p = n.message.params ?? {};
    if (n.message.key === 'importer.note.sound' || n.message.key.startsWith('importer.note.recipe.')) map.set(String(p['from']).toLowerCase(), String(p['to']).toLowerCase());
    if (n.message.key === 'importer.note.drumSound') {
      const kit = String(p['kit']);
      const inst = String(p['to']);
      map.set(String(p['from']).toLowerCase(), kit === 'modern' ? inst : `${kit}_${inst}`);
    }
    if (n.message.key === 'importer.note.bank') map.set(`bank:${String(p['from']).toLowerCase()}`, String(p['to']));
  }
  return map;
}

function round(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

type Value = Record<string, unknown>;

function effectiveSound(v: Value, map: Map<string, string> | null): string {
  let s = typeof v['s'] === 'string' ? v['s'].toLowerCase() : 'triangle';
  const origBank = typeof v['bank'] === 'string' ? v['bank'].toLowerCase() : null;
  let bank = origBank;
  const direct = map && origBank !== null ? map.get(`${origBank} ${s}`) : undefined;
  if (direct !== undefined) {
    s = direct;
    bank = null;
  } else if (map) {
    s = map.get(s) ?? s;
    if (bank !== null) bank = map.get(`bank:${bank}`) ?? bank;
  }
  let full = bank !== null ? `${bank}_${s}` : s;
  const m = /^modern_(\w+)$/.exec(full);
  if (m && KIT_INSTRUMENTS.has(m[1]!)) full = m[1]!;
  return full;
}

/** Vereinheitlicht ein Event (Standardwerte von superdough, Aliase, Ersetzungen). */
/**
 * @param orbits Orbits, die das Original selbst setzt. Andere (vom Compiler automatisch
 *   vergebene, wenn das Original keinen hatte) werden nicht verglichen.
 */
export function normalize(v: Value, cps: number, map: Map<string, string> | null, ignore: string[], orbits: Set<unknown> = new Set()): Value {
  const out: Value = { ...v };
  out['s'] = effectiveSound(v, map);
  delete out['bank'];
  if (!orbits.has(out['orbit'])) delete out['orbit'];
  delete out['color'];
  if (out['n'] === 0) delete out['n'];
  // Tonhöhe als MIDI vergleichen (Schreibweise egal: eb2 = D#2 = 39).
  if (out['note'] !== undefined) out['note'] = noteMidi(out['note']) ?? out['note'];
  out['gain'] = round(Number(v['gain'] ?? 0.8) * Number(v['velocity'] ?? 1));
  delete out['velocity'];
  if (out['room'] !== undefined) out['roomsize'] ??= 2;
  if (out['cutoff'] !== undefined) out['resonance'] ??= 1;
  if (out['hcutoff'] !== undefined) out['hresonance'] ??= 1;
  if (Number(out['delay'] ?? 0) > 0) {
    const seconds = v['delaytime'] !== undefined ? Number(v['delaytime']) : Number(v['delaysync'] ?? 3 / 16) / cps;
    out['delaySeconds'] = round(seconds);
    out['delayfeedback'] ??= 0.5;
    delete out['delaytime'];
    delete out['delaysync'];
  }
  if (['attack', 'decay', 'sustain', 'release'].some((k) => v[k] !== undefined)) {
    const a = v['attack'] as number | undefined;
    const d = v['decay'] as number | undefined;
    const s = v['sustain'] as number | undefined;
    const r = v['release'] as number | undefined;
    out['attack'] = Math.max(a ?? 0, 0.001);
    out['decay'] = Math.max(d ?? 0, 0.001);
    out['sustain'] = Math.min(s ?? ((a !== undefined && d === undefined) || (a === undefined && d === undefined) ? 1 : 0.001), 1);
    out['release'] = Math.max(r ?? 0, 0.01);
  }
  for (const k of ignore) delete out[k];
  for (const [k, x] of Object.entries(out)) if (typeof x === 'number') out[k] = round(x);
  return out;
}

const isKitDrum = (v: Value) => typeof v['s'] === 'string' && KIT_INSTRUMENTS.has(String(v['s']).replace(/^(modern|analog|emu808)_/, ''));

async function events(
  code: string,
  cycles: number,
  map: Map<string, string> | null,
  opts: CompareOptions,
  orbits: Set<unknown>,
): Promise<string[]> {
  const { query, cps } = await evaluateStrudel(code);
  const ignoreEnds = opts.ignoreEnds ?? isKitDrum;
  const tol = opts.timeTolerance ?? 0;
  const q = (t: number) => (tol ? Math.round(t / tol) * tol : t);
  return query(0, cycles)
    .map((h) => {
      const value = normalize(h.value, cps, map, opts.ignore ?? [], orbits);
      const sorted = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
      const end = ignoreEnds(value) ? '' : `-${round(q(h.end))}`;
      return `${round(q(h.begin))}${end} ${JSON.stringify(sorted)}`;
    })
    .sort();
}

/** Importiert, kompiliert und vergleicht die Events mit dem Original. Liefert Import-Ergebnis und erzeugten Code. */
export async function expectRoundTrip(original: string, opts: CompareOptions = {}): Promise<{ result: ImportResult; code: string }> {
  return expectRoundTripWith(original, undefined, opts);
}

/** Wie expectRoundTrip, mit eigenen Klängen (availableSounds) des Nutzers. */
export async function expectRoundTripWith(
  original: string,
  availableSounds: readonly string[] | undefined,
  opts: CompareOptions = {},
): Promise<{ result: ImportResult; code: string }> {
  installStubs();
  const result = importStrudelCode(original, availableSounds ? { availableSounds } : {});
  const { code, diagnostics } = compile(result.ast, result.settings);
  expect(diagnostics).toEqual([]);
  expect(() => transpile(code)).not.toThrow();
  const cycles = opts.cycles ?? 8;
  // Orbits, die das Original selbst setzt, müssen erhalten bleiben.
  const orbits = new Set((await evaluateStrudel(`setcps(0.5)\n${original}`)).query(0, cycles).map((h) => h.value['orbit']).filter((o) => o !== undefined));
  const want = await events(`setcps(0.5)\n${original}`, cycles, soundMap(result), opts, orbits);
  const got = await events(code, cycles, null, opts, orbits);
  expect(want.length).toBeGreaterThan(0);
  expect(got, `Erzeugter Code:\n${code}`).toEqual(want);
  return { result, code };
}
