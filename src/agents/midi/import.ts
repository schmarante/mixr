/**
 * MIDI-Import: Standard MIDI File → editierbares mixr-Projekt.
 *
 * Reine Funktion (Node/SSR-sicher), Ergebnis wie beim Code-Importer
 * (`ImportResult`: AST, Einstellungen, übersetzbare Hinweise, Statistik), damit
 * Vorschau-Dialog und WebMCP dieselben Wege nutzen.
 *
 * Abbildung (Kurzfassung):
 *  - Tempo: erstes Tempo-Ereignis (ganzzahlig, 40–220 BPM); Takt immer 4/4.
 *  - Je MIDI-Spur und Kanal eine Spur. Kanal 10 = Drums → Drum-Raster (1 Takt)
 *    bzw. Sample-Baustein mit `<…>` über mehrere Takte; sonst Melodie-Baustein
 *    (16tel-Raster, Haltetöne, 1–16 Takte, Tonart über die Logik des Code-Importers)
 *    oder exakter `note("…")`-Code, wenn keine Skala passt.
 *  - Velocity → Spur-Lautstärke (Mittelwert), bei starker Streuung zusätzlich ein
 *    `.velocity("…")`-Code-Baustein.
 *  - Längere Stücke: sich wiederholende Muster als Schleife; sonst Song-Ablauf aus
 *    gleich langen Abschnitten (gleiche Muster = gleiche Spur); notfalls die
 *    ersten 16 Takte mit Hinweis.
 */
import { DRUM_INSTRUMENTS, TRACK_COLORS, defaultParams, emptyDrumGrid } from '../../blocks/catalog';
import { instrumentLabel } from '../../blocks/text';
import { t, type TKey, type TParams } from '../../i18n';
import { collectNotes, MidiParseError, parseMidi, type MidiFile } from '../../lib/midi/smf';
import {
  NOTE_GRID_BARS,
  type Arrangement,
  type BlockNode,
  type BlockType,
  type NoteGridValue,
  type ParamValues,
  type TrackNode,
  type VisualAst,
  type VisualEdge,
} from '../../types/ast';
import { compressSequence, heldNoteSequence, noteToken } from '../compiler/sequence';
import { fmtNum, quote } from '../compiler/format';
import type { ImportNote, ImportNoteKind, ImportResult } from '../importer';
import { BPM_MAX, BPM_MIN, chooseKey, midiToDegree } from '../importer/convert';
import { DRUM_CHANNEL, drumForNote, drumNoteName, programName, soundForProgram } from './gm';

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

/** Datei nicht importierbar – `messageKey` ist ein Text-Key (Namespace `midi`). */
export class MidiImportError extends Error {
  constructor(
    readonly messageKey: TKey,
    readonly params?: TParams,
  ) {
    super(String(messageKey));
    this.name = 'MidiImportError';
  }
}

/** Größere Dateien sind kein sinnvolles Loop-Projekt (Schutz vor Versehen). */
export const MIDI_MAX_BYTES = 4 * 1024 * 1024;

/** Steps pro Takt (16tel). */
const BAR = 16;
/** Noch analysierte Songlänge. */
const MAX_SONG_BARS = 256;
/** Höchstens so viele Spuren entstehen. */
const MAX_TRACKS = 24;
/** Velocity-Spanne, ab der ein Velocity-Muster entsteht. */
const VELOCITY_SPREAD = 24;
/** Abschnittslängen für den Song-Ablauf (größere bevorzugt). */
const SECTION_LENGTHS = [16, 8, 4] as const;

/**
 * Wandelt eine MIDI-Datei in ein Projekt um.
 * @throws MidiImportError bei unlesbaren Dateien oder Dateien ohne Noten
 */
export function importMidi(bytes: Uint8Array): ImportResult {
  if (bytes.length > MIDI_MAX_BYTES) throw new MidiImportError('midi.error.tooLarge');
  let file: MidiFile;
  try {
    file = parseMidi(bytes);
  } catch (err) {
    if (err instanceof MidiParseError) throw new MidiImportError(`midi.error.${err.code}`);
    throw err;
  }
  const notes: Hint[] = [];
  const bpm = readTempo(file, notes);
  readTimeSignature(file, notes);

  const voices = splitWideVoices(readVoices(file, notes), notes);
  if (voices.length === 0) throw new MidiImportError('midi.error.noNotes');

  const plan = planSong(voices, notes);
  return buildResult(plan, bpm, notes);
}

/* ------------------------------------------------------------------ */
/* Hinweise                                                            */
/* ------------------------------------------------------------------ */

interface Hint {
  kind: ImportNoteKind;
  key: TKey;
  params?: TParams;
  /** Index der Spur im Ergebnis (falls zuordenbar). */
  track?: number;
}

function hint(kind: ImportNoteKind, key: TKey, params?: TParams): Hint {
  return params ? { kind, key, params } : { kind, key };
}

/* ------------------------------------------------------------------ */
/* Tempo & Taktart                                                     */
/* ------------------------------------------------------------------ */

function readTempo(file: MidiFile, notes: Hint[]): number {
  const tempos = file.tracks
    .flatMap((tr) => tr.events)
    .filter((e) => e.type === 'tempo')
    .sort((a, b) => a.tick - b.tick);
  const first = tempos[0];
  if (!first) {
    notes.push(hint('info', 'midi.note.tempoDefault', { bpm: 120 }));
    return 120;
  }
  const raw = 60_000_000 / first.microsecondsPerQuarter;
  const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(raw)));
  const shown = fmtNum(raw, 2);
  if (bpm !== Number(shown)) notes.push(hint('info', 'midi.note.tempoAdjusted', { original: shown, bpm }));
  else notes.push(hint('info', 'midi.note.tempo', { bpm }));
  if (tempos.some((e) => e.microsecondsPerQuarter !== first.microsecondsPerQuarter)) {
    notes.push(hint('info', 'midi.note.tempoChanges', { bpm }));
  }
  return bpm;
}

function readTimeSignature(file: MidiFile, notes: Hint[]): void {
  const sigs = file.tracks
    .flatMap((tr) => tr.events)
    .filter((e) => e.type === 'timeSignature')
    .sort((a, b) => a.tick - b.tick);
  const odd = sigs.find((s) => s.numerator !== 4 || s.denominator !== 4);
  if (odd) notes.push(hint('info', 'midi.note.timeSignature', { signature: `${odd.numerator}/${odd.denominator}` }));
}

/* ------------------------------------------------------------------ */
/* Stimmen (Spur × Kanal)                                              */
/* ------------------------------------------------------------------ */

/** Quantisierte Note: Start/Dauer in 16tel-Steps. */
interface QNote {
  step: number;
  pitch: number;
  len: number;
  vel: number;
}

interface Voice {
  name: string;
  drums: boolean;
  program: number;
  /** Nach Start sortiert, ohne Dubletten (gleicher Start + Tonhöhe). */
  notes: QNote[];
}

function readVoices(file: MidiFile, notes: Hint[]): Voice[] {
  const stepTicks = file.ppq / 4;
  const raw = collectNotes(file);
  let offGrid = 0;
  let dropped = 0;
  const groups = new Map<string, { track: number; channel: number; notes: QNote[] }>();
  for (const n of raw) {
    const pos = n.start / stepTicks;
    const step = Math.round(pos);
    if (Math.abs(pos - step) > 0.1) offGrid++;
    if (step >= MAX_SONG_BARS * BAR) {
      dropped++;
      continue;
    }
    const drums = n.channel === DRUM_CHANNEL;
    const len = drums ? 1 : Math.max(1, Math.round((n.end - n.start) / stepTicks));
    const key = `${String(n.track).padStart(4, '0')}:${String(n.channel).padStart(2, '0')}`;
    const g = groups.get(key) ?? { track: n.track, channel: n.channel, notes: [] };
    g.notes.push({ step, pitch: n.note, len, vel: n.velocity });
    groups.set(key, g);
  }
  if (offGrid > 0) notes.push(hint('info', 'midi.note.quantized', { count: offGrid }));
  if (dropped > 0) notes.push(hint('dropped', 'midi.note.songCapped', { count: dropped, bars: MAX_SONG_BARS }));

  const channelsPerTrack = new Map<number, number>();
  for (const g of groups.values()) channelsPerTrack.set(g.track, (channelsPerTrack.get(g.track) ?? 0) + 1);

  const voices: Voice[] = [];
  for (const [, g] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const events = file.tracks[g.track]?.events ?? [];
    const trackName = events.find((e) => e.type === 'trackName')?.text.trim() ?? '';
    const programEvent =
      events.find((e) => e.type === 'programChange' && e.channel === g.channel) ??
      file.tracks.flatMap((tr) => tr.events).find((e) => e.type === 'programChange' && e.channel === g.channel);
    const program = programEvent?.type === 'programChange' ? programEvent.program : 0;
    const drums = g.channel === DRUM_CHANNEL;
    const single = channelsPerTrack.get(g.track) === 1;
    const fallback = drums ? t('midi.names.drums') : programName(program);
    const name = single && trackName !== '' ? trackName : fallback;
    voices.push({ name, drums, program, notes: dedupe(g.notes) });
  }
  return voices;
}

/** Höchstens so viele Lagen entstehen beim Aufteilen einer zu weiten Stimme. */
const MAX_PITCH_BANDS = 3;

/**
 * Tonhöhen → Lagen, die je in einen Melodie-Baustein passen (eine Tonart, Stufen
 * 0…MAX_DEGREE). Geteilt wird an der größten Lücke zwischen benachbarten Tönen
 * (Bass | Akkorde | Melodie); null, wenn es mit MAX_PITCH_BANDS Lagen nicht geht.
 */
function pitchBands(pitches: number[], maxBands = MAX_PITCH_BANDS): number[][] | null {
  if (pitches.length === 0) return [];
  if (chooseKey(pitches, [], null)) return [pitches];
  if (maxBands < 2 || pitches.length < 2) return null;
  let cut = 1;
  for (let i = 2; i < pitches.length; i++) {
    if (pitches[i]! - pitches[i - 1]! > pitches[cut]! - pitches[cut - 1]!) cut = i;
  }
  const lower = pitches.slice(0, cut);
  const upper = pitches.slice(cut);
  for (let lowMax = 1; lowMax < maxBands; lowMax++) {
    const low = pitchBands(lower, lowMax);
    if (!low) continue;
    const high = pitchBands(upper, maxBands - low.length);
    if (high) return [...low, ...high];
  }
  return null;
}

/**
 * Stimmen mit zu großem Tonumfang (z. B. Klavier: Bass, Akkorde und Melodie auf einem
 * Kanal) passen in keinen Melodie-Baustein und würden zu einem einzigen `note("…")`-Code.
 * Sie werden nach Lage in mehrere Spuren geteilt, sofern jede Lage in einen Baustein passt.
 */
function splitWideVoices(voices: Voice[], notes: Hint[]): Voice[] {
  return voices.flatMap((voice) => {
    if (voice.drums) return [voice];
    const pitches = [...new Set(voice.notes.map((n) => n.pitch))].sort((a, b) => a - b);
    const bands = pitchBands(pitches);
    if (!bands || bands.length < 2) return [voice];
    notes.push(hint('converted', 'midi.note.splitRange', { name: voice.name, count: bands.length }));
    const labels = bands.length === 2 ? ['low', 'high'] : ['low', 'mid', 'high'];
    return bands.map((band, i) => {
      const inBand = new Set(band);
      return {
        ...voice,
        name: t(`midi.names.${labels[i]}` as TKey, { name: voice.name }),
        notes: voice.notes.filter((n) => inBand.has(n.pitch)),
      };
    });
  });
}

/** Gleicher Start + gleiche Tonhöhe → eine Note (längste Dauer, lauteste Velocity). */
function dedupe(list: QNote[]): QNote[] {
  const map = new Map<string, QNote>();
  for (const n of list) {
    const key = `${n.step}:${n.pitch}`;
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, len: Math.max(prev.len, n.len), vel: Math.max(prev.vel, n.vel) } : { ...n });
  }
  return [...map.values()].sort((a, b) => a.step - b.step || a.pitch - b.pitch);
}

/* ------------------------------------------------------------------ */
/* Muster & Song-Ablauf                                                */
/* ------------------------------------------------------------------ */

/** Noten ab Takt `startBar` über `bars` Takte, Steps relativ zum Fenster. */
function windowNotes(list: QNote[], startBar: number, bars: number): QNote[] {
  const from = startBar * BAR;
  const to = from + bars * BAR;
  return list.filter((n) => n.step >= from && n.step < to).map((n) => ({ ...n, step: n.step - from }));
}

/** Inhalt je Takt als Vergleichsschlüssel (Start im Takt, Tonhöhe, Dauer). */
function barKeys(list: QNote[], bars: number): string[] {
  const keys: string[][] = Array.from({ length: bars }, () => []);
  for (const n of list) {
    const b = Math.floor(n.step / BAR);
    if (b < bars) keys[b]!.push(`${n.step % BAR}:${n.pitch}:${n.len}`);
  }
  return keys.map((k) => k.sort().join(','));
}

/**
 * Kleinste Musterlänge b ∈ {1, 2, 4, 8, 16}, mit der sich die `span` Takte exakt
 * wiederholen. Für b < span darf keine Note über das Musterende hinausklingen
 * (sonst wäre die Schleife kürzer als das Original). null = kein Muster ≤ 16 Takte.
 */
function patternBars(list: QNote[], span: number): number | null {
  const keys = barKeys(list, span);
  for (const b of NOTE_GRID_BARS) {
    if (b >= span) return b;
    if (!keys.every((k, c) => k === keys[c % b])) continue;
    if (list.some((n) => n.step < b * BAR && n.step + n.len > b * BAR)) continue;
    return b;
  }
  return null;
}

interface TrackPlan {
  voice: Voice;
  /** Noten des Musters (Steps relativ zum Musteranfang). */
  notes: QNote[];
  bars: number;
  /** Namenszusatz bei mehreren Varianten einer Stimme („A“, „B“ …). */
  variant?: string;
}

interface SongPlan {
  tracks: TrackPlan[];
  /** Song-Ablauf: Abschnitte und je Spur (Index) die Abschnitte, in denen sie spielt. */
  arrangement: { sections: Array<{ cycles: number; name: string }>; on: Map<number, Set<number>> } | null;
}

function planSong(voices: Voice[], notes: Hint[]): SongPlan {
  const lastStep = Math.max(...voices.flatMap((v) => v.notes.map((n) => n.step)));
  const total = Math.floor(lastStep / BAR) + 1;
  const periods = voices.map((v) => patternBars(v.notes, total));

  if (total <= 16 || periods.every((p) => p !== null)) {
    if (total > 16) notes.push(hint('info', 'midi.note.loop', { bars: total, loop: Math.max(...periods.map((p) => p ?? 1)) }));
    return limitTracks({ tracks: voices.map((v, i) => loopTrack(v, periods[i] ?? 16)), arrangement: null }, notes);
  }

  const arranged = arrange(voices, periods, total);
  if (arranged && arranged.tracks.length <= MAX_TRACKS) {
    notes.push(hint('converted', 'midi.note.arrangement', { bars: total, count: arranged.arrangement!.sections.length }));
    return arranged;
  }
  // Ehrlich begrenzen: die ersten 16 Takte als Schleife
  notes.push(hint('dropped', 'midi.note.truncated', { bars: total }));
  const cut = voices
    .map((v) => ({ ...v, notes: windowNotes(v.notes, 0, 16) }))
    .filter((v) => v.notes.length > 0);
  return limitTracks({ tracks: cut.map((v) => loopTrack(v, patternBars(v.notes, 16) ?? 16)), arrangement: null }, notes);
}

function loopTrack(voice: Voice, bars: number): TrackPlan {
  return { voice, notes: windowNotes(voice.notes, 0, bars), bars };
}

function limitTracks(plan: SongPlan, notes: Hint[]): SongPlan {
  if (plan.tracks.length <= MAX_TRACKS) return plan;
  notes.push(hint('dropped', 'midi.note.tracksCapped', { count: plan.tracks.length - MAX_TRACKS, max: MAX_TRACKS }));
  return { ...plan, tracks: plan.tracks.slice(0, MAX_TRACKS) };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letter = (i: number) => LETTERS[i % 26]! + (i >= 26 ? String(Math.floor(i / 26) + 1) : '');

/**
 * Song-Ablauf aus gleich langen Abschnitten (16, 8 oder 4 Takte – die Länge mit den
 * wenigsten Spuren gewinnt). Stimmen, die sich über den ganzen Song wiederholen,
 * spielen durchgehend; die übrigen bekommen je unterschiedlichem Abschnittsinhalt
 * eine eigene Spur, die nur in diesen Abschnitten an ist. Gleiche aufeinanderfolgende
 * Abschnitte werden zusammengefasst.
 */
function arrange(voices: Voice[], periods: Array<number | null>, total: number): SongPlan | null {
  let best: { plan: SongPlan; count: number } | null = null;
  for (const L of SECTION_LENGTHS) {
    const segments = Math.ceil(total / L);
    const tracks: TrackPlan[] = [];
    /** Je Abschnitt: Signatur (welche Varianten spielen). */
    const segmentOn: Array<Set<number>> = Array.from({ length: segments }, () => new Set());
    const variable: number[] = [];
    voices.forEach((voice, vi) => {
      const p = periods[vi];
      if (p !== null && p !== undefined) {
        tracks.push(loopTrack(voice, p));
        return;
      }
      const variants: Array<{ key: string; notes: QNote[]; span: number; track: number }> = [];
      for (let j = 0; j < segments; j++) {
        const span = Math.min(L, total - j * L);
        const win = windowNotes(voice.notes, j * L, span);
        if (win.length === 0) continue;
        const key = barKeys(win, span).join('|');
        // Exakt gleich – oder (letzter, kürzerer Abschnitt) der Anfang einer vorhandenen Variante
        let found = variants.find((v) => v.key === key && v.span === span);
        found ??= variants.find((v) => v.span > span && barKeys(windowNotes(v.notes, 0, span), span).join('|') === key);
        if (!found) {
          const bars = patternBars(win, span) ?? 16;
          const track = tracks.length;
          tracks.push({ voice, notes: windowNotes(win, 0, bars), bars });
          variable.push(track);
          found = { key, notes: win, span, track };
          variants.push(found);
        }
        segmentOn[j]!.add(found.track);
      }
      if (variants.length > 1) variants.forEach((v, k) => (tracks[v.track]!.variant = letter(k)));
    });
    if (!best || tracks.length < best.count) {
      // Aufeinanderfolgende gleiche Abschnitte zusammenfassen
      const sigOf = (s: Set<number>) => [...s].sort((a, b) => a - b).join(',');
      const merged: Array<{ cycles: number; sig: string; on: Set<number> }> = [];
      segmentOn.forEach((on, j) => {
        const cycles = Math.min(L, total - j * L);
        const sig = sigOf(on);
        const prev = merged.at(-1);
        // Nur volle Abschnitte zusammenfassen (Muster teilen L, also auch 2·L)
        if (prev && prev.sig === sig && prev.cycles % L === 0 && cycles === L) prev.cycles += cycles;
        else merged.push({ cycles, sig, on });
      });
      const names = new Map<string, string>();
      const sections = merged.map((m) => {
        if (!names.has(m.sig)) names.set(m.sig, letter(names.size));
        return { cycles: m.cycles, name: names.get(m.sig)! };
      });
      const on = new Map<number, Set<number>>();
      for (const ti of variable) on.set(ti, new Set(merged.flatMap((m, si) => (m.on.has(ti) ? [si] : []))));
      best = { plan: { tracks, arrangement: { sections, on } }, count: tracks.length };
    }
  }
  return best?.plan ?? null;
}

/* ------------------------------------------------------------------ */
/* Spuren bauen                                                        */
/* ------------------------------------------------------------------ */

interface BlockSpec {
  type: BlockType;
  params: ParamValues;
}

interface TrackDraft {
  name: string;
  volume: number;
  blocks: BlockSpec[];
  notes: Hint[];
}

const NOTE_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];

/** MIDI-Nummer → Strudel-Notenname („c4“ = 60). */
export function midiNoteName(midi: number): string {
  return midi < 12 ? String(midi) : `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Ersetzt Tonhöhen-Zahlen einer Mini-Notation durch Notennamen (nicht Gewichte/Wiederholungen). */
function namedPitches(seq: string): string {
  return seq.replace(/(?<![@*!/.:\d])\d+(?![\d.])/g, (m) => midiNoteName(Number(m)));
}

/** Tokens je Takt → `<[Takt 1] [Takt 2] …>` (gleiche Takte zusammengefasst). */
function barsPattern(tokens: string[], bars: number): string {
  const perBar = Array.from({ length: bars }, (_, b) => {
    const slice = tokens.slice(b * BAR, (b + 1) * BAR);
    return slice.every((x) => x === '~') ? '~' : compressSequence(slice, { stretch: false });
  });
  if (perBar.every((s) => s === perBar[0])) return perBar[0]!;
  return `<${perBar.map((s) => (topLevelSpace(s) ? `[${s}]` : s)).join(' ')}>`;
}

/** Enthält die Mini-Notation Leerzeichen außerhalb von Klammern (= mehrere Schritte)? */
function topLevelSpace(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '[' || ch === '<' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '>' || ch === '}' || ch === ')') depth--;
    else if (ch === ' ' && depth === 0) return true;
  }
  return false;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Lautstärke (Mittel) und – bei starker Streuung – Velocity-Muster als Code-Baustein. */
function velocityOf(plan: TrackPlan): { volume: number; block: BlockSpec | null } {
  const vels = plan.notes.map((n) => n.vel);
  const mean = vels.reduce((a, b) => a + b, 0) / Math.max(1, vels.length);
  const volume = Math.min(1, Math.max(0.05, round2(mean / 127)));
  if (Math.max(...vels) - Math.min(...vels) <= VELOCITY_SPREAD) return { volume, block: null };
  const total = plan.bars * BAR;
  const tokens = Array.from({ length: total }, (_, step) => {
    const at = plan.notes.filter((n) => n.step === step).map((n) => n.vel);
    if (at.length === 0) return '~';
    const v = at.reduce((a, b) => a + b, 0) / at.length;
    return fmtNum(v / 127 / volume, 2);
  });
  return { volume, block: { type: 'code-fx', params: { code: `.velocity(${quote(barsPattern(tokens, plan.bars))})` } } };
}

function drumTrack(plan: TrackPlan, out: Hint[]): BlockSpec | null {
  const rows = new Map<string, Set<number>>();
  const swapped = new Map<string, string>();
  const unknown = new Set<number>();
  for (const n of plan.notes) {
    const d = drumForNote(n.pitch);
    if (!d) {
      unknown.add(n.pitch);
      continue;
    }
    if (!d.exact) swapped.set(drumNoteName(n.pitch), instrumentLabel(d.inst));
    const set = rows.get(d.inst) ?? new Set<number>();
    set.add(n.step);
    rows.set(d.inst, set);
  }
  for (const [from, to] of swapped) out.push(hint('substituted', 'midi.note.drumMapped', { from, to }));
  if (unknown.size > 0) out.push(hint('dropped', 'midi.note.drumDropped', { notes: [...unknown].map(drumNoteName).join(', ') }));
  if (rows.size === 0) return null;

  if (plan.bars === 1) {
    const grid = emptyDrumGrid(BAR);
    for (const [inst, steps] of rows) for (const s of steps) grid.rows[inst]![s] = true;
    out.push(hint('converted', 'midi.note.drums'));
    return { type: 'drums', params: { grid, bank: 'modern' } };
  }
  const total = plan.bars * BAR;
  const layers = DRUM_INSTRUMENTS.map((i) => i.value)
    .filter((inst) => rows.has(inst))
    .map((inst) => barsPattern(Array.from({ length: total }, (_, s) => (rows.get(inst)!.has(s) ? inst : '~')), plan.bars));
  out.push(hint('converted', 'midi.note.drumsLong', { bars: plan.bars }));
  return { type: 'sample', params: { pattern: layers.join(', '), speed: 1 } };
}

function melodicTrack(plan: TrackPlan, out: Hint[]): BlockSpec[] {
  const total = plan.bars * BAR;
  const { sound, recipe } = soundForProgram(plan.voice.program);
  const from = programName(plan.voice.program);
  let shortened = 0;
  const len = (n: QNote) => {
    const l = Math.min(n.len, total - n.step);
    if (l < n.len) shortened++;
    return l;
  };
  const midis = [...new Set(plan.notes.map((n) => n.pitch))];
  const key = chooseKey(midis, [], null);
  let source: BlockSpec;
  if (key) {
    const cells: number[][] = Array.from({ length: total }, () => []);
    const lengths: number[][] = Array.from({ length: total }, () => []);
    for (const n of plan.notes) {
      cells[n.step]!.push(midiToDegree(n.pitch, key)!);
      lengths[n.step]!.push(len(n));
    }
    const held = lengths.some((row) => row.some((l) => l > 1));
    const grid: NoteGridValue = held || plan.bars > 1 ? { steps: BAR, bars: plan.bars, cells, lengths } : { steps: BAR, cells };
    source = { type: 'melody', params: { grid, sound, root: key.root, scale: key.scale, octave: key.octave } };
    out.push(hint('converted', 'midi.note.melody', { root: key.root, scale: key.scale.replace(/:/g, ' '), octave: key.octave, count: plan.bars }));
  } else {
    const cells: number[][] = Array.from({ length: total }, () => []);
    const lengths: number[][] = Array.from({ length: total }, () => []);
    for (const n of plan.notes) {
      cells[n.step]!.push(n.pitch);
      lengths[n.step]!.push(len(n));
    }
    const held = lengths.some((row) => row.some((l) => l > 1));
    const seq = held || plan.bars > 1 ? heldNoteSequence(cells, lengths, total) : compressSequence(cells.map(noteToken), { stretch: false });
    const span = plan.bars > 1 ? `.slow(${plan.bars})` : '';
    source = { type: 'code', params: { code: `note(${quote(namedPitches(seq))})${span}.s(${quote(sound)})` } };
    out.push(hint('keptAsCode', 'midi.note.noteCode'));
  }
  if (shortened > 0) out.push(hint('info', 'midi.note.heldShortened', { count: shortened }));
  const blocks: BlockSpec[] = [source];
  if (recipe) {
    blocks.push(...recipe.blocks.map((b) => ({ type: b.type, params: { ...b.params } })));
    out.push(hint('substituted', `importer.note.recipe.${recipe.id}`, { from, to: sound }));
  } else if (plan.voice.program !== 0) {
    // Klaviere → Piano-Sample (ersetzt); feste Synth-Programme (Lead square …) → derselbe Synth
    out.push(hint(sound === 'piano' ? 'substituted' : 'converted', 'midi.note.sound', { from, to: sound }));
  }
  return blocks;
}

function buildTrack(plan: TrackPlan): TrackDraft | null {
  const notes: Hint[] = [];
  const blocks: BlockSpec[] = [];
  if (plan.voice.drums) {
    const src = drumTrack(plan, notes);
    if (!src) return null;
    blocks.push(src);
  } else {
    blocks.push(...melodicTrack(plan, notes));
  }
  const vel = velocityOf(plan);
  if (vel.block) {
    blocks.push(vel.block);
    notes.push(hint('info', 'midi.note.velocityPattern'));
  }
  const name = plan.variant ? `${plan.voice.name} ${plan.variant}` : plan.voice.name;
  return { name, volume: vel.volume, blocks, notes };
}

/* ------------------------------------------------------------------ */
/* Ergebnis                                                            */
/* ------------------------------------------------------------------ */

function idPrefix(): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `mid-${random}`;
}

function buildResult(plan: SongPlan, bpm: number, global: Hint[]): ImportResult {
  const prefix = idPrefix();
  const nodes: VisualAst['nodes'] = [];
  const edges: VisualEdge[] = [];
  const notes: ImportNote[] = global.map((h) => toNote(h));
  const used = new Set<string>();
  const trackIds = new Map<number, string>();
  let blockCount = 0;
  let codeBlocks = 0;
  let index = 0;

  plan.tracks.forEach((tp, planIndex) => {
    const draft = buildTrack(tp);
    if (!draft) return;
    index++;
    let name = draft.name.trim() || t('importer.names.track', { n: index });
    for (let i = 2; used.has(name); i++) name = `${draft.name} ${i}`;
    used.add(name);
    const track: TrackNode = {
      id: `${prefix}-t${index}`,
      type: 'track',
      params: { name, color: TRACK_COLORS[(index - 1) % TRACK_COLORS.length]!, volume: draft.volume, muted: false, solo: false },
    };
    trackIds.set(planIndex, track.id);
    const blocks: BlockNode[] = draft.blocks.map((b, j) => ({
      id: `${track.id}-b${j + 1}`,
      type: b.type,
      params: { ...defaultParams(b.type), ...b.params },
    }));
    nodes.push(track, ...blocks);
    const ids = [track.id, ...blocks.map((b) => b.id)];
    for (let k = 0; k < ids.length - 1; k++) edges.push({ id: `e-${ids[k]}-${ids[k + 1]}`, source: ids[k]!, target: ids[k + 1]! });
    blockCount += blocks.length;
    codeBlocks += blocks.filter((b) => b.type === 'code' || b.type === 'code-mod' || b.type === 'code-fx').length;
    notes.push(...draft.notes.map((h) => toNote(h, name)));
  });
  if (nodes.length === 0) throw new MidiImportError('midi.error.noNotes');

  let arrangement: Arrangement | undefined;
  if (plan.arrangement) {
    const sections = plan.arrangement.sections.map((s, i) => ({ id: `${prefix}-s${i + 1}`, cycles: s.cycles, name: s.name }));
    const cells: Arrangement['cells'] = {};
    for (const [planIndex, on] of plan.arrangement.on) {
      const id = trackIds.get(planIndex);
      if (!id) continue;
      cells[id] = Object.fromEntries(sections.map((s, si) => [s.id, { on: on.has(si) }]));
    }
    arrangement = { sections, cells };
  }

  const merged = mergeNotes(notes);
  const trackCount = nodes.filter((n) => n.type === 'track').length;
  return {
    ast: arrangement ? { nodes, edges, arrangement } : { nodes, edges },
    settings: { bpm },
    notes: merged,
    stats: {
      tracks: trackCount,
      blocks: blockCount,
      codeBlocks,
      substituted: merged.filter((n) => n.kind === 'substituted').length,
      dropped: merged.filter((n) => n.kind === 'dropped').length,
    },
  };
}

function toNote(h: Hint, trackName?: string): ImportNote {
  const message = h.params ? { key: h.key, params: h.params } : { key: h.key };
  return trackName === undefined ? { kind: h.kind, message } : { kind: h.kind, trackName, message };
}

/** Gleiche Hinweise mehrerer Spuren (z. B. Varianten) zu einem zusammenfassen. */
function mergeNotes(notes: ImportNote[]): ImportNote[] {
  const groups = new Map<string, ImportNote[]>();
  for (const n of notes) {
    const id = `${n.kind}|${n.message.key}|${JSON.stringify(n.message.params ?? {})}`;
    groups.set(id, [...(groups.get(id) ?? []), n]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    return new Set(group.map((n) => n.trackName)).size > 1 ? { kind: first.kind, message: first.message } : first;
  });
}
