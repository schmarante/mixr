/**
 * Klang-Ersetzung: mixr hat nur frei lizenzierte, selbst gehostete Klänge
 * (public/samples/*) und die eingebauten Synths von superdough. Alles andere wird
 * durch einen möglichst ähnlichen freien Klang ersetzt.
 */
import { DRUM_INSTRUMENTS } from '../../blocks/catalog';
import { miniAtoms } from './mini';

/** Unsere Drum-Kits (Bank-Namen in public/samples/drums/strudel.json). */
export const KITS = ['modern', 'analog', 'emu808'] as const;
export type Kit = (typeof KITS)[number];

/** Kit-Instrumente (bd, sd, cp, hh, oh, rim). */
export const KIT_INSTRUMENTS: readonly string[] = DRUM_INSTRUMENTS.map((i) => i.value);

/** Eingebaute Klangerzeuger von superdough (synth.mjs, noise, zzfx). */
const SYNTHS = new Set([
  'sine',
  'square',
  'triangle',
  'sawtooth',
  'supersaw',
  'pulse',
  'sbd',
  'white',
  'pink',
  'brown',
  'crackle',
  'user',
  'one',
  'bytebeat',
  'sin',
  'tri',
  'saw',
  'sqr',
  'zzfx',
  'z_sine',
  'z_sawtooth',
  'z_triangle',
  'z_square',
  'z_tan',
  'z_noise',
]);

/** Selbst gehostete Samples (public/samples/*‌/strudel.json). */
const SAMPLES = new Set([
  ...KIT_INSTRUMENTS,
  ...KITS.flatMap((k) => KIT_INSTRUMENTS.map((i) => `${k}_${i}`)),
  'piano',
  'tabla',
  'elec',
  'perc',
  'glitch',
  'bass',
  'ambi',
  'vinyl',
  'misc',
]);

export const NOISES = new Set(['white', 'pink', 'brown', 'crackle']);

export function isKnownSound(name: string): boolean {
  const n = name.toLowerCase();
  return SYNTHS.has(n) || SAMPLES.has(n);
}

/** Eingebauter Klangerzeuger (Oszillator/Rauschen) statt Sample? */
export function isSynthSound(name: string): boolean {
  return SYNTHS.has(name.toLowerCase());
}

export function isKit(name: string): name is Kit {
  return (KITS as readonly string[]).includes(name);
}

/* ------------------------------------------------------------------ */
/* Drums                                                               */
/* ------------------------------------------------------------------ */

/**
 * Drum-Kürzel (tidal-drum-machines / Dirt-Samples) → Kit-Instrument und
 * Ersatz-Sample außerhalb eines Kits (Sonic-Pi-Gruppen).
 */
const DRUM_ALIASES: Record<string, { inst: string; sample?: string }> = {
  bd: { inst: 'bd' },
  kick: { inst: 'bd' },
  sd: { inst: 'sd' },
  sn: { inst: 'sd' },
  snare: { inst: 'sd' },
  cp: { inst: 'cp' },
  clap: { inst: 'cp' },
  hh: { inst: 'hh' },
  ch: { inst: 'hh' },
  hc: { inst: 'hh' },
  hat: { inst: 'hh' },
  oh: { inst: 'oh' },
  ho: { inst: 'oh' },
  rim: { inst: 'rim' },
  rs: { inst: 'rim' },
  cl: { inst: 'rim' },
  cr: { inst: 'oh' },
  cy: { inst: 'oh' },
  rd: { inst: 'oh' },
  sh: { inst: 'hh' },
  tb: { inst: 'hh' },
  lt: { inst: 'bd', sample: 'tabla:1' },
  mt: { inst: 'rim', sample: 'tabla:0' },
  ht: { inst: 'rim', sample: 'tabla:3' },
  cb: { inst: 'rim', sample: 'perc:0' },
  perc: { inst: 'rim', sample: 'perc' },
  misc: { inst: 'rim', sample: 'perc' },
  fx: { inst: 'rim', sample: 'glitch' },
  crash: { inst: 'oh' },
  ride: { inst: 'oh' },
  hihat: { inst: 'hh' },
  shaker: { inst: 'hh' },
  tom: { inst: 'rim', sample: 'tabla:0' },
  cowbell: { inst: 'rim', sample: 'perc:0' },
};

/** „<maschine>_bd“, „808bd“/„tr909bd“ (Präfix endet auf Ziffer) oder nur „bd“. */
const DRUM_NAME = new RegExp(`^(?:(.+?)[_-]|(.*\\d))?(${Object.keys(DRUM_ALIASES).join('|')})$`);

function parseDrumName(lower: string): { prefix: string; alias: string } | null {
  const m = DRUM_NAME.exec(lower);
  if (!m) return null;
  return { prefix: m[1] ?? m[2] ?? '', alias: m[3]! };
}

/** Kit für einen Drumcomputer-/Bank-Namen: 808-artig → emu808, 909/modern → modern, sonst analog. */
export function kitForMachine(machine: string): Kit {
  const m = machine.toLowerCase();
  if (isKit(m)) return m;
  if (m.includes('808')) return 'emu808';
  if (m.includes('909') || m.includes('modern')) return 'modern';
  return 'analog';
}

export interface DrumSound {
  /** Kit-Instrument (bd, sd, cp, hh, oh, rim). */
  inst: string;
  kit: Kit;
  /** War schon ein vorhandener Klang (nur Kit-/Instrument-Wahl, keine Ersetzung). */
  exact: boolean;
}

/**
 * Deutet einen Sample-Namen als Drum-Klang („bd“, „dr550_bd“, „RolandTR909_hh“,
 * „808sd“, „emu808_cp“ …). `bank` ist die Bank aus `.bank(…)`, falls vorhanden.
 */
export function drumSound(name: string, bank?: string): DrumSound | null {
  const lower = name.toLowerCase();
  const parsed = parseDrumName(lower);
  if (!parsed) return null;
  const { prefix, alias } = parsed;
  const inst = DRUM_ALIASES[alias]!.inst;
  const known = KIT_INSTRUMENTS.includes(alias);
  if (prefix === '') {
    // Ohne Präfix: Kit über die Bank, sonst unser Standard-Kit (= modern).
    if (bank === undefined) return { inst, kit: 'modern', exact: known };
    return { inst, kit: kitForMachine(bank), exact: known && isKit(bank.toLowerCase()) };
  }
  if (bank !== undefined) return null; // bank + Präfix-Name ergäbe „bank_prefix_inst“ – kein Kit-Klang
  return { inst, kit: kitForMachine(prefix), exact: known && isKit(prefix) };
}

/** Sample-Name für ein Kit-Instrument („bd“ für modern, sonst „analog_bd“). */
export function kitSampleName(inst: string, kit: Kit): string {
  return kit === 'modern' ? inst : `${kit}_${inst}`;
}

/* ------------------------------------------------------------------ */
/* Tonale Klänge                                                       */
/* ------------------------------------------------------------------ */

const PIANO = /piano|rhodes|keys|harpsi|clav|celesta/;

/** Ein Ersatz-„Rezept“: freier Synth + Bausteine, die ihn dem Original annähern. */
export interface Recipe {
  id: 'distortedGuitar' | 'cleanGuitar' | 'synthBass' | 'bass' | 'organ' | 'pad' | 'brass' | 'flute' | 'bells' | 'lead' | 'generic';
  sound: string;
  /** Bausteine (Typ + Parameter), eingefügt direkt hinter der Klangquelle. */
  blocks: Array<{ type: 'lpf' | 'distort' | 'adsr'; params: Record<string, number> }>;
}

const env = (attack: number, decay: number, sustain: number, release: number) =>
  ({ type: 'adsr', params: { attack, decay, sustain, release } }) as const;
const lpf = (cutoff: number) => ({ type: 'lpf', params: { cutoff, resonance: 1 } }) as const;

/** Reihenfolge wichtig: Spezielles vor Allgemeinem (z. B. „bassoon“ vor „bass“). */
const RECIPES: Array<{ test: RegExp; recipe: Recipe }> = [
  {
    test: /overdrive|distort|power|fuzz/,
    recipe: { id: 'distortedGuitar', sound: 'sawtooth', blocks: [{ type: 'distort', params: { amount: 0.3 } }, lpf(2500), env(0.01, 0.4, 0.3, 0.2)] },
  },
  { test: /trumpet|trombone|horn|tuba|brass|sax|clarinet|oboe|bassoon/, recipe: { id: 'brass', sound: 'sawtooth', blocks: [lpf(2500), env(0.05, 0.3, 0.7, 0.2)] } },
  {
    test: /pad|choir|voice|aah|ooh|string|violin|viola|cello|contrabass|ensemble|orchestra/,
    recipe: { id: 'pad', sound: 'supersaw', blocks: [lpf(3000), env(0.3, 0.5, 0.8, 0.8)] },
  },
  { test: /synth_?bass|bass_?synth/, recipe: { id: 'synthBass', sound: 'sawtooth', blocks: [lpf(800), env(0.01, 0.3, 0.4, 0.15)] } },
  { test: /bass/, recipe: { id: 'bass', sound: 'triangle', blocks: [lpf(800), env(0.01, 0.5, 0.3, 0.2)] } },
  {
    test: /guitar|harp|pluck|banjo|sitar|koto|shamisen|nylon|mandolin|ukulele/,
    recipe: { id: 'cleanGuitar', sound: 'triangle', blocks: [lpf(3000), env(0.01, 0.6, 0.1, 0.3)] },
  },
  { test: /organ|accordion|harmonium|harmonica/, recipe: { id: 'organ', sound: 'square', blocks: [lpf(2000)] } },
  { test: /flute|whistle|ocarina|recorder|bottle|shakuhachi/, recipe: { id: 'flute', sound: 'sine', blocks: [env(0.05, 0.3, 0.8, 0.2)] } },
  {
    test: /bell|marimba|xylo|vibra|glock|kalimba|music_?box|tubular|steel_?drum|timpani|mallet/,
    recipe: { id: 'bells', sound: 'sine', blocks: [env(0.01, 0.3, 0, 0.3)] },
  },
  { test: /lead.*square|square/, recipe: { id: 'lead', sound: 'square', blocks: [lpf(3000), env(0.01, 0.2, 0.7, 0.2)] } },
  { test: /lead|saw|synth/, recipe: { id: 'lead', sound: 'sawtooth', blocks: [lpf(3000), env(0.01, 0.2, 0.7, 0.2)] } },
];

const GENERIC: Recipe = { id: 'generic', sound: 'triangle', blocks: [env(0.01, 0.4, 0.3, 0.3)] };

/**
 * Rezept für einen tonalen Klang, den es nicht gibt (gm_*, „superfm“ …).
 * `null` für Klavier (eigenes Sample) und Bekanntes.
 */
export function recipeFor(name: string): Recipe | null {
  const lower = name.toLowerCase();
  if (isKnownSound(lower) || PIANO.test(lower)) return null;
  return RECIPES.find((r) => r.test.test(lower))?.recipe ?? GENERIC;
}

export interface SoundContext {
  /** Kette hat `.bank(…)` → Name muss ein Kit-Instrument sein. */
  bank: boolean;
  /** Kette spielt Tonhöhen (note/chord/scale …) → Unbekanntes wird ein Synth, sonst ein perkussives Sample. */
  tonal: boolean;
  /** Bank-Name aus `.bank("…")` (für eigene Klänge „bank_name“). */
  bankName?: string;
  /** Eigene Klänge des Nutzers (Kleinbuchstaben) – gelten als vorhanden. */
  available?: ReadonlySet<string>;
}

/** Ist der Klang (ggf. als „bank_name“) ein eigener Klang des Nutzers? */
export function isAvailable(name: string, ctx: Pick<SoundContext, 'available' | 'bankName'>): boolean {
  const set = ctx.available;
  if (!set || set.size === 0) return false;
  const lower = name.toLowerCase();
  return set.has(lower) || (ctx.bankName !== undefined && set.has(`${ctx.bankName.toLowerCase()}_${lower}`));
}

/** Ist der Bank-Name ein Präfix eigener Klänge („tech“ bei „tech_bd“)? */
export function isAvailableBank(bank: string, available: ReadonlySet<string> | undefined): boolean {
  const prefix = `${bank.toLowerCase()}_`;
  return !!available && [...available].some((n) => n.startsWith(prefix));
}

/**
 * Ersatz für einen einzelnen Klangnamen (ohne „:n“-Index).
 * Liefert den Namen unverändert, wenn es ihn bei uns gibt.
 */
export function substituteSound(name: string, ctx: SoundContext): string {
  const lower = name.toLowerCase();
  if (isAvailable(lower, ctx)) return name;
  if (ctx.bank) {
    // Mit .bank(…) wird daraus „<bank>_<name>“ → es muss ein Kit-Instrument sein.
    if (KIT_INSTRUMENTS.includes(lower)) return name;
    const alias = DRUM_ALIASES[lower];
    return alias ? alias.inst : 'rim';
  }
  if (isKnownSound(lower)) return name;
  if (lower.startsWith('gm_')) return PIANO.test(lower) ? 'piano' : recipeFor(lower)!.sound;
  const parsed = parseDrumName(lower);
  if (parsed) {
    const alias = DRUM_ALIASES[parsed.alias]!;
    if (alias.sample) return alias.sample;
    return kitSampleName(alias.inst, parsed.prefix === '' ? 'modern' : kitForMachine(parsed.prefix));
  }
  if (PIANO.test(lower)) return 'piano';
  if (ctx.tonal) return recipeFor(lower)!.sound;
  // Perkussiver Zusammenhang: passende Sample-Gruppe statt Synth.
  if (/bass/.test(lower)) return 'bass';
  if (/noise|hiss/.test(lower)) return 'white';
  if (/vinyl|crackle|rain/.test(lower)) return 'crackle';
  if (/bell|ping|blip/.test(lower)) return 'elec';
  return 'perc';
}

/** Ersatz für einen Bank-Namen → eines unserer Kits. */
export function substituteBank(bank: string): Kit {
  return kitForMachine(bank);
}

/**
 * Ersetzt alle Klangnamen in Mini-Notation (Index-Suffixe „:3“ bleiben).
 * `replaced` enthält die tatsächlich geänderten Paare.
 */
export function substituteMini(text: string, ctx: SoundContext): { text: string; replaced: Array<[string, string]> } {
  const replaced: Array<[string, string]> = [];
  const swap = (word: string): string => {
    const next = substituteSound(word, ctx);
    if (next !== word) replaced.push([word, next]);
    return next;
  };
  const atoms = miniAtoms(text);
  if (atoms === null) {
    // Nicht parsbar (Strudel würde ohnehin scheitern) – Wörter grob ersetzen.
    return { text: text.replace(/(?<![:\w])[A-Za-z][A-Za-z0-9_]*/g, swap), replaced };
  }
  let out = text;
  for (const a of [...atoms].sort((x, y) => y.start - x.start)) {
    if (!/^[A-Za-z]/.test(a.source)) continue;
    out = out.slice(0, a.start) + swap(a.source) + out.slice(a.end);
  }
  replaced.reverse();
  return { text: out, replaced };
}
