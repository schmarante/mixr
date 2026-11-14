/**
 * MIDI-Export: Projekt → Standard MIDI File (Format 1, 480 PPQ).
 *
 * Die Noten stammen aus der echten Strudel-Auswertung: Jede hörbare Spur wird
 * einzeln kompiliert (Solo-Trick), ausgewertet und über `queryArc(0, Takte)`
 * abgefragt – Code-Bausteine, Setup-Code, Effekte auf Tonhöhe/Rhythmus und das
 * Arrangement landen so genau wie gespielt im MIDI.
 *
 * - Tonhöhe: `note` (Name/Zahl), sonst `freq` (nächste MIDI-Note), sonst der
 *   Standardton der Synths (wie superdough); `octave` wird berücksichtigt.
 * - Drums (`s` = bd/sd/hh/oh/cp/rim, auch mit Bank oder Kit-Präfix) → Kanal 10, GM-Noten.
 * - Andere Samples → Kanal 10 als Perkussion (grob passende GM-Note, Hinweis).
 * - Velocity = gain × velocity (× 127).
 * - Eine MIDI-Spur je strudelmixr-Spur (Drums einer gemischten Spur als eigene MIDI-Spur).
 */
import { t, type TKey, type TParams } from '../../i18n';
import { writeMidi, type MidiEvent, type MidiTrack } from '../../lib/midi/smf';
import { resolveTracks } from '../../store/selectors';
import { isTrackNode, type ProjectSettings, type ResolvedTrack, type VisualAst } from '../../types/ast';
import { compile } from '../compiler/compile';
import { noteMidi } from '../importer/convert';
import { NOISES, drumSound, isSynthSound } from '../importer/sounds';
import { DRUM_CHANNEL, noteForDrum, percussionNoteForSample, programForSound } from './gm';
import type { PatternEvaluator, PatternLike } from './strudelEval';

export const MIDI_PPQ = 480;
/** 1 Zyklus = 1 Takt = 4 Viertel. */
export const TICKS_PER_CYCLE = 4 * MIDI_PPQ;
export const MIDI_EXPORT_MAX_BARS = 64;

export type ExportNoteKind = 'melodic' | 'drums' | 'percussion';

/** Eine Note aus Strudel (Zeiten in Zyklen). */
export interface ExportNote {
  begin: number;
  end: number;
  pitch: number;
  velocity: number;
  kind: ExportNoteKind;
  sound: string | null;
}

export interface MidiExportTrackInfo {
  name: string;
  /** 1-basiert wie in MIDI-Programmen üblich (10 = Drums). */
  channel: number;
  notes: number;
  kind: 'melodic' | 'drums';
}

export interface MidiExportResult {
  bytes: Uint8Array;
  bars: number;
  bpm: number;
  tracks: MidiExportTrackInfo[];
  /** Übersetzbare Hinweise (übersprungene Spuren, Perkussion …). */
  notes: Array<{ key: TKey; params?: TParams }>;
}

export interface MidiExportOptions {
  /** Länge in Takten (1–64); ohne Angabe: Vorschlag aus `suggestMidiBars`. */
  bars?: number;
  /** Auswertung (Standard: Strudel lazy laden). */
  evaluate?: PatternEvaluator;
  /** Name der Leitspur. */
  title?: string;
}

/* ------------------------------------------------------------------ */
/* Haps → Noten                                                        */
/* ------------------------------------------------------------------ */

const DEFAULT_GAIN = 0.8;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Deutet einen Hap-Wert als MIDI-Note (null = spielt keine Note, z. B. reine Zahl). */
export function interpretValue(value: unknown): Omit<ExportNote, 'begin' | 'end'> | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const s = typeof v['s'] === 'string' ? v['s'] : null;
  const gain = num(v['gain']) ?? DEFAULT_GAIN;
  const velocity = Math.max(1, Math.min(127, Math.round(127 * gain * (num(v['velocity']) ?? 1))));
  const octave = num(v['octave']) ?? 0;

  let pitch: number | null = null;
  const note = v['note'];
  if (typeof note === 'number' && Number.isFinite(note)) pitch = note;
  else if (typeof note === 'string') pitch = noteMidi(note.trim());
  else if (num(v['freq']) !== undefined && num(v['freq'])! > 0) pitch = 69 + 12 * Math.log2(num(v['freq'])! / 440);
  else if (s !== null && isSynthSound(s) && !NOISES.has(s.toLowerCase())) pitch = 36; // superdough-Standardton

  if (pitch !== null) {
    const p = Math.round(pitch + 12 * octave);
    return p >= 0 && p <= 127 ? { pitch: p, velocity, kind: 'melodic', sound: s } : null;
  }
  if (s === null) return null;
  const name = s.toLowerCase().replace(/:\d+$/, '');
  const bank = typeof v['bank'] === 'string' ? v['bank'] : undefined;
  let gm = noteForDrum(name);
  if (gm === null) {
    const d = drumSound(name, bank);
    if (d) gm = noteForDrum(d.inst);
  }
  if (gm !== null) return { pitch: gm, velocity, kind: 'drums', sound: s };
  return { pitch: percussionNoteForSample(name), velocity, kind: 'percussion', sound: s };
}

/** Alle Noten mit Anfang in [0, bars). */
export function patternNotes(pattern: PatternLike, bars: number): ExportNote[] {
  const out: ExportNote[] = [];
  for (const hap of pattern.queryArc(0, bars)) {
    if (!hap.whole || !hap.hasOnset()) continue;
    const begin = hap.whole.begin.valueOf();
    const end = hap.whole.end.valueOf();
    if (begin < 0 || begin >= bars) continue;
    const n = interpretValue(hap.value);
    if (n) out.push({ ...n, begin, end: Math.max(end, begin) });
  }
  return out.sort((a, b) => a.begin - b.begin || a.pitch - b.pitch);
}

/* ------------------------------------------------------------------ */
/* Spuren                                                              */
/* ------------------------------------------------------------------ */

/** Spuren, die man hört (nicht stumm; bei Solo nur die Solo-Spuren). */
export function audibleTracks(ast: VisualAst): ResolvedTrack[] {
  const tracks = resolveTracks(ast);
  const anySolo = tracks.some((tr) => tr.track.params.solo === true);
  return tracks.filter((tr) => tr.track.params.muted !== true && (!anySolo || tr.track.params.solo === true));
}

/** Code einer einzelnen Spur (Solo-Trick), Song-Ablauf immer ab Anfang und vollständig. */
export function trackCode(ast: VisualAst, settings: ProjectSettings, trackId: string): string {
  const solo: VisualAst = {
    ...ast,
    nodes: ast.nodes.map((n) => (isTrackNode(n) ? { ...n, params: { ...n.params, solo: n.id === trackId, muted: n.id === trackId ? false : n.params.muted } } : n)),
  };
  if (ast.arrangement) solo.arrangement = { ...ast.arrangement, loopSection: null, startSection: null };
  return compile(solo, settings).code;
}

async function defaultEvaluator(): Promise<PatternEvaluator> {
  const { loadStrudelEvaluator } = await import('./strudelEval');
  return loadStrudelEvaluator();
}

/** Kleinste Periode (in Takten, ≤ 32) der Hap-Folge über 64 Takte; null = keine. */
function periodOf(pattern: PatternLike): number | null {
  const SPAN = 64;
  const keys: string[][] = Array.from({ length: SPAN }, () => []);
  for (const hap of pattern.queryArc(0, SPAN)) {
    if (!hap.whole || !hap.hasOnset()) continue;
    const b = hap.whole.begin.valueOf();
    const c = Math.floor(b);
    if (c < 0 || c >= SPAN) continue;
    // Nur was im MIDI landet (Klangparameter wie ein Filter-Sweep zählen nicht)
    const n = interpretValue(hap.value);
    if (n) keys[c]!.push(`${(b - c).toFixed(6)}/${(hap.whole.end.valueOf() - b).toFixed(6)}/${n.pitch}/${n.velocity}`);
  }
  const flat = keys.map((k) => k.sort().join('|'));
  for (let p = 1; p <= SPAN / 2; p++) {
    if (flat.every((k, c) => c + p >= SPAN || k === flat[c + p])) return p;
  }
  return null;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Vorschlag für Spuren ohne Wiederholung (Zufall). */
const IRREGULAR_BARS = 8;

/**
 * Vorschlag für die Exportlänge: Gesamtlänge des Song-Ablaufs, sonst die Länge,
 * nach der sich alle Spuren gemeinsam wiederholen (1–64 Takte; mit Zufall mindestens 8).
 */
export async function suggestMidiBars(ast: VisualAst, settings: ProjectSettings, evaluate?: PatternEvaluator): Promise<number> {
  const clampBars = (n: number) => Math.max(1, Math.min(MIDI_EXPORT_MAX_BARS, Math.round(n)));
  const sections = ast.arrangement?.sections.filter((s) => Number.isFinite(s.cycles) && s.cycles > 0) ?? [];
  if (sections.length > 0) return clampBars(Math.ceil(sections.reduce((sum, s) => sum + s.cycles, 0)));
  const run = evaluate ?? (await defaultEvaluator());
  const periods: number[] = [];
  let irregular = false;
  for (const tr of audibleTracks(ast)) {
    const code = trackCode(ast, settings, tr.track.id);
    if (!code) continue;
    try {
      const p = periodOf(await run(code));
      if (p !== null) periods.push(p);
      else irregular = true;
    } catch {
      /* Spur ohne gültigen Code – zählt nicht */
    }
  }
  const lcm = periods.reduce((a, b) => (a / gcd(a, b)) * b, 1);
  const loop = lcm <= MIDI_EXPORT_MAX_BARS ? lcm : Math.max(...periods);
  // Zufall (degrade, sometimes …) wiederholt sich nie – dann mindestens 8 Takte
  return clampBars(irregular ? Math.max(loop, IRREGULAR_BARS) : loop);
}

/* ------------------------------------------------------------------ */
/* MIDI schreiben                                                      */
/* ------------------------------------------------------------------ */

/** Melodische Kanäle (ohne 10). */
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

interface Tick {
  pitch: number;
  start: number;
  end: number;
  velocity: number;
}

/** Noten → Ticks: Dubletten zusammenfassen, Überlappung gleicher Tonhöhe kürzen, am Ende abschneiden. */
function toTicks(notes: ExportNote[], endTick: number, drums: boolean): Tick[] {
  const byKey = new Map<string, Tick>();
  for (const n of notes) {
    const start = Math.round(n.begin * TICKS_PER_CYCLE);
    let end = Math.min(endTick, Math.round(n.end * TICKS_PER_CYCLE));
    if (drums) end = Math.min(end, start + MIDI_PPQ / 4); // Drums: kurze Noten (16tel)
    end = Math.max(end, start + 1);
    const key = `${n.pitch}:${start}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...prev, end: Math.max(prev.end, end), velocity: Math.max(prev.velocity, n.velocity) } : { pitch: n.pitch, start, end, velocity: n.velocity });
  }
  const list = [...byKey.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const lastOf = new Map<number, Tick>();
  for (const n of list) {
    const prev = lastOf.get(n.pitch);
    if (prev && prev.end > n.start) prev.end = n.start;
    lastOf.set(n.pitch, n);
  }
  return list.filter((n) => n.end > n.start);
}

function noteEvents(ticks: Tick[], channel: number): MidiEvent[] {
  return ticks.flatMap((n): MidiEvent[] => [
    { type: 'noteOn', tick: n.start, channel, note: n.pitch, velocity: n.velocity },
    { type: 'noteOff', tick: n.end, channel, note: n.pitch, velocity: 64 },
  ]);
}

function mostCommon(values: Array<string | null>): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Exportiert das Projekt als MIDI-Datei.
 * Spuren, deren Code nicht ausgewertet werden kann, werden übersprungen (Hinweis).
 */
export async function exportMidi(ast: VisualAst, settings: ProjectSettings, options: MidiExportOptions = {}): Promise<MidiExportResult> {
  const evaluate = options.evaluate ?? (await defaultEvaluator());
  const bars = Math.max(1, Math.min(MIDI_EXPORT_MAX_BARS, Math.round(options.bars ?? (await suggestMidiBars(ast, settings, evaluate)))));
  const bpm = Number.isFinite(settings.bpm) && settings.bpm > 0 ? settings.bpm : 120;
  const endTick = bars * TICKS_PER_CYCLE;
  const hints: MidiExportResult['notes'] = [];
  const tracks: MidiTrack[] = [];
  const info: MidiExportTrackInfo[] = [];
  const percussion = new Set<string>();
  let melodicIndex = 0;

  for (const tr of audibleTracks(ast)) {
    const name = tr.track.params.name || t('importer.names.track', { n: info.length + 1 });
    const code = trackCode(ast, settings, tr.track.id);
    if (!code) {
      hints.push({ key: 'midi.export.trackSkipped', params: { track: name } });
      continue;
    }
    let notes: ExportNote[];
    try {
      notes = patternNotes(await evaluate(code), bars);
    } catch (err) {
      console.warn('[midi] export: track failed', name, err);
      hints.push({ key: 'midi.export.trackFailed', params: { track: name } });
      continue;
    }
    if (notes.length === 0) {
      hints.push({ key: 'midi.export.trackSilent', params: { track: name } });
      continue;
    }
    for (const n of notes) if (n.kind === 'percussion' && n.sound) percussion.add(n.sound.replace(/:\d+$/, ''));

    const melodic = notes.filter((n) => n.kind === 'melodic');
    const drums = notes.filter((n) => n.kind !== 'melodic');
    if (melodic.length > 0) {
      const channel = MELODIC_CHANNELS[melodicIndex % MELODIC_CHANNELS.length]!;
      if (melodicIndex === MELODIC_CHANNELS.length) hints.push({ key: 'midi.export.channelsShared', params: { count: MELODIC_CHANNELS.length } });
      melodicIndex++;
      const program = programForSound(mostCommon(melodic.map((n) => n.sound)));
      const ticks = toTicks(melodic, endTick, false);
      tracks.push({
        events: [
          { type: 'trackName', tick: 0, text: name },
          { type: 'programChange', tick: 0, channel, program },
          ...noteEvents(ticks, channel),
          { type: 'endOfTrack', tick: endTick },
        ],
      });
      info.push({ name, channel: channel + 1, notes: ticks.length, kind: 'melodic' });
    }
    if (drums.length > 0) {
      const drumName = melodic.length > 0 ? `${name} (${t('midi.names.drums')})` : name;
      const ticks = toTicks(drums, endTick, true);
      tracks.push({
        events: [{ type: 'trackName', tick: 0, text: drumName }, ...noteEvents(ticks, DRUM_CHANNEL), { type: 'endOfTrack', tick: endTick }],
      });
      info.push({ name: drumName, channel: DRUM_CHANNEL + 1, notes: ticks.length, kind: 'drums' });
    }
  }
  if (percussion.size > 0) hints.push({ key: 'midi.export.percussion', params: { names: [...percussion].sort().join(', ') } });

  const conductor: MidiTrack = {
    events: [
      { type: 'trackName', tick: 0, text: options.title?.trim() || 'strudelmixr' },
      { type: 'timeSignature', tick: 0, numerator: 4, denominator: 4, clocks: 24, thirtySeconds: 8 },
      { type: 'tempo', tick: 0, microsecondsPerQuarter: Math.round(60_000_000 / bpm) },
      { type: 'endOfTrack', tick: endTick },
    ],
  };
  const bytes = writeMidi({ format: 1, ppq: MIDI_PPQ, tracks: [conductor, ...tracks] });
  return { bytes, bars, bpm, tracks: info, notes: hints };
}

/** Bytes → Base64 (für WebMCP; ohne Buffer, auch im Browser). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const binary = atob(clean);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

