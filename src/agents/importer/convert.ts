/**
 * Kern des Importers: Strudel-Programm (acorn-AST) → Spur-Entwürfe.
 *
 * Grundsatz: Alles, was sich exakt als Baustein darstellen lässt, wird ein
 * Baustein; alles andere bleibt als Code-Baustein an derselben Stelle der Kette
 * erhalten. So erzeugt der Compiler wieder dieselben Events wie das Original.
 */
import { OPTION_SETS, emptyDrumGrid, getBlockDef } from '../../blocks/catalog';
import { bracketsBalanced, fmtNum, sanitizeMini } from '../compiler/format';
import { instrumentLabel, optionLabel } from '../../blocks/text';
import { t, type TKey, type TParams } from '../../i18n';
import { NOTE_GRID_BARS, type BlockType, type NumberParamDef, type ParamValues } from '../../types/ast';
import type { ImportNoteKind } from './index';
import {
  Frac,
  catPatterns,
  miniAtoms,
  miniCycles,
  miniPattern,
  queryCycles,
  seqPatterns,
  stackPatterns,
  type MiniEvent,
  type MiniPattern,
} from './mini';
import {
  LIST_FUNCTIONS,
  SETUP_CALLS,
  TEMPO_CALLS,
  TONAL_METHODS,
  TONAL_ROOTS,
  VISUALS,
  canonical,
  methodKind,
  type MethodKind,
} from './methods';
import {
  NOISES,
  drumSound,
  substituteBank,
  substituteMini,
  substituteSound,
  recipeFor,
  isAvailable,
  isAvailableBank,
  isKnownSound,
  KIT_INSTRUMENTS,
  type Kit,
  type Recipe,
  type SoundContext,
} from './sounds';
import {
  Printer,
  calleeName,
  evalNumber,
  field,
  flattenChain,
  isCall,
  isIdent,
  isFunction,
  isMember,
  quoteOf,
  stringValue,
  tidy,
  tidyMethod,
  walk,
  type Chain,
  type JsNode,
  type Method,
  type ParsedSource,
} from './source';

/* ------------------------------------------------------------------ */
/* Ergebnis-Typen                                                      */
/* ------------------------------------------------------------------ */

export interface DraftNote {
  kind: ImportNoteKind;
  key: TKey;
  params?: TParams;
}

export interface BlockSpec {
  type: BlockType;
  params: ParamValues;
}

export interface TrackDraft {
  name: string;
  muted: boolean;
  volume: number;
  blocks: BlockSpec[];
  notes: DraftNote[];
}

export interface ConvertResult {
  bpm: number;
  arrangement: ArrangementDraft | null;
  /** Setup-Code (register, Konstanten, globale Einstellungen) in Original-Reihenfolge. */
  prelude: string;
  tracks: TrackDraft[];
  notes: DraftNote[];
}

export const BPM_MIN = 40;
export const BPM_MAX = 220;
const DEFAULT_BPM = 120;
/** superdough: Standard-Lautstärke, wenn kein gain gesetzt ist. */
const DEFAULT_GAIN = 0.8;
/** So viele Zyklen werden geprüft, um „jeder Takt gleich“ festzustellen. */
const CHECK_CYCLES = 64;

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

function note(kind: ImportNoteKind, key: TKey, params?: TParams): DraftNote {
  return params ? { kind, key, params } : { kind, key };
}

/** Kurzer, einzeiliger Code-Ausschnitt für Hinweise. */
function snippet(code: string, max = 60): string {
  const one = code.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Wert passt in den Katalog-Bereich und übersteht die Formatierung des Compilers. */
function fits(type: BlockType, key: string, v: number, decimals = 4): boolean {
  const def = getBlockDef(type).params.find((p) => p.key === key) as NumberParamDef | undefined;
  if (!def) return false;
  return v >= def.min && v <= def.max && Number(v.toFixed(decimals)) === v;
}

const SOUND_OPTIONS = OPTION_SETS.sounds.map((o) => o.value);
const SINGLE_SOUND = /^[A-Za-z][A-Za-z0-9_]*(:0)?$/;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Alle Zyklen gleich wie Zyklus 0? */
function periodic(cycles: MiniEvent[][]): boolean {
  const key = (evs: MiniEvent[]) => evs.map((e) => `${e.begin.n}/${e.begin.d}-${e.end.n}/${e.end.d}=${JSON.stringify(e.value)}`).join('|');
  const first = key(cycles[0] ?? []);
  return cycles.every((c) => key(c) === first);
}

/* ------------------------------------------------------------------ */
/* Programm                                                            */
/* ------------------------------------------------------------------ */

type SoundMark = { kind: 'sound'; ctx: SoundContext } | { kind: 'bank' };

interface Candidate {
  expr: JsNode;
  stmt: JsNode;
  label: string | null;
  /** Zeile eines aufgeteilten `stack(…)`: Methoden hinter dem stack + Namensbestandteile. */
  row?: { outer: Method[]; base: string | null; comment: string | null };
  /** Fester Spurname (z. B. Instrument eines Song-Ablaufs). */
  name?: string;
}

/** Song-Ablauf aus `arrange(…)`: Abschnitte + Zellen (Spur-Index → Abschnitt-Index). */
export interface ArrangementDraft {
  sections: Array<{ cycles: number; name?: string }>;
  cells: Array<{ track: number; section: number; on: boolean; code?: string }>;
}

export interface ConvertOptions {
  /** Eigene Klänge (Slots) – werden nicht ersetzt. */
  availableSounds?: readonly string[];
}

export function convertProgram(src: ParsedSource, options: ConvertOptions = {}): ConvertResult {
  return new ProgramConverter(src, new Set((options.availableSounds ?? []).map((n) => n.toLowerCase()))).run();
}

class ProgramConverter {
  readonly notes: DraftNote[] = [];
  /** Top-Level-Konstanten/Funktionen (für das Einsetzen an der Verwendungsstelle). */
  readonly decls = new Map<string, JsNode>();
  /** Bezeichner → Top-Level-Anweisung, die ihn deklariert. */
  readonly declStmts = new Map<string, JsNode>();
  readonly numbers = new Map<string, number>();
  readonly marks = new Map<JsNode, SoundMark>();
  /** Top-Level-Anweisungen für den Setup-Code (Projekt-prelude). */
  readonly prelude: JsNode[] = [];
  /** Per `register(…)` definierte Methoden → Art (für Code-Bausteine). */
  readonly registered = new Map<string, MethodKind>();
  /** Quelltext der register-Funktionen (für die Dauer-Prüfung bei Drum-Rastern). */
  readonly registeredBodies = new Map<string, string>();
  /** Tonarten, die im Code vorkommen (`.scale(…)`, Akkord-Grundtöne) – bevorzugt bei Notennamen. */
  readonly keyHints: KeyHint[] = [];
  /** Namen aus dem Setup-Code, die Lautstärke (gain) setzen. */
  readonly gainNames = new Set<string>();
  bpm = DEFAULT_BPM;

  private gainRefCache: number[] | null = null;

  /** Positionen aller Bezeichner (auch Methodennamen), die auf gain-setzenden Setup-Code verweisen. */
  gainRefs(): number[] {
    if (this.gainRefCache) return this.gainRefCache;
    const out: number[] = [];
    walk(this.src.program, (node) => {
      if (isIdent(node) && this.gainNames.has(node.name)) out.push(node.start);
    });
    return (this.gainRefCache = out);
  }

  /** Art einer Methode inkl. selbst registrierter. */
  kind(name: string): MethodKind {
    return this.registered.get(name) ?? methodKind(name);
  }

  constructor(
    readonly src: ParsedSource,
    /** Eigene Klänge des Nutzers (Kleinbuchstaben). */
    readonly available: ReadonlySet<string> = new Set(),
  ) {}

  run(): ConvertResult {
    const body = this.src.program.body;
    this.collectDeclarations(body);
    this.markSounds();
    this.collectKeyHints();

    const candidates: Candidate[] = [];
    for (const stmt of body) this.statement(stmt, candidates);

    // Strudel spielt nur benannte Muster ($:, name:, .p()), sonst den letzten Ausdruck.
    const registered = candidates.filter((c) => c.label !== null || pName(flattenChain(c.expr)) !== null);
    const playing = registered.length > 0 ? registered : candidates.slice(-1);
    for (const c of candidates) {
      if (!playing.includes(c)) {
        this.notes.push(note('dropped', 'importer.note.notPlayed', { line: lineOf(c.stmt), code: snippet(this.src.code.slice(c.expr.start, c.expr.end), 40) }));
      }
    }

    // Song-Ablauf: genau ein arrange(…) → eine Spur pro Instrument + Arrangement.
    const arrangeCands = playing.filter((c) => calleeName(flattenChain(c.expr).root) === 'arrange');
    let song: { tracks: TrackDraft[]; arrangement: ArrangementDraft } | null = null;
    // Format des eigenen Compilers: ein arrange(…) pro Spur (siehe convertTrackArranges).
    let perTrack: ReturnType<ProgramConverter['convertTrackArranges']> = null;
    if (arrangeCands.length === 1) {
      const mark = this.notes.length;
      song = this.convertArrange(arrangeCands[0]!);
      if (!song) {
        perTrack = this.convertTrackArranges(arrangeCands);
        if (perTrack) this.notes.length = mark; // Rückfall-Hinweis von convertArrange gilt nicht
      }
    } else if (arrangeCands.length > 1) {
      perTrack = this.convertTrackArranges(arrangeCands);
    }
    const perCandidate = playing.map((c) => {
      const own = perTrack?.tracks.get(c);
      if (own) return [own];
      return song && c === arrangeCands[0] ? song.tracks : this.splitStack(c).map((part) => new TrackConverter(this, part).run());
    });
    let arrangement: ArrangementDraft | null = null;
    if (song) {
      const offset = perCandidate.slice(0, playing.indexOf(arrangeCands[0]!)).reduce((n, ts) => n + ts.length, 0);
      arrangement = { sections: song.arrangement.sections, cells: song.arrangement.cells.map((c) => ({ ...c, track: c.track + offset })) };
    } else if (perTrack) {
      const cells: ArrangementDraft['cells'] = [];
      for (const [cand, rows] of perTrack.cells) {
        const track = perCandidate.slice(0, playing.indexOf(cand)).reduce((n, ts) => n + ts.length, 0);
        rows.forEach((cell, section) => cells.push(cell.code === undefined ? { track, section, on: cell.on } : { track, section, on: cell.on, code: cell.code }));
      }
      arrangement = { sections: perTrack.sections, cells };
    }

    // Gleich benannte Muster: Strudel spielt nur das letzte.
    const lastByName = new Map<string, number>();
    playing.forEach((c, i) => {
      const id = c.label ?? pName(flattenChain(c.expr));
      if (id !== null && !id.includes('$')) lastByName.set(id, i);
    });
    playing.forEach((c, i) => {
      const id = c.label ?? pName(flattenChain(c.expr));
      if (id !== null && !id.includes('$') && lastByName.get(id) !== i) {
        for (const tr of perCandidate[i]!) {
          if (tr.muted) continue;
          tr.muted = true;
          tr.notes.push(note('info', 'importer.note.overwritten', { name: id }));
        }
      }
    });

    return { bpm: this.bpm, arrangement, prelude: this.preludeText(), tracks: perCandidate.flat(), notes: this.notes };
  }

  /** Setup-Code ohne Kommentare, mit Klang-Ersatz; gain darin wird zu velocity (siehe TrackConverter). */
  /** Deklarationen, die als Instrument-Spur übernommen wurden (nicht zusätzlich ins prelude). */
  private readonly asTracks = new Set<JsNode>();

  /**
   * `arrange([c, x], …)` mit Instrument-Bezeichnern (`kick`, `stack(kick, hat)`,
   * `hat.lpf(2000)`) → eine Spur pro let/const-Instrument + Abschnitte/Zellen.
   * `null` = nicht abbildbar (dann bleibt alles eine Code-Spur).
   */
  private convertArrange(c: Candidate): { tracks: TrackDraft[]; arrangement: ArrangementDraft } | null {
    const chain = flattenChain(c.expr);
    const root = chain.root;
    if (!isCall(root) || root.arguments.length === 0) return null;
    const fallback = (reason: string) => {
      this.notes.push(note('info', 'importer.note.arrangementCode', { reason }));
      return null;
    };
    // Methoden hinter arrange(…): nur Klang-Parameter mit festen Werten (auf jede Spur verteilbar).
    const outer: Method[] = [];
    for (const m of chain.methods) {
      if (VISUALS.has(m.name)) {
        this.notes.push(note('dropped', 'importer.note.visualsDropped', { names: m.name, count: 1 }));
        continue;
      }
      if (m.name === 'p' || /^[pdq]\d$/.test(m.name)) continue;
      const literal = m.args.every((a) => evalNumber(a, this.numbers) !== null || stringValue(a) !== null);
      if (!m.call || this.kind(m.name) !== 'fx' || canonical(m.name) === 'gain' || !literal) return fallback(`.${m.name}()`);
      outer.push(m);
    }

    interface Use {
      name: string;
      methods: Method[];
    }
    const uses = (node: JsNode): Use[] | null => {
      if (isIdent(node)) return node.name === 'silence' ? [] : [{ name: node.name, methods: [] }];
      if (calleeName(node) === 'stack' && isCall(node)) {
        const all = node.arguments.map(uses);
        return all.every((u): u is Use[] => u !== null) ? all.flat() : null;
      }
      const ch = flattenChain(node);
      if (isIdent(ch.root) && ch.methods.length > 0 && ch.methods.every((m) => m.call)) return [{ name: ch.root.name, methods: ch.methods }];
      return null;
    };

    const sections: ArrangementDraft['sections'] = [];
    const perSection: Array<Map<string, Method[]>> = [];
    for (let i = 0; i < root.arguments.length; i++) {
      const entry = root.arguments[i]!;
      const els = entry.type === 'ArrayExpression' ? field<Array<JsNode | null>>(entry, 'elements') : null;
      const cycles = els?.length === 2 ? evalNumber(els[0] ?? undefined, this.numbers) : null;
      const content = els?.[1];
      if (!els || cycles === null || cycles <= 0 || !content) return fallback(snippet(this.src.code.slice(entry.start, entry.end), 30));
      const list = uses(content);
      if (!list) return fallback(snippet(this.src.code.slice(content.start, content.end), 30));
      const map = new Map<string, Method[]>();
      for (const u of list) {
        const decl = this.decls.get(u.name);
        if (!decl || decl.type === 'FunctionDeclaration' || !this.isPatternExpr(decl)) return fallback(u.name);
        const prev = map.get(u.name);
        const text = (ms: Method[]) => ms.map((m) => this.src.code.slice(m.start, m.end).replace(/\s+/g, '')).join('');
        if (prev && text(prev) !== text(u.methods)) return fallback(u.name);
        map.set(u.name, u.methods);
      }
      const comment = this.rowComment(entry, null, true);
      sections.push(comment ? { cycles, name: sectionName(comment) } : { cycles });
      perSection.push(map);
    }

    // Instrumente: alle Pattern-Deklarationen in Original-Reihenfolge; ungenutzte stumm.
    const used = new Set(perSection.flatMap((m) => [...m.keys()]));
    const instruments = [...this.declStmts.entries()].filter(([name, st]) => used.has(name) || (st.type === 'VariableDeclaration' && this.isPatternExpr(this.decls.get(name)!)));
    const tracks: TrackDraft[] = [];
    const cells: ArrangementDraft['cells'] = [];
    const convs: TrackConverter[] = [];
    for (const [name, stmt] of instruments) {
      const conv = new TrackConverter(this, { expr: this.decls.get(name)!, stmt, label: null, name: identName(name) });
      const draft = conv.run();
      const id = c.label ?? pName(chain);
      if (id !== null && (id.startsWith('_') || id.endsWith('_'))) draft.muted = true; // _$: arrange(…)
      if (!used.has(name)) {
        draft.muted = true;
        draft.notes.push(note('info', 'importer.note.instrumentUnused', { name }));
      }
      tracks.push(draft);
      convs.push(conv);
    }
    for (let t = 0; t < instruments.length; t++) {
      const [name] = instruments[t]!;
      if (!used.has(name)) continue;
      const draft = tracks[t]!;
      for (let si = 0; si < perSection.length; si++) {
        const methods = perSection[si]!.get(name);
        if (!methods) {
          cells.push({ track: t, section: si, on: false });
          continue;
        }
        const code = convs[t]!.variantCode([...methods, ...outer], draft.volume);
        if (code === null) return fallback(`${name}.gain()`);
        cells.push(code === '' ? { track: t, section: si, on: true } : { track: t, section: si, on: true, code });
      }
    }
    // Deklarationen nicht zusätzlich ins prelude – außer sie werden anderswo verwendet.
    for (const [name, stmt] of instruments) {
      if (!this.referencedOutside(name, stmt, root)) this.asTracks.add(stmt);
    }
    this.notes.push(note('info', 'importer.note.arrangement', { count: sections.length, tracks: used.size }));
    return { tracks, arrangement: { sections, cells } };
  }

  /**
   * Song-Ablauf im Format des mixr-Compilers: pro Spur ein Instrument
   * (`const beatPart = s(…)…`) und ein eigenes `$: arrange([4, silence], [8, beatPart],
   * [8, beatPart.lpf(800)]).gain(0.9)`. Jedes arrange(…) verwendet genau EIN Instrument,
   * alle haben dieselben Abschnittslängen. Hinter arrange(…) erlaubt: `.gain(zahl)`
   * (→ Spur-Lautstärke), `.orbit(zahl)` (→ Code-Baustein wie bei Spuren ohne Ablauf)
   * und Klang-Parameter mit festen Werten (→ in jede Abwandlung).
   * `null` = anderes Format (dann gilt convertArrange bzw. Code-Spur).
   */
  private convertTrackArranges(cands: Candidate[]): {
    tracks: Map<Candidate, TrackDraft>;
    cells: Map<Candidate, Array<{ on: boolean; code?: string }>>;
    sections: ArrangementDraft['sections'];
  } | null {
    interface Parsed {
      cand: Candidate;
      inst: string;
      entries: Array<{ cycles: number; methods: Method[] | null; node: JsNode }>;
      outer: Method[];
      gain: number | null;
      orbit: string | null;
      root: JsNode;
    }
    const parsed: Parsed[] = [];
    const seen = new Set<string>();
    for (const cand of cands) {
      const chain = flattenChain(cand.expr);
      const root = chain.root;
      if (!isCall(root) || root.arguments.length === 0) return null;
      let gain: number | null = null;
      let orbit: string | null = null;
      const outer: Method[] = [];
      for (const m of chain.methods) {
        if (VISUALS.has(m.name) || ((m.name === 'p' || /^[pdq]\d$/.test(m.name)) && m.call)) continue;
        if (!m.call || m.args.length !== 1) return null;
        const x = evalNumber(m.args[0], this.numbers);
        if (m.name === 'gain' && x !== null && gain === null) gain = x;
        else if ((m.name === 'orbit' || m.name === 'o') && x !== null && orbit === null && gain === null) orbit = fmtNum(x);
        else if (gain === null && this.kind(m.name) === 'fx' && canonical(m.name) !== 'gain' && (x !== null || stringValue(m.args[0]) !== null)) outer.push(m);
        else return null;
      }
      let inst: string | null = null;
      const entries: Parsed['entries'] = [];
      for (const entry of root.arguments) {
        const els = entry.type === 'ArrayExpression' ? field<Array<JsNode | null>>(entry, 'elements') : null;
        const cycles = els?.length === 2 ? evalNumber(els[0] ?? undefined, this.numbers) : null;
        const content = els?.[1];
        if (!els || cycles === null || cycles <= 0 || !content) return null;
        if (isIdent(content) && content.name === 'silence') {
          entries.push({ cycles, methods: null, node: entry });
          continue;
        }
        const ch = flattenChain(content);
        if (!isIdent(ch.root) || !ch.methods.every((m) => m.call)) return null;
        if (inst !== null && inst !== ch.root.name) return null;
        inst = ch.root.name;
        entries.push({ cycles, methods: ch.methods, node: entry });
      }
      if (inst === null || seen.has(inst)) return null;
      const decl = this.decls.get(inst);
      if (!decl || decl.type === 'FunctionDeclaration' || !this.isPatternExpr(decl)) return null;
      // Eigene Lautstärke im Instrument UND gain hinter arrange(…) → nicht als eine Spur-Lautstärke darstellbar.
      if (gain !== null && flattenChain(decl).methods.some((m) => m.name === 'gain')) return null;
      seen.add(inst);
      parsed.push({ cand, inst, entries, outer, gain, orbit, root });
    }
    // Gemeinsame Abschnitte: Der Compiler fasst Pausen zusammen ([4, silence], [8, silence] →
    // [12, silence]) – die Abschnittsgrenzen aller Spuren zusammen ergeben die Abschnitte.
    // Ein Eintrag mit Klang darf keine Grenze überspannen (er beginnt die Spur von vorn).
    const ends = (p: Parsed) => p.entries.reduce<number[]>((acc, e) => [...acc, (acc[acc.length - 1] ?? 0) + e.cycles], []);
    const total = ends(parsed[0]!).at(-1)!;
    if (!parsed.every((p) => Math.abs(ends(p).at(-1)! - total) < 1e-9)) return null;
    const bounds = [...new Set(parsed.flatMap(ends).map((x) => Math.round(x * 1e9) / 1e9))].sort((a, b) => a - b);
    const cycles = bounds.map((b, i) => Math.round((b - (bounds[i - 1] ?? 0)) * 1e9) / 1e9);
    /** Eintrag je gemeinsamem Abschnitt (null = Grenze mitten in einem Klang-Eintrag). */
    const refine = (p: Parsed): Array<Parsed['entries'][number] & { exact: boolean }> | null => {
      const out: Array<Parsed['entries'][number] & { exact: boolean }> = [];
      let start = 0;
      let k = 0;
      for (const e of p.entries) {
        const end = start + e.cycles;
        while (k < bounds.length && bounds[k]! <= end + 1e-9) {
          const secStart = bounds[k - 1] ?? 0;
          const exact = Math.abs(secStart - start) < 1e-9 && Math.abs(bounds[k]! - end) < 1e-9;
          if (e.methods !== null && !exact) return null;
          out.push({ ...e, exact });
          k++;
        }
        start = end;
      }
      return out.length === bounds.length ? out : null;
    };
    const refined = new Map<Parsed, NonNullable<ReturnType<typeof refine>>>();
    for (const p of parsed) {
      const r = refine(p);
      if (!r) return null;
      refined.set(p, r);
    }

    const tracks = new Map<Candidate, TrackDraft>();
    const cells = new Map<Candidate, Array<{ on: boolean; code?: string }>>();
    for (const p of parsed) {
      const stmt = this.declStmts.get(p.inst)!;
      const name = this.commentAbove(stmt) ?? this.commentAbove(p.cand.stmt) ?? identName(p.inst.replace(/Part\d*$/, '') || p.inst);
      const conv = new TrackConverter(this, { expr: this.decls.get(p.inst)!, stmt, label: p.cand.label, name });
      const draft = conv.run();
      if (p.gain !== null) {
        draft.volume = Math.min(1, Math.max(0, p.gain));
        if (draft.volume !== p.gain) draft.notes.push(note('info', 'importer.note.gainClamped', { gain: fmtNum(p.gain), volume: fmtNum(draft.volume) }));
      }
      if (p.orbit !== null) {
        const text = `.orbit(${p.orbit})`;
        const last = draft.blocks[draft.blocks.length - 1];
        if (last?.type === 'code-fx') last.params['code'] = `${String(last.params['code'])}${text}`;
        else draft.blocks.push({ type: 'code-fx', params: { code: text } });
      }
      const row: Array<{ on: boolean; code?: string }> = [];
      for (const e of refined.get(p)!) {
        if (e.methods === null) {
          row.push({ on: false });
          continue;
        }
        const code = conv.variantCode([...e.methods, ...p.outer], draft.volume);
        if (code === null) return null;
        row.push(code === '' ? { on: true } : { on: true, code });
      }
      tracks.set(p.cand, draft);
      cells.set(p.cand, row);
      if (!this.referencedOutside(p.inst, stmt, p.root)) this.asTracks.add(stmt);
    }
    const sections = cycles.map((c, i) => {
      // Name aus dem Kommentar am Eintrag einer Spur, die genau diesen Abschnitt hat
      const exact = parsed.map((p) => refined.get(p)![i]!).find((e) => e.exact);
      const comment = exact ? this.rowComment(exact.node, null, true) : null;
      return comment ? { cycles: c, name: sectionName(comment) } : { cycles: c };
    });
    this.notes.push(note('info', 'importer.note.arrangement', { count: sections.length, tracks: parsed.length }));
    return { tracks, cells, sections };
  }

  /** Wert einer Deklaration ist ein Pattern-Ausdruck (s(…), note(…), stack(…), anderes Instrument …)? */
  private isPatternExpr(node: JsNode, depth = 0): boolean {
    const root = flattenChain(node).root;
    const name = calleeName(root);
    if (name !== null) return PATTERN_FUNCTIONS.has(name);
    if (isIdent(root) && depth < 8) {
      const d = this.decls.get(root.name);
      return !!d && d.type !== 'FunctionDeclaration' && this.isPatternExpr(d, depth + 1);
    }
    return false;
  }

  /** Wird der Bezeichner außerhalb seiner Deklaration und des arrange-Aufrufs verwendet? */
  private referencedOutside(name: string, stmt: JsNode, arrange: JsNode): boolean {
    let found = false;
    walk(this.src.program, (node, parent) => {
      if (found || !isIdent(node) || node.name !== name) return;
      if (parent && isMember(parent) && parent.property === node && !parent.computed) return;
      if (node.start >= stmt.start && node.end <= stmt.end) return;
      if (node.start >= arrange.start && node.end <= arrange.end) return;
      found = true;
    });
    return found;
  }

  private preludeText(): string {
    for (const st of this.asTracks) {
      const i = this.prelude.indexOf(st);
      if (i >= 0) this.prelude.splice(i, 1);
    }
    if (this.prelude.length === 0) return '';
    const printer = new TrackConverter(this, { expr: this.src.program, stmt: this.src.program, label: null });
    const text = printer.printPrelude(this.prelude);
    this.notes.push(...printer.notes);
    const names = [...this.registered.keys()];
    this.notes.push(
      names.length > 0
        ? note('info', 'importer.note.preludeKept', { names: names.join(', ') })
        : note('info', 'importer.note.preludeKeptPlain'),
    );
    return text;
  }

  /**
   * `stack(a, b, …).fx()` → eine Spur pro Zeile (`a.fx()`, `b.fx()`), damit jede
   * Zeile ihre eigene Lautstärke/Effekte behält. Ausnahmen: Drum-Zeilen mit
   * identischer Kette (→ ein gemeinsames Raster) und Methoden hinter dem stack,
   * die sich nicht auf die Zeilen verteilen lassen (→ eine Spur).
   */
  private splitStack(c: Candidate): Candidate[] {
    const chain = flattenChain(c.expr);
    if (calleeName(chain.root) !== 'stack' || !isCall(chain.root)) return [c];
    const rows = chain.root.arguments;
    if (rows.length < 2 || rows.some((r) => r.type === 'SpreadElement')) return [c];
    const distributive = chain.methods.every(
      (m) => VISUALS.has(m.name) || ['s', 'bank', 'orbit', 'p'].includes(canonical(m.name)) || this.kind(m.name) !== 'source',
    );
    if (!distributive || this.mergeableDrumStack(chain)) return [c];
    const base = c.label ?? pName(chain);
    const baseName = base !== null ? cleanId(base) : null;
    return rows.map((row, i) => ({
      expr: row,
      stmt: c.stmt,
      label: c.label,
      row: {
        outer: chain.methods,
        base: baseName || this.commentAbove(c.stmt),
        comment: this.rowComment(row, rows[i + 1] ?? null),
      },
    }));
  }

  /** Alle Zeilen sind Drum-Zeilen mit gleicher Kette (abgesehen vom Klang) und verschiedenen Instrumenten. */
  mergeableDrumStack(chain: Chain): boolean {
    if (!isCall(chain.root)) return false;
    const outerBank = chain.methods.find((m) => m.name === 'bank' && m.call);
    const outerS = chain.methods.find((m) => canonical(m.name) === 's' && m.call);
    const seen = new Set<string>();
    let signature: string | null = null;
    for (const arg of chain.root.arguments) {
      const row = flattenChain(arg);
      const name = calleeName(row.root);
      if (name !== 's' && name !== 'sound') return false;
      const sig = rowSignature(this.src.code, row.methods);
      if (signature !== null && sig !== signature) return false;
      signature = sig;
      const bank = outerBank ?? row.methods.find((m) => m.name === 'bank' && m.call);
      const sm = outerS ?? row.methods.find((m) => canonical(m.name) === 's' && m.call);
      const det = detectDrumRow(row.root, bank, sm, this.available);
      if (!det) return false;
      for (const inst of det.hits.keys()) {
        if (seen.has(inst)) return false;
        seen.add(inst);
      }
    }
    return true;
  }

  /** Kommentar hinter einer stack-Zeile (gleiche Zeile) oder direkt darüber. */
  rowComment(row: JsNode, next: JsNode | null, long = false): string | null {
    const code = this.src.code;
    const after = this.src.comments.find(
      (c) => c.start >= row.end && (next === null || c.end <= next.start) && !code.slice(row.end, c.start).includes('\n'),
    );
    const ownLine = (c: { start: number }) => /(^|\n)[ \t]*$/.test(code.slice(0, c.start));
    const before = this.src.comments.filter(
      (c) => c.end <= row.start && ownLine(c) && code.slice(c.end, row.start).trim() === '' && (code.slice(c.end, row.start).match(/\n/g) ?? []).length <= 1,
    );
    for (const c of long ? [before[before.length - 1], after] : [after, before[before.length - 1]]) {
      const text = c ? cleanComment(c.value, long ? 80 : 40) : null;
      if (text) return text;
    }
    return null;
  }

  private collectKeyHints(): void {
    walk(this.src.program, (node) => {
      if (!isCall(node)) return;
      const callee = node.callee;
      const name = isIdent(callee) ? callee.name : isMember(callee) && isIdent(callee.property) ? callee.property.name : null;
      const text = stringValue(node.arguments[0]);
      if (text === null) return;
      if (name === 'scale') {
        const k = parseScale(text);
        if (k) this.keyHints.push({ pc: PITCH_CLASS[k.root]!, scale: k.scale, from: 'scale' });
      } else if (name === 'chord') {
        for (const a of miniAtoms(text) ?? []) {
          const m = /^([A-Ga-g][#b]?)(m(?!aj)|min|-)?/.exec(a.source);
          const pc = m ? PITCH_CLASS[ROOT_MAP[m[1]!.toLowerCase()] ?? ''] : undefined;
          if (m && pc !== undefined) this.keyHints.push({ pc, scale: m[2] ? 'minor' : 'major', from: 'chord' });
        }
      }
    });
  }

  private collectDeclarations(body: JsNode[]): void {
    const code = this.src.code;
    const setsGain = (n: JsNode) => /(^|[^\w$])gain\s*\(/.test(code.slice(n.start, n.end));
    for (const stmt of body) {
      walk(stmt, (node) => {
        if (calleeName(node) !== 'register' || !isCall(node)) return;
        const first = node.arguments[0];
        const names =
          first?.type === 'ArrayExpression'
            ? field<Array<JsNode | null>>(first, 'elements').map((e) => (e ? stringValue(e) : null))
            : [stringValue(first)];
        const fn = node.arguments[1];
        const text = fn ? code.slice(fn.start, fn.end) : '';
        // Art nach den Methoden, die direkt auf dem Pattern-Parameter (letzter Parameter) aufgerufen werden.
        const params = fn && isFunction(fn) ? fn.params : [];
        const lastParam = params[params.length - 1];
        const patName = isIdent(lastParam) ? lastParam.name : 'pat';
        const direct = [...text.matchAll(new RegExp(`(?:^|[^\\w$])${patName.replace(/\$/g, '\\$')}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g'))];
        const kinds = (direct.length ? direct : [...text.matchAll(/\.(\w+)\s*\(/g)]).map((m) => methodKind(m[1]!));
        const kind: MethodKind = kinds.includes('mod') || !kinds.includes('fx') ? 'mod' : 'fx';
        for (const n of names) {
          if (n === null) continue;
          this.registered.set(n, kind);
          this.registeredBodies.set(n, text);
          if (fn && setsGain(fn)) this.gainNames.add(n);
        }
      });
    }
    for (const stmt of body) {
      if (stmt.type === 'VariableDeclaration') {
        for (const d of field<JsNode[]>(stmt, 'declarations')) {
          const id = field<JsNode>(d, 'id');
          const init = field<JsNode | null>(d, 'init');
          if (isIdent(id) && init) {
            this.decls.set(id.name, init);
            this.declStmts.set(id.name, stmt);
            if (setsGain(init)) this.gainNames.add(id.name);
            const n = evalNumber(init, this.numbers);
            if (n !== null) this.numbers.set(id.name, n);
          }
        }
      } else if (stmt.type === 'FunctionDeclaration') {
        const id = field<JsNode | null>(stmt, 'id');
        if (isIdent(id)) {
          this.decls.set(id.name, stmt);
          if (setsGain(stmt)) this.gainNames.add(id.name);
        }
      }
    }
  }

  /**
   * Liefert `samples(…)` nur Klänge, die der Nutzer als eigene Slots hat? Bei einer
   * Objekt-Angabe zählen deren Schlüssel, sonst alle im Code benutzten Klänge, die
   * es nicht ohnehin gibt.
   */
  private samplesCoveredBySlots(call: JsNode): boolean {
    if (this.available.size === 0 || !isCall(call)) return false;
    const map = call.arguments.find((a) => a.type === 'ObjectExpression');
    let names: string[];
    if (map) {
      names = field<JsNode[]>(map, 'properties').map((p) => {
        const key = field<JsNode>(p, 'key');
        return isIdent(key) ? key.name : String(stringValue(key) ?? '');
      });
    } else {
      names = [];
      for (const [node, mark] of this.marks) {
        const value = stringValue(node);
        if (mark.kind !== 'sound' || value === null) continue;
        for (const a of miniAtoms(value) ?? []) {
          if (!/^[A-Za-z]/.test(a.source)) continue;
          const n = a.source.toLowerCase();
          if (isAvailable(n, mark.ctx) || !isKnownSound(n)) names.push(mark.ctx.bankName ? `${mark.ctx.bankName}_${n}` : n);
        }
      }
    }
    return names.length > 0 && names.every((n) => n !== '' && (this.available.has(n.toLowerCase()) || isKnownSound(n)));
  }

  /** Markiert alle String-Literale, die Klang- bzw. Bank-Namen enthalten. */
  private markSounds(): void {
    walk(this.src.program, (node, parent) => {
      if (!isCall(node) && !isMember(node)) return;
      if (parent && isMember(parent) && parent.object === node) return; // nur äußerstes Glied einer Kette
      if (parent && isCall(parent) && parent.callee === node) return;
      const chain = flattenChain(node);
      const rootName = calleeName(chain.root);
      const bank = chain.methods.some((m) => m.name === 'bank' && m.call);
      const tonal = (rootName !== null && TONAL_ROOTS.has(rootName)) || chain.methods.some((m) => TONAL_METHODS.has(m.name));
      const bankName = stringValue(chain.methods.find((m) => m.name === 'bank' && m.call)?.args[0]) ?? undefined;
      const ctx: SoundContext = bankName !== undefined ? { bank, tonal, bankName, available: this.available } : { bank, tonal, available: this.available };
      if ((rootName === 's' || rootName === 'sound') && isCall(chain.root)) this.markArg(chain.root.arguments[0], ctx);
      for (const m of chain.methods) {
        if (!m.call) continue;
        if (m.name === 's' || m.name === 'sound') this.markArg(m.args[0], ctx);
        if (m.name === 'bank' && stringValue(m.args[0]) !== null) this.marks.set(m.args[0]!, { kind: 'bank' });
      }
    });
  }

  private markArg(node: JsNode | undefined, ctx: SoundContext): void {
    if (!node) return;
    if (stringValue(node) !== null) {
      this.marks.set(node, { kind: 'sound', ctx });
    } else if (node.type === 'ArrayExpression') {
      for (const el of field<Array<JsNode | null>>(node, 'elements')) if (el) this.markArg(el, ctx);
    } else if (isCall(node)) {
      const name = calleeName(node);
      if (name !== null && LIST_FUNCTIONS.has(name)) for (const a of node.arguments) this.markArg(a, ctx);
      else if (isMember(node.callee)) this.markArg(flattenChain(node).root, ctx);
    }
  }

  private statement(stmt: JsNode, candidates: Candidate[]): void {
    const code = (n: JsNode) => snippet(this.src.code.slice(n.start, n.end), 40);
    switch (stmt.type) {
      case 'ExpressionStatement': {
        let expr = field<JsNode>(stmt, 'expression');
        if (expr.type === 'AwaitExpression') expr = field<JsNode>(expr, 'argument');
        const root = flattenChain(expr).root;
        const name = calleeName(expr) ?? calleeName(root);
        if (name !== null && name in TEMPO_CALLS && isCall(expr)) {
          this.tempo(TEMPO_CALLS[name]!, expr.arguments[0], code(expr));
        } else if (name === 'samples') {
          const own = this.samplesCoveredBySlots(expr);
          this.notes.push(own ? note('info', 'importer.note.samplesSlots', { code: code(expr) }) : note('dropped', 'importer.note.samplesDropped', { code: code(expr) }));
        } else if (name === 'hush' || name === 'initHydra') {
          this.notes.push(note('dropped', 'importer.note.setupDropped', { code: code(expr) }));
        } else if ((name !== null && SETUP_CALLS.has(name)) || expr.type === 'AssignmentExpression' || expr.type === 'UpdateExpression') {
          this.prelude.push(stmt); // register(…), aliasBank(…), Zuweisungen … → Setup-Code
        } else {
          candidates.push({ expr, stmt, label: null });
        }
        return;
      }
      case 'LabeledStatement': {
        const body = field<JsNode>(stmt, 'body');
        const label = field<JsNode>(stmt, 'label');
        if (body.type === 'ExpressionStatement' && isIdent(label)) {
          let expr = field<JsNode>(body, 'expression');
          if (expr.type === 'AwaitExpression') expr = field<JsNode>(expr, 'argument');
          candidates.push({ expr, stmt, label: label.name });
          return;
        }
        break;
      }
      case 'VariableDeclaration':
      case 'FunctionDeclaration':
        this.prelude.push(stmt);
        return;
      case 'EmptyStatement':
        return;
    }
    this.notes.push(note('dropped', 'importer.note.statementDropped', { line: lineOf(stmt), code: code(stmt) }));
  }

  private tempo(kind: 'cpm' | 'cps', arg: JsNode | undefined, code: string): void {
    const v = evalNumber(arg, this.numbers);
    if (v === null || v <= 0) {
      this.notes.push(note('info', 'importer.note.tempoNotConstant', { code, bpm: this.bpm }));
      return;
    }
    const raw = kind === 'cpm' ? v * 4 : v * 240;
    const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(raw)));
    // Nur der letzte Aufruf zählt (wie in Strudel) → frühere Tempo-Hinweise ersetzen.
    for (let i = this.notes.length - 1; i >= 0; i--) {
      if (this.notes[i]!.key === 'importer.note.tempoAdjusted' || this.notes[i]!.key === 'importer.note.tempoNotConstant') this.notes.splice(i, 1);
    }
    this.bpm = bpm;
    if (Math.abs(raw - bpm) > 1e-9) this.notes.push(note('info', 'importer.note.tempoAdjusted', { original: fmtNum(raw, 2), bpm }));
  }

  /** Kommentar direkt über einer Anweisung (für den Spurnamen). */
  commentAbove(stmt: JsNode): string | null {
    const before = this.src.comments.filter((c) => c.end <= stmt.start);
    const c = before[before.length - 1];
    if (!c) return null;
    const between = this.src.code.slice(c.end, stmt.start);
    if (between.trim() !== '' || (between.match(/\n/g) ?? []).length > 1) return null;
    return cleanComment(c.value);
  }
}

/** Kommentartext als Name: erste Zeile ohne Zierzeichen; Auskommentierter Code/Metadaten → null. */
function cleanComment(value: string, max = 40): string | null {
  const text = value
    .split('\n')
    .map((l) => l.replace(/^[\s*#=\-/]+/, '').replace(/[\s*#=\-/]+$/, ''))
    .find((l) => l !== '');
  if (!text || text.length > max || /@by|@title|^[.$]|\w\(|=>|[;{}=]/.test(text)) return null;
  return text;
}

/** Abschnittsname aus Kommentar: „BREAKDOWN - hands in the air“ → „Breakdown – hands in the air“. */
function sectionName(text: string): string {
  const out = text
    .replace(/\s+-\s+/g, ' – ')
    .replace(/\b[A-ZÄÖÜ]{2,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
  return out.length > 40 ? `${out.slice(0, 39).trimEnd()}…` : out;
}

/** Bezeichner → Spurname: „bassArp“ → „Bass Arp“, „lead_synth“ → „Lead Synth“. */
function identName(name: string): string {
  return name
    .replace(/[_$]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map(capitalize)
    .join(' ');
}

/** Funktionen, die ein Pattern liefern (für die Instrument-Erkennung). */
const PATTERN_FUNCTIONS = new Set(['s', 'sound', 'note', 'n', 'chord', 'stack', 'cat', 'seq', 'fastcat', 'slowcat', 'sequence', 'arrange', 'pure', 'mini', 'm', 'freq', 'timeCat', 'stepcat', 'polymeter']);

/** Label/Pattern-Name → Anzeigename („$drums“ → „Drums“), leer bei anonymen. */
function cleanId(id: string): string {
  const clean = id.replace(/^[_$]+|[_$]+$/g, '').replace(/\$/g, '');
  return clean !== '' && !/^\d+$/.test(clean) ? capitalize(clean) : '';
}

/** Kette einer Drum-Zeile ohne Klang-/Bank-Angaben und Visualisierungen (für den Vergleich). */
function rowSignature(code: string, methods: Method[]): string {
  return methods
    .filter((m) => !VISUALS.has(m.name) && !['s', 'bank'].includes(canonical(m.name)))
    .map((m) => code.slice(m.start, m.end).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ''))
    .join('');
}

/**
 * Drum-Treffer einer `s("…")`-Zeile auf 16 Steps (mit `.bank()` / `.s()`-Überschreibung);
 * `null` = nicht exakt abbildbar.
 */
function detectDrumRow(
  root: JsNode,
  bank: Method | undefined,
  sOverride: Method | undefined,
  available: ReadonlySet<string>,
): DrumRow | null {
  if (!isCall(root) || root.arguments.length !== 1) return null;
  const text = stringValue(root.arguments[0]);
  if (text === null) return null;
  let bankName: string | undefined;
  if (bank) {
    const b = stringValue(bank.args[0]);
    if (b === null || bank.args.length !== 1) return null;
    bankName = b;
  }
  let override: string | undefined;
  if (sOverride) {
    const o = stringValue(sOverride.args[0]);
    if (o === null || !SINGLE_SOUND.test(o.trim())) return null;
    override = o.trim().replace(/:0$/, '');
  }
  const cycles = miniCycles(text, CHECK_CYCLES);
  if (!cycles || !periodic(cycles)) return null;
  const hits = new Map<string, boolean[]>();
  const durations = new Map<string, Frac[]>();
  const kits: Kit[] = [];
  const subs: Array<[string, string, Kit]> = [];
  const step16 = new Frac(16);
  for (const ev of cycles[0]!) {
    const pos = ev.begin.mul(step16);
    if (pos.d !== 1) return null;
    let value = ev.value;
    if (Array.isArray(value)) {
      if (value.length !== 2 || value[1] !== 0) return null;
      value = value[0];
    }
    if (typeof value !== 'string') return null;
    const sound = override ?? value;
    // Eigene Klänge (Slots) bleiben, wie sie sind – kein Kit-Raster.
    if (isAvailable(sound, bankName !== undefined ? { available, bankName } : { available })) return null;
    const ds = drumSound(sound, bankName);
    if (!ds) return null;
    const row = hits.get(ds.inst) ?? Array<boolean>(16).fill(false);
    if (row[pos.n]) return null; // doppelter Schlag → im Raster nicht darstellbar
    row[pos.n] = true;
    hits.set(ds.inst, row);
    durations.set(ds.inst, [...(durations.get(ds.inst) ?? []), ev.end.sub(ev.begin)]);
    kits.push(ds.kit);
    if (!ds.exact) subs.push([bankName !== undefined && !sound.includes('_') ? `${bankName} ${sound}` : sound, ds.inst, ds.kit]);
  }
  if (hits.size === 0) return null;
  return { hits, kits, subs, durations };
}

interface DrumRow {
  hits: Map<string, boolean[]>;
  kits: Kit[];
  subs: Array<[string, string, Kit]>;
  /** Original-Dauern der Schläge je Instrument. */
  durations: Map<string, Frac[]>;
}

/** Operationen, deren Ergebnis von der Event-Dauer abhängt (ply teilt das Event, clip/legato/Hüllkurve …). */
const DURATION_OPS = /\b(ply|chop|striate|slice|splice|legato|clip|euclidLegato\w*|fit|loopAt|attack|decay|sustain|release|adsr|hold)\b/;

/**
 * Dauer eines Raster-Schlags im kompilierten Code (wie compiler/sequence.ts):
 * ausgedünnt (größter Teiler d mit allen Schlägen auf Vielfachen von d) oder 1/16.
 */
function compiledStep(row: boolean[], stretch: boolean): Frac {
  if (!stretch) return new Frac(1, row.length);
  for (let d = row.length; d >= 1; d--) {
    if (row.length % d === 0 && row.every((hit, i) => !hit || i % d === 0)) return new Frac(d, row.length);
  }
  return new Frac(1, row.length);
}

function lineOf(node: JsNode): number {
  return node.loc?.start.line ?? 1;
}

/** Name aus `.p("name")` / `.p1` am Kettenende. */
function pName(chain: Chain): string | null {
  for (const m of chain.methods) {
    if (m.name === 'p' && m.call) {
      const s = stringValue(m.args[0]);
      const n = evalNumber(m.args[0]);
      return s ?? (n !== null ? String(n) : null);
    }
    if (/^[pd]\d$/.test(m.name) && !m.call) return m.name.slice(1);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Noten & Tonarten                                                    */
/* ------------------------------------------------------------------ */

/** Höchste Skalenstufe des Melodie-Rasters (Katalog: Anzahl Zeilen − 1). */
export const MAX_DEGREE = (() => {
  const def = getBlockDef('melody').params.find((p) => p.type === 'noteGrid');
  return def?.type === 'noteGrid' ? def.degrees - 1 : 7;
})();

export interface KeyHint {
  pc: number;
  scale: string;
  /** `.scale(…)` im Code wiegt mehr als ein Akkord-Grundton. */
  from: 'scale' | 'chord';
}

export interface Key {
  root: string;
  scale: string;
  octave: string;
}

/** Halbtonschritte der Katalog-Skalen (wie tonal). */
const SCALE_STEPS: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  'minor:pentatonic': [0, 3, 5, 7, 10],
  'major:pentatonic': [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic:minor': [0, 2, 3, 5, 7, 8, 11],
};

const PITCH_CLASS: Record<string, number> = Object.fromEntries(OPTION_SETS.notes.map((o, i) => [o.value, i]));

/** „C3:minor“, „Eb4:minor:pentatonic“ → Katalog-Tonart (Lage ohne Angabe: 3). */
function parseScale(text: string): Key | null {
  const m = /^([A-Ga-g])([#b]?)(\d)?:(.+)$/.exec(text.trim());
  if (!m) return null;
  const root = ROOT_MAP[`${m[1]!.toLowerCase()}${m[2] ?? ''}`];
  const octave = m[3] ?? '3';
  const scale = SCALE_MAP[m[4]!.toLowerCase().replace(/\s+/g, ':')];
  if (!root || !scale || !OPTION_SETS.octaves.some((o) => o.value === octave)) return null;
  return { root, scale, octave };
}

const LETTER: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Notenname („eb2“, „C#4“, „f“ = Lage 3) oder MIDI-Zahl → MIDI; sonst null. */
export function noteMidi(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^([a-gA-G])(#{1,2}|b{1,2}|s|f)?(-?\d+)?$/.exec(v);
  if (!m) return null;
  const acc = m[2] ?? '';
  const shift = acc.startsWith('#') || acc === 's' ? acc.length || 1 : acc.startsWith('b') || acc === 'f' ? -(acc.length || 1) : 0;
  const octave = m[3] === undefined ? 3 : Number(m[3]);
  return 12 * (octave + 1) + LETTER[m[1]!.toLowerCase()]! + shift;
}

/** MIDI → Skalenstufe in der Tonart (null = nicht in der Skala). */
export function midiToDegree(midi: number, key: Key): number | null {
  const steps = SCALE_STEPS[key.scale]!;
  const rel = midi - (12 * (Number(key.octave) + 1) + PITCH_CLASS[key.root]!);
  if (rel < 0) return null;
  const idx = steps.indexOf(rel % 12);
  return idx < 0 ? null : Math.floor(rel / 12) * steps.length + idx;
}

/**
 * Wählt Grundton × Skala × Lage, sodass alle Töne Stufen 0…MAX_DEGREE sind. Bevorzugt:
 * die Tonart der eigenen Kette (`.scale(…)`), dann im übrigen Code vorkommende
 * Tonarten (`.scale(…)` anderer Spuren, Akkord-Grundtöne), dann Moll/Dur, dann
 * möglichst tiefe Stufen.
 */
export function chooseKey(midis: number[], hints: KeyHint[], own: KeyHint | null): Key | null {
  let best: { key: Key; score: number[] } | null = null;
  OPTION_SETS.scales.forEach((sc, scaleIdx) => {
    for (const rootOpt of OPTION_SETS.notes) {
      for (const oct of OPTION_SETS.octaves) {
        const key = { root: rootOpt.value, scale: sc.value, octave: oct.value };
        const degrees = midis.map((m) => midiToDegree(m, key));
        if (degrees.some((d) => d === null || d > MAX_DEGREE)) continue;
        const ds = degrees as number[];
        const matches = (h: KeyHint) => h.pc === PITCH_CLASS[key.root] && h.scale === key.scale;
        const hinted = own && matches(own) ? 0 : hints.some((h) => h.from === 'scale' && matches(h)) ? 1 : hints.some(matches) ? 2 : 3;
        const score = [hinted, scaleIdx < 2 ? 0 : 1, Math.min(...ds), Math.max(...ds), scaleIdx, PITCH_CLASS[key.root]!];
        if (!best || compareScore(score, best.score) < 0) best = { key, score };
      }
    }
  });
  return best === null ? null : (best as { key: Key }).key;
}

function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

interface MelodyGrid {
  steps: number;
  bars?: number;
  cells: number[][];
  lengths?: number[][];
}

function lcm(a: number, b: number): number {
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  return (a / g(a, b)) * b;
}

/**
 * Noten-Raster aus einem Muster: Musterlänge (Takte ∈ NOTE_GRID_BARS) und das
 * kleinste gemeinsame Step-Raster aller Start-/Endzeiten (≤ 16 Steps pro Takt).
 * Töne mit Start + Dauer (Haltetöne). `degree` liefert die Stufe 0…MAX_DEGREE eines Werts.
 */
function buildNoteGrid(pat: MiniPattern, degree: (v: unknown) => number | null): MelodyGrid | null {
  const cycles = queryCycles(pat, CHECK_CYCLES);
  if (!cycles) return null;
  const key = (evs: MiniEvent[]) => evs.map((e) => `${e.begin.n}/${e.begin.d}-${e.end.n}/${e.end.d}=${JSON.stringify(e.value)}`).join('|');
  const keys = cycles.map(key);
  const bars = NOTE_GRID_BARS.find((b) => keys.every((k, c) => k === keys[c % b]));
  if (bars === undefined) return null;
  const events = cycles.slice(0, bars).flatMap((evs, c) => evs.map((e) => ({ ...e, begin: e.begin.add(new Frac(c)), end: e.end.add(new Frac(c)) })));
  if (events.length === 0) return null;
  let steps = 1;
  for (const e of events) steps = lcm(lcm(steps, e.begin.d), e.end.d);
  if (steps > 16) return null;
  const total = steps * bars;
  const cells: number[][] = Array.from({ length: total }, () => []);
  const lengths: number[][] = Array.from({ length: total }, () => []);
  const S = new Frac(steps);
  for (const e of events) {
    const start = e.begin.mul(S);
    const len = e.end.sub(e.begin).mul(S);
    const d = degree(e.value);
    if (d === null || !Number.isInteger(d) || d < 0 || d > MAX_DEGREE || len.n < 1 || start.n + len.n > total) return null;
    if (cells[start.n]!.includes(d)) return null; // doppelter Ton am selben Start
    cells[start.n]!.push(d);
    lengths[start.n]!.push(len.n);
  }
  // Sortieren (Stufe + Dauer parallel)
  cells.forEach((c, i) => {
    const pairs = c.map((deg, k) => [deg, lengths[i]![k]!] as const).sort((a, b) => a[0] - b[0]);
    cells[i] = pairs.map((p) => p[0]);
    lengths[i] = pairs.map((p) => p[1]);
  });
  const held = lengths.some((row) => row.some((l) => l > 1));
  return held || bars > 1 ? { steps, bars, cells, lengths } : { steps, cells };
}

/* ------------------------------------------------------------------ */
/* Spur                                                                */
/* ------------------------------------------------------------------ */

/** Ein Kettenglied: ein Methodenaufruf, ggf. mit vorangestellten Eigenschaftszugriffen (`.add.squeeze(…)`). */
type Unit = Method[];

interface CodePiece {
  kind: 'code-mod' | 'code-fx';
  text: string;
}

type ChainItem = BlockSpec | CodePiece;

/** Rest der Kette hinter der Quelle; `unit` leer = eingefügtes Code-Stück (z. B. velocity). */
interface RestItem {
  unit: Unit;
  index: number;
  piece?: CodePiece;
}

interface MapContext {
  num: (m: Method, i?: number) => number | null;
  count: (name: string) => number;
  /** Partner-Glied (z. B. lpq zu lpf): null = keins, false = nicht eindeutig/kein Literal. */
  partner: (name: string) => { k: number; value: number } | null | false;
  used: Set<number>;
  /** Kanonische Form von „eine Oktave höher“ für die aktuelle Quelle. */
  upFn: string;
}

const isPiece = (i: ChainItem): i is CodePiece => 'text' in i;

interface SourceResult {
  blocks: BlockSpec[];
  /** Verbrauchte Kettenglieder (von vorn). */
  consumed: number;
  name: string;
  /** Bei aufgeteilten stack-Zeilen: Name des Teils (z. B. Instrument „Kick“). */
  part?: string;
  /** Tonhöhenfaktor der Sample-Quelle (für „Oktave höher“). */
  speed?: number;
}


const SCALE_MAP: Record<string, string> = {
  minor: 'minor',
  aeolian: 'minor',
  major: 'major',
  ionian: 'major',
  'minor:pentatonic': 'minor:pentatonic',
  'major:pentatonic': 'major:pentatonic',
  dorian: 'dorian',
  phrygian: 'phrygian',
  mixolydian: 'mixolydian',
  'harmonic:minor': 'harmonic:minor',
};

const ROOT_MAP: Record<string, string> = {
  c: 'C',
  'c#': 'C#',
  db: 'C#',
  d: 'D',
  'd#': 'Eb',
  eb: 'Eb',
  e: 'E',
  f: 'F',
  'f#': 'F#',
  gb: 'F#',
  g: 'G',
  'g#': 'Ab',
  ab: 'Ab',
  a: 'A',
  'a#': 'Bb',
  bb: 'Bb',
  b: 'B',
};

class TrackConverter {
  readonly notes: DraftNote[] = [];
  private readonly printer: Printer;
  /** Wenn gesetzt: verschachtelte `.gain(x)` werden zu `.velocity(x / divisor)`. */
  private velocityDivisor: number | null = null;
  private readonly noted = new Set<string>();
  muted = false;

  /** Original-Dauern des Drum-Rasters (für die Prüfung dauerabhängiger Operationen). */
  private drumDurations: Map<string, Frac[]> | null = null;

  constructor(
    private readonly prog: ProgramConverter,
    private readonly cand: Candidate,
    /** Kein Drum-Raster versuchen (Rückfall, wenn Dauern im Raster nicht stimmen würden). */
    private readonly noDrums = false,
  ) {
    this.printer = new Printer(prog.src, (node, printer) => this.hook(node, printer));
  }

  /** Einmalige Hinweise (gleiches Paar nur einmal pro Spur). */
  private once(id: string, n: DraftNote): void {
    if (this.noted.has(id)) return;
    this.noted.add(id);
    this.notes.push(n);
  }

  private substituted(from: string, to: string): void {
    const recipe = recipeFor(from);
    if (recipe && recipe.sound === to && !this.recipe) {
      this.recipe = recipe;
      this.recipeNote = note('substituted', `importer.note.recipe.${recipe.id}`, { from, to });
      this.once(`sub:${from}:${to}`, this.recipeNote);
      return;
    }
    this.once(`sub:${from}:${to}`, note('substituted', 'importer.note.sound', { from, to }));
  }

  /** Erstes Ersatz-Rezept der Spur (aus der Klangquelle) und sein Hinweis. */
  private recipe: Recipe | null = null;
  private recipeNote: DraftNote | null = null;

  /* ---------------------------- Ausgabe ---------------------------- */

  private hook(node: JsNode, printer: Printer): string | undefined {
    if (isCall(node)) {
      const callee = node.callee;
      if (isIdent(callee) && callee.name === 'slider' && node.arguments[0]) return printer.print(node.arguments[0], node);
      if (isMember(callee) && !callee.computed && isIdent(callee.property)) {
        const name = callee.property.name;
        if (VISUALS.has(name)) {
          this.dropVisual(name);
          return printer.print(callee.object, callee);
        }
        if (name === 'gain' && this.velocityDivisor !== null && node.arguments.length === 1) {
          return this.velocityText(node, callee.object, callee.property, printer);
        }
      }
    }
    const mark = this.prog.marks.get(node);
    if (mark) return this.soundText(node, mark);
    return undefined;
  }

  /**
   * Abwandlung einer Spur in einem Abschnitt (`hat.lpf(2000).gain(0.2)` → „.lpf(2000).velocity(…)“).
   * gain wird zu velocity relativ zur Spur-Lautstärke, weil der Compiler `.gain(volume)`
   * hinter arrange(…) setzt. `null` = nicht exakt darstellbar.
   */
  variantCode(methods: Method[], volume: number): string | null {
    const parts: string[] = [];
    for (const m of methods) {
      if (VISUALS.has(m.name)) {
        this.dropVisual(m.name);
        continue;
      }
      if (m.name === 'gain' && m.call && m.args.length === 1) {
        if (volume <= 0) return null;
        const x = evalNumber(m.args[0], this.prog.numbers);
        const inner = x !== null ? fmtNum(x / volume) : tidy(this.printer.print(m.args[0]!));
        parts.push(x === null && volume !== 1 ? `.velocity(${inner}).mul(velocity(${fmtNum(1 / volume)}))` : `.velocity(${inner})`);
        continue;
      }
      this.velocityDivisor = volume > 0 ? volume : null;
      parts.push(this.printUnit([m]));
      this.velocityDivisor = null;
    }
    return tidy(parts.join(''));
  }

  /** Setup-Code: Anweisungen in Original-Reihenfolge, gain → velocity (bezogen auf die Standard-Lautstärke). */
  printPrelude(stmts: JsNode[]): string {
    this.velocityDivisor = DEFAULT_GAIN;
    try {
      return stmts.map((st) => tidy(this.printer.print(st))).join('\n');
    } finally {
      this.velocityDivisor = null;
    }
  }

  private velocityText(call: JsNode & { arguments: JsNode[] }, object: JsNode, property: JsNode, printer: Printer): string {
    const v = this.velocityDivisor!;
    const arg = call.arguments[0]!;
    const head = `${printer.print(object, call)}${printer.gap(object.end, property.start)}velocity(`;
    this.once('velocity', note('info', 'importer.note.gainVelocity'));
    const x = evalNumber(arg, this.prog.numbers);
    if (x !== null) return `${head}${fmtNum(x / v)})`;
    const inner = printer.print(arg, call);
    return v === 1 ? `${head}${inner})` : `${head}${inner}).mul(velocity(${fmtNum(1 / v)}))`;
  }

  private soundText(node: JsNode, mark: SoundMark): string | undefined {
    const value = stringValue(node);
    if (value === null) return undefined;
    const q = quoteOf(node, this.prog.src.code);
    const raw = this.prog.src.code.slice(node.start + 1, node.end - 1);
    if (raw !== value) return undefined; // Escapes – lieber unverändert lassen
    if (mark.kind === 'bank') {
      if (isAvailableBank(value, this.prog.available)) return undefined; // eigene Klänge „bank_…“
      const kit = substituteBank(value);
      if (kit === value) return undefined;
      this.once(`bank:${value}`, note('substituted', 'importer.note.bank', { from: value, to: kit }));
      return `${q}${kit}${q}`;
    }
    const { text, replaced } = substituteMini(value, mark.ctx);
    for (const [from, to] of replaced) this.substituted(from, to);
    return `${q}${text}${q}`;
  }

  private dropVisual(name: string): void {
    // Pro Vorkommen; index.ts fasst alle zu einem Hinweis zusammen.
    this.notes.push(note('dropped', 'importer.note.visualsDropped', { names: name, count: 1 }));
  }

  private printNode(node: JsNode): string {
    return tidy(this.printer.print(node));
  }

  private printUnit(unit: Unit): string {
    return unit.map((m) => tidyMethod(this.printer.range(m.start, m.end, m.call ? m.call.arguments : [], m.call))).join('');
  }

  /* ----------------------------- Analyse ---------------------------- */

  run(): TrackDraft {
    let chain = flattenChain(this.cand.expr);
    // Konstante als Wurzel („const drums = s(…); $: drums.lpf(…)“) → einsetzen und mit analysieren.
    for (let depth = 0; depth < 8 && isIdent(chain.root); depth++) {
      const name = chain.root.name;
      const decl = this.prog.decls.get(name);
      if (!decl || decl.type === 'FunctionDeclaration' || calleeName(flattenChain(decl).root) === 'register') break;
      this.once(`inline:${name}`, note('info', 'importer.note.variableInlined', { name }));
      const inner = flattenChain(decl);
      chain = { root: inner.root, methods: [...inner.methods, ...chain.methods] };
    }
    // Aufgeteilte stack-Zeile: Methoden hinter dem stack gelten für jede Zeile.
    if (this.cand.row) chain = { root: chain.root, methods: [...chain.methods, ...this.cand.row.outer] };
    // Drum-stack mit identischen Zeilen-Ketten: Kette der ersten Zeile gilt für alle (ein Raster).
    if (calleeName(chain.root) === 'stack' && isCall(chain.root) && this.prog.mergeableDrumStack(chain)) {
      const isSound = (m: Method) => ['s', 'bank'].includes(canonical(m.name));
      const row0 = flattenChain(chain.root.arguments[0]!).methods.filter((m) => !isSound(m));
      chain = { root: chain.root, methods: [...chain.methods.filter(isSound), ...row0, ...chain.methods.filter((m) => !isSound(m))] };
    }

    // Name & Stummschaltung
    const label = this.cand.label;
    const p = pName(chain);
    const id = label ?? p;
    if (id !== null && (id.startsWith('_') || id.endsWith('_'))) {
      this.muted = true;
      this.notes.push(note('info', 'importer.note.muted'));
    }
    if (chain.methods.some((m) => /^q\d?$/.test(m.name))) this.muted = true;

    // Glieder: Visualisierungen/orbit/p raus, Eigenschaftszugriffe an den folgenden Aufruf hängen.
    const units: Unit[] = [];
    let pending: Method[] = [];
    for (const m of chain.methods) {
      if (VISUALS.has(m.name)) {
        this.dropVisual(m.name);
        continue;
      }
      // orbit/o bleiben als Code erhalten (z. B. Sidechain: .duck(2) braucht Spuren auf orbit 2).
      if ((m.name === 'p' || /^q\d?$/.test(m.name)) && m.call) continue;
      if (/^[pdq]\d$/.test(m.name) && !m.call) continue;
      pending.push(m);
      if (m.call) {
        units.push(pending);
        pending = [];
      }
    }
    if (pending.length) units.push(pending);

    // Lautstärke: letztes `.gain(…)` der Kette → Spur-Lautstärke (Compiler hängt sie ans Ende).
    let lastGain = -1;
    units.forEach((u, i) => {
      if (u.length === 1 && u[0]!.name === 'gain' && u[0]!.call && u[0]!.args.length === 1) lastGain = i;
    });
    let volume: number | null = null;
    let gainPiece: CodePiece | null = null;
    if (lastGain >= 0) {
      const m = units[lastGain]![0]!;
      const x = evalNumber(m.args[0], this.prog.numbers);
      if (x !== null) {
        volume = Math.min(1, Math.max(0, x));
        if (volume !== x) this.notes.push(note('info', 'importer.note.gainClamped', { gain: fmtNum(x), volume: fmtNum(volume) }));
      } else {
        volume = 1;
        const text = `.velocity(${tidy(this.printer.print(m.args[0]!))})`;
        gainPiece = { kind: 'code-fx', text };
        this.notes.push(note('keptAsCode', 'importer.note.gainPattern', { code: snippet(text) }));
      }
    }
    // Setup-Code setzt Lautstärke (z. B. register('fade', … pat.gain(…))): dort steht sie als velocity
    // relativ zur Standard-Lautstärke. Spur-Lautstärke bzw. Reset so wählen, dass es wie im Original klingt.
    let resetPiece: CodePiece | null = null;
    if (this.prog.gainNames.size > 0) {
      const positions = this.prog.gainRefs();
      const refs = (a: number, b: number) => positions.some((p) => p >= a && p < b);
      const unitRefs = (u: Unit) => refs(u[0]!.start, u[u.length - 1]!.end);
      const rootRefs = refs(chain.root.start, chain.root.end);
      const after = units.some((u, i) => i > lastGain && unitRefs(u)) || (lastGain < 0 && rootRefs);
      const before = lastGain >= 0 && (rootRefs || units.some((u, i) => i < lastGain && unitRefs(u)));
      const direct = units.some((u, i) => i > lastGain && this.prog.gainNames.has(u[u.length - 1]!.name));
      if (lastGain >= 0 && direct) {
        // Die eigene Funktion überschreibt das gain davor ohnehin.
        volume = DEFAULT_GAIN;
        gainPiece = null;
      } else if (before && !after && !gainPiece) {
        // gain nach der eigenen Funktion überschreibt sie → deren velocity zurücksetzen.
        resetPiece = { kind: 'code-fx', text: '.velocity(1)' };
      }
    }

    // Alle Top-Level-gain-Glieder entfernen (frühere werden ohnehin überschrieben).
    const gainAt = new Set<number>();
    units.forEach((u, i) => {
      if (u.length === 1 && u[0]!.name === 'gain' && u[0]!.call && i <= lastGain) gainAt.add(i);
    });

    // Klangquelle
    const effVolume = () => volume ?? DEFAULT_GAIN;
    const special = this.specialSource(chain.root, units, gainAt);
    let source: SourceResult;
    if (special) {
      source = special;
    } else {
      let consumed = 0;
      // Klangbestimmende Methoden gehören zur Code-Quelle; (literale) gain-Glieder dazwischen werden übersprungen.
      const skippable = (i: number) => gainAt.has(i) && !(i === lastGain && gainPiece);
      let scan = 0;
      while (scan < units.length && (skippable(scan) || units[scan]!.every((m) => this.prog.kind(m.name) === 'source'))) {
        scan++;
        if (!skippable(scan - 1)) consumed = scan;
      }
      if (lastGain < 0) this.velocityDivisor = effVolume();
      const code = tidy(this.printNode(chain.root) + units.slice(0, consumed).filter((_, i) => !gainAt.has(i)).map((u) => this.printUnit(u)).join(''));
      this.velocityDivisor = null;
      this.notes.push(note('keptAsCode', 'importer.note.codeSource', { code: snippet(code) }));
      source = { blocks: [{ type: 'code', params: { code } }], consumed, name: this.codeName(chain, code) };
    }

    // Restliche Kette → Bausteine
    const items: ChainItem[] = [...source.blocks, ...this.recipeBlocks(units, source)];
    const rest: RestItem[] = [];
    for (let i = source.consumed; i < units.length; i++) {
      if (gainAt.has(i)) {
        const piece = i === lastGain ? (gainPiece ?? resetPiece) : null;
        if (piece) rest.push({ unit: [], index: i, piece });
        continue;
      }
      rest.push({ unit: units[i]!, index: i });
    }
    const finalVolume = volume ?? DEFAULT_GAIN;
    items.push(...this.mapUnits(rest, lastGain, source, gainPiece ? 1 : finalVolume > 0 ? finalVolume : null));

    // Code-Stücke gleicher Art zusammenfassen und als Bausteine ausgeben.
    const blocks: BlockSpec[] = [];
    for (const item of items) {
      if (!isPiece(item)) {
        blocks.push(item);
        continue;
      }
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === item.kind) prev.params['code'] = `${String(prev.params['code'])}${item.text}`;
      else blocks.push({ type: item.kind, params: { code: item.text } });
    }
    for (const b of blocks) {
      if ((b.type === 'code-mod' || b.type === 'code-fx') && b.params['code'] !== gainPiece?.text && b.params['code'] !== resetPiece?.text) {
        this.notes.push(note('keptAsCode', 'importer.note.codeBlock', { code: snippet(String(b.params['code'])) }));
      }
    }

    if (!this.noDrums && !this.drumDurationsOk(blocks)) return new TrackConverter(this.prog, this.cand, true).run();

    const name = this.trackName(id, source);
    return { name, muted: this.muted, volume: volume ?? DEFAULT_GAIN, blocks, notes: this.notes };
  }

  /**
   * Raster-Schläge haben im kompilierten Code evtl. andere Dauern als im Original.
   * Für Samples egal – außer die Kette enthält dauerabhängige Operationen (ply, clip …).
   */
  private drumDurationsOk(blocks: BlockSpec[]): boolean {
    const drums = blocks[0];
    if (!this.drumDurations || drums?.type !== 'drums') return true;
    const codeText = blocks.map((b) => String(b.params['code'] ?? '')).join(' ');
    const registered = [...this.prog.registeredBodies.entries()].filter(([n]) => new RegExp(`\\.${n}\\(`).test(codeText)).map(([, body]) => body);
    const sensitive =
      blocks.some((b) => b.type === 'ply' || b.type === 'adsr' || (b.type === 'sometimes' && b.params['action'] === 'ply')) ||
      DURATION_OPS.test(codeText) ||
      registered.some((body) => DURATION_OPS.test(body));
    if (!sensitive) return true;
    const stretch = !blocks.some((b) => b.type === 'adsr' || b.type === 'code-mod' || b.type === 'code-fx');
    const grid = drums.params['grid'] as { rows: Record<string, boolean[]> };
    for (const [inst, durs] of this.drumDurations) {
      const step = compiledStep(grid.rows[inst]!, stretch);
      if (durs.some((d) => !d.eq(step))) return false;
    }
    return true;
  }

  private trackName(id: string | null, source: SourceResult): string {
    if (this.cand.name) return this.cand.name;
    const row = this.cand.row;
    if (row) {
      const base = row.base ?? (source.blocks[0]?.type === 'drums' ? t('importer.names.drums') : null);
      const part = row.comment ?? source.part ?? source.name;
      if (!base) return part;
      if (!part || part === base) return base;
      return t('importer.names.row', { track: base, part });
    }
    const fromId = id !== null ? cleanId(id) : '';
    if (fromId !== '') return fromId;
    return this.prog.commentAbove(this.cand.stmt) ?? source.name;
  }

  /** Instrument-Namen eines Drum-Rasters („Kick“, „Kick + Hi-Hat“). */
  private instrumentPart(hits: Map<string, boolean[]>): string {
    return KIT_INSTRUMENTS.filter((i) => hits.get(i)?.some(Boolean)).map(instrumentLabel).join(' + ');
  }

  /**
   * Ersatz-Rezept (z. B. verzerrte Gitarre → sawtooth + distort + lpf + Hüllkurve)
   * direkt hinter der Quelle – nur für Parameter, die die Kette nicht selbst setzt.
   */
  private recipeBlocks(units: Unit[], source: SourceResult): BlockSpec[] {
    const recipe = this.recipe;
    if (!recipe) return [];
    const names = new Set(units.flat().map((m) => canonical(m.name)));
    const code = source.blocks.map((b) => String(b.params['code'] ?? '')).join('');
    const has = (...ns: string[]) => ns.some((n) => names.has(n) || new RegExp(`\\.${n}\\(`).test(code));
    const blocks = recipe.blocks
      .filter((b) => {
        // lpq ohne lpf wäre mit Rezept-Filter plötzlich hörbar → dann kein Filter.
        if (b.type === 'lpf') return !has('lpf', 'cutoff', 'ctf', 'lp', 'lpq', 'resonance');
        if (b.type === 'distort') return !has('distort', 'shape');
        return !has('attack', 'decay', 'sustain', 'release', 'att', 'dec', 'sus', 'rel', 'adsr');
      })
      .map((b) => ({ type: b.type, params: { ...b.params } }));
    // Kette formt den Klang schon selbst → einfacher Ersatz-Hinweis ohne Rezept.
    if (blocks.length === 0 && this.recipeNote) this.recipeNote.key = 'importer.note.sound';
    return blocks;
  }

  /* ------------------------- Klangquellen -------------------------- */

  private specialSource(root: JsNode, units: Unit[], gainAt: Set<number>): SourceResult | null {
    const name = calleeName(root);
    if (!isCall(root) || name === null) return null;
    const lead = (allowed: Set<string>): Map<string, Method> | null => {
      const found = new Map<string, Method>();
      for (let i = 0; i < units.length; i++) {
        const u = units[i]!;
        const m = u[0]!;
        if (gainAt.has(i) || u.length !== 1 || !m.call || !allowed.has(canonical(m.name))) break;
        if (found.has(canonical(m.name))) return null;
        found.set(canonical(m.name), m);
      }
      // Direkt danach darf keine weitere klangbestimmende Methode folgen (sonst stimmt das Raster nicht).
      const next = units[found.size];
      if (next && !gainAt.has(found.size) && this.prog.kind(next[next.length - 1]!.name) === 'source') return null;
      return found;
    };
    switch (name) {
      case 's':
      case 'sound': {
        const lm = lead(new Set(['bank', 's']));
        if (!lm) return null;
        const drums = this.noDrums ? null : this.drumsFromS(root, lm);
        if (drums) return drums;
        const sm = lead(new Set(['speed']));
        return sm ? this.sampleSource(root, sm) : null;
      }
      case 'stack': {
        const lm = lead(new Set(['bank', 's']));
        return lm ? this.drumsFromStack(root, lm) : null;
      }
      case 'n': {
        const lm = lead(new Set(['scale', 's']));
        return lm ? this.melodySource(root, lm) : null;
      }
      case 'note': {
        const lm = lead(new Set(['s', 'scale']));
        return lm ? this.noteMelodySource(root, lm) : null;
      }
      case 'cat':
      case 'slowcat':
      case 'seq':
      case 'fastcat':
      case 'sequence': {
        const lmNote = lead(new Set(['s', 'scale']));
        const asNote = lmNote ? this.noteMelodySource(root, lmNote) : null;
        if (asNote) return asNote;
        const lmN = lead(new Set(['scale', 's']));
        return lmN ? this.melodySource(root, lmN) : null;
      }
      case 'chord': {
        const lm = lead(new Set(['dict', 'voicing', 's', 'struct']));
        return lm ? this.chordSource(root, lm, units) : null;
      }
      default:
        return null;
    }
  }

  private drumBlock(
    hits: Map<string, boolean[]>,
    kits: Kit[],
    subs: Array<[string, string, Kit]>,
  ): { block: BlockSpec; kit: Kit } {
    const count = new Map<Kit, number>();
    for (const k of kits) count.set(k, (count.get(k) ?? 0) + 1);
    const kit = [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    if (count.size > 1) this.notes.push(note('info', 'importer.note.drumKits', { kit }));
    for (const [from, inst, k] of subs) {
      this.once(`drum:${from}`, note('substituted', 'importer.note.drumSound', { from, to: inst, kit: k }));
    }
    const grid = emptyDrumGrid();
    for (const [inst, row] of hits) grid.rows[inst] = row;
    return { block: { type: 'drums', params: { grid, bank: kit } }, kit };
  }

  private drumsFromS(root: JsNode, lm: Map<string, Method>): SourceResult | null {
    const row = detectDrumRow(root, lm.get('bank'), lm.get('s'), this.prog.available);
    if (!row) return null;
    this.drumDurations = row.durations;
    const { block, kit } = this.drumBlock(row.hits, row.kits, row.subs);
    const bankArg = stringValue(lm.get('bank')?.args[0]);
    if (bankArg !== null && bankArg !== kit && !row.subs.length) {
      this.once(`bank:${bankArg}`, note('substituted', 'importer.note.bank', { from: bankArg, to: kit }));
    }
    this.notes.push(note('converted', 'importer.note.drums', { kit }));
    return { blocks: [block], consumed: lm.size, name: t('importer.names.drums'), part: this.instrumentPart(row.hits) };
  }

  /** stack(…) aus Drum-Zeilen mit identischer Kette → ein Raster (Kette einmal, siehe run()). */
  private drumsFromStack(root: JsNode, lm: Map<string, Method>): SourceResult | null {
    if (this.noDrums || !isCall(root) || !this.prog.mergeableDrumStack(flattenChain(this.cand.expr))) return null;
    const durations = new Map<string, Frac[]>();
    const outerBank = lm.get('bank');
    const outerS = lm.get('s');
    const hits = new Map<string, boolean[]>();
    const kits: Kit[] = [];
    const subs: Array<[string, string, Kit]> = [];
    const banks = new Set<string>();
    for (const arg of root.arguments) {
      const row = flattenChain(arg);
      const bank = outerBank ?? row.methods.find((m) => m.name === 'bank' && m.call);
      const det = detectDrumRow(row.root, bank, outerS ?? row.methods.find((m) => canonical(m.name) === 's' && m.call), this.prog.available)!;
      for (const [inst, r] of det.hits) hits.set(inst, r);
      for (const [inst, d] of det.durations) durations.set(inst, d);
      kits.push(...det.kits);
      subs.push(...det.subs);
      const b = stringValue(bank?.args[0]);
      if (b !== null) banks.add(b);
    }
    this.drumDurations = durations;
    const { block, kit } = this.drumBlock(hits, kits, subs);
    for (const b of banks) if (b !== kit) this.once(`bank:${b}`, note('substituted', 'importer.note.bank', { from: b, to: kit }));
    this.notes.push(note('converted', 'importer.note.drums', { kit }));
    return { blocks: [block], consumed: lm.size, name: t('importer.names.drums'), part: this.instrumentPart(hits) };
  }

  private sampleSource(root: JsNode, lm: Map<string, Method>): SourceResult | null {
    if (!isCall(root) || root.arguments.length !== 1) return null;
    const arg = root.arguments[0]!;
    const value = stringValue(arg);
    if (value === null || this.prog.src.code.slice(arg.start + 1, arg.end - 1) !== value) return null;
    if (/["\\`]/.test(value) || !bracketsBalanced(value) || miniAtoms(value) === null) return null;
    let speed = 1;
    const sm = lm.get('speed');
    if (sm) {
      const v = evalNumber(sm.args[0], this.prog.numbers);
      if (v === null || sm.args.length !== 1 || !fits('sample', 'speed', v)) return null;
      speed = v;
    }
    const mark = this.prog.marks.get(arg);
    const ctx = mark?.kind === 'sound' ? mark.ctx : { bank: false, tonal: false };
    const { text, replaced } = substituteMini(value, ctx);
    for (const [from, to] of replaced) this.substituted(from, to);
    const pattern = sanitizeMini(text);
    if (pattern === '') return null;
    this.notes.push(note('converted', 'importer.note.sample'));
    const first = (miniAtoms(value) ?? []).find((a) => /^[A-Za-z]/.test(a.source))?.source ?? '';
    const name = first ? capitalize(first.split(':')[0]!) : '';
    return { blocks: [{ type: 'sample', params: { pattern, speed } }], consumed: lm.size, name, speed };
  }

  /** Klang für Melodie/Akkorde aus `.s("…")` (Katalog-Klang, ggf. ersetzt); null = nicht abbildbar. */
  private blockSound(sm: Method | undefined): string | null {
    if (!sm) return 'triangle'; // superdough-Standard
    const s = stringValue(sm.args[0])?.trim();
    if (s === undefined || !SINGLE_SOUND.test(s)) return null;
    const bare = s.replace(/:0$/, '');
    const sound = substituteSound(bare, { bank: false, tonal: true, available: this.prog.available });
    if (!SOUND_OPTIONS.includes(sound) && !isAvailable(sound, { available: this.prog.available })) return null;
    if (sound !== bare) this.substituted(bare, sound);
    return sound;
  }

  /** Melodie-Baustein aus Raster, Klang und Tonart. */
  private melodyResult(grid: MelodyGrid, sound: string, key: Key, consumed: number, noteKey: TKey): SourceResult {
    const scaleLabel = optionLabel('melody', 'scale', key.scale).split(' – ')[0]!;
    this.notes.push(note('converted', noteKey, { root: key.root, octave: key.octave, scale: scaleLabel }));
    const name = Number(key.octave) <= 2 ? t('importer.names.bass') : t('importer.names.melody');
    return { blocks: [{ type: 'melody', params: { grid: { ...grid }, sound, ...key } }], consumed, name };
  }

  /** Muster aus `n("…")`/`note("…")` bzw. cat/seq/stack davon; null = nicht auswertbar. */
  private patternOf(node: JsNode, fn: 'n' | 'note'): MiniPattern | null {
    if (!isCall(node)) return null;
    const name = calleeName(node);
    if (name === fn && node.arguments.length === 1) {
      const text = stringValue(node.arguments[0]);
      return text === null ? null : miniPattern(text);
    }
    const combine = name === 'cat' || name === 'slowcat' ? catPatterns : name === 'seq' || name === 'fastcat' || name === 'sequence' ? seqPatterns : name === 'stack' ? stackPatterns : null;
    if (!combine || node.arguments.length === 0) return null;
    const parts = node.arguments.map((a) => this.patternOf(a, fn));
    return parts.every((x): x is MiniPattern => x !== null) ? combine(parts) : null;
  }

  /** `n("…").scale("Root[Okt]:skala")` (auch cat/seq/stack von n) → Melodie-Baustein. */
  private melodySource(root: JsNode, lm: Map<string, Method>): SourceResult | null {
    const pat = this.patternOf(root, 'n');
    const scaleText = stringValue(lm.get('scale')?.args[0]);
    if (!pat || scaleText === null) return null;
    const key = parseScale(scaleText);
    if (!key) return null;
    const sound = this.blockSound(lm.get('s'));
    if (sound === null) return null;
    const grid = buildNoteGrid(pat, (v) => (typeof v === 'number' ? v : null));
    if (!grid) return null;
    return this.melodyResult(grid, sound, key, lm.size, 'importer.note.melody');
  }

  /**
   * `note("eb2 db2 …")` (Notennamen oder MIDI-Zahlen, auch cat/seq/stack davon) →
   * Melodie-Baustein: Grundton, Skala und Lage aus dem Katalog so wählen, dass alle
   * Töne Stufen des Rasters sind (0…MAX_DEGREE).
   */
  private noteMelodySource(root: JsNode, lm: Map<string, Method>): SourceResult | null {
    const pat = this.patternOf(root, 'note');
    if (!pat) return null;
    const cycles = queryCycles(pat, CHECK_CYCLES);
    if (!cycles) return null;
    const values = cycles.flat().map((e) => e.value);
    // .scale() auf Notennamen ändert die Tonhöhe nicht (auf Zahlen schon → dann Code).
    if (lm.has('scale') && values.some((v) => typeof v !== 'string')) return null;
    const midis = values.map(noteMidi);
    if (midis.length === 0 || midis.some((m) => m === null)) return null;
    const ownScale = parseScale(stringValue(lm.get('scale')?.args[0]) ?? '');
    const own: KeyHint | null = ownScale ? { pc: PITCH_CLASS[ownScale.root]!, scale: ownScale.scale, from: 'scale' } : null;
    const key = chooseKey([...new Set(midis as number[])], this.prog.keyHints, own);
    if (!key) return null;
    const sound = this.blockSound(lm.get('s'));
    if (sound === null) return null;
    const grid = buildNoteGrid(pat, (v) => {
      const m = noteMidi(v);
      return m === null ? null : midiToDegree(m, key);
    });
    if (!grid) return null;
    return this.melodyResult(grid, sound, key, lm.size, 'importer.note.noteMelody');
  }

  private chordSource(root: JsNode, lm: Map<string, Method>, units: Unit[]): SourceResult | null {
    if (!isCall(root) || root.arguments.length !== 1) return null;
    const text = stringValue(root.arguments[0]);
    const voicing = lm.get('voicing');
    if (text === null || !voicing || voicing.args.length !== 0) return null;
    // Reihenfolge: [dict] → voicing → (s, struct)
    const order = units.slice(0, lm.size).map((u) => canonical(u[0]!.name));
    const vi = order.indexOf('voicing');
    if (order.slice(0, vi).some((n) => n !== 'dict') || order.slice(vi + 1).includes('dict')) return null;
    const dict = lm.get('dict');
    if (dict && stringValue(dict.args[0]) !== 'ireal') return null;

    let rhythm = 'hold';
    const struct = lm.get('struct');
    if (struct) {
      const st = stringValue(struct.args[0])?.replace(/\s+/g, ' ').trim();
      if (st === 'x*4') rhythm = 'quarter';
      else if (st === '[~ x]*4') rhythm = 'offbeat';
      else return null;
    }
    let sound = 'triangle';
    const sm = lm.get('s');
    if (sm) {
      const s = stringValue(sm.args[0])?.trim();
      if (s === undefined || !SINGLE_SOUND.test(s)) return null;
      const bare = s.replace(/:0$/, '');
      sound = substituteSound(bare, { bank: false, tonal: true });
      if (!SOUND_OPTIONS.includes(sound)) return null;
      if (sound !== bare) this.substituted(bare, sound);
    }

    const clean = sanitizeMini(text);
    if (clean === '' || clean !== text.replace(/\s+/g, ' ').trim() || !bracketsBalanced(clean) || miniAtoms(clean) === null) return null;
    let custom = /[<[{]/.test(clean) || !/\s/.test(clean) ? clean : `[${clean}]`;
    let progression = OPTION_SETS.progressions[0]!.value;
    const preset = OPTION_SETS.progressions.find((p) => p.value === clean);
    if (preset) {
      progression = preset.value;
      custom = '';
    }
    this.notes.push(note('converted', 'importer.note.chords'));
    return {
      blocks: [{ type: 'chords', params: { progression, custom, sound, rhythm } }],
      consumed: lm.size,
      name: t('importer.names.chords'),
    };
  }

  /* ----------------------- Methoden → Bausteine ---------------------- */

  /**
   * @param velocity Spur-Lautstärke, auf die sich verschachtelte `.gain()` hinter
   *   dem letzten Top-Level-gain beziehen (null = nicht umschreiben)
   */
  private mapUnits(
    rest: RestItem[],
    lastGain: number,
    source: SourceResult,
    velocity: number | null,
  ): ChainItem[] {
    const out: ChainItem[] = [];
    const used = new Set<number>();
    const single = (k: number): Method | null => {
      const u = rest[k]!.unit;
      return u.length === 1 && u[0]!.call ? u[0]! : null;
    };
    const ctx: MapContext = {
      num: (m, i = 0) => (m.args.length > i ? evalNumber(m.args[i], this.prog.numbers) : null),
      count: (name) => rest.filter((_, k) => single(k) && canonical(single(k)!.name) === name).length,
      partner: (name) => {
        // Einziges (noch freies) Glied mit diesem Namen und genau einem Zahl-Argument.
        const idx = rest.map((_, k) => k).filter((k) => !used.has(k) && single(k) && canonical(single(k)!.name) === name);
        if (idx.length !== 1) return idx.length === 0 ? null : false;
        const m = single(idx[0]!)!;
        const value = m.args.length === 1 ? evalNumber(m.args[0], this.prog.numbers) : null;
        return value === null ? false : { k: idx[0]!, value };
      },
      used,
      upFn: '',
    };
    const sourceType = source.blocks[0]?.type ?? 'code';
    ctx.upFn =
      sourceType === 'drums' ? 'speed(2)' : sourceType === 'sample' ? `speed(${fmtNum((source.speed ?? 1) * 2)})` : 'transpose(12)';

    for (let k = 0; k < rest.length; k++) {
      if (used.has(k)) continue;
      const { unit, index } = rest[k]!;
      if (unit.length === 0) {
        if (rest[k]!.piece) out.push(rest[k]!.piece!);
        continue;
      }
      const m = single(k);
      const name = m ? canonical(m.name) : '';
      let block: BlockSpec | null = null;
      if (m) {
        used.add(k);
        block = this.mapMethod(m, name, ctx);
        if (!block) used.delete(k);
      }
      if (block) {
        out.push(block);
        continue;
      }
      used.add(k);
      this.velocityDivisor = index > lastGain && velocity ? velocity : null;
      const text = this.printUnit(unit);
      this.velocityDivisor = null;
      const kind = this.prog.kind(unit[unit.length - 1]!.name) === 'mod' ? 'code-mod' : 'code-fx';
      out.push({ kind, text });
    }
    return out;
  }

  private mapMethod(m: Method, name: string, ctx: MapContext): BlockSpec | null {
    const args = m.args;
    const lit = (i = 0) => ctx.num(m, i);
    const { count, used, upFn } = ctx;
    const takePartner = ctx.partner;
    switch (name) {
      case 'lpf':
      case 'hpf': {
        if (args.length !== 1) return null;
        const type = name;
        const qName = name === 'lpf' ? 'lpq' : 'hpq';
        const cutoff = lit();
        if (cutoff === null) return name === 'lpf' ? this.sweep(m) : null;
        if (!fits(type, 'cutoff', cutoff, 0) || count(name) !== 1) return null;
        let resonance = 1;
        const p = takePartner(qName);
        if (p === false) return null;
        if (p) {
          const q = p.value;
          if (!fits(type, 'resonance', q)) return null;
          resonance = q;
          used.add(p.k);
        }
        return { type, params: { cutoff, resonance } };
      }
      case 'room': {
        const amount = lit();
        if (amount === null || args.length !== 1 || !fits('room', 'amount', amount) || count('room') !== 1) return null;
        let size = 2; // superdough: Standard-Raumgröße
        const p = takePartner('roomsize');
        if (p === false) return null;
        if (p) {
          const s = p.value;
          if (!fits('room', 'size', s)) return null;
          size = s;
          used.add(p.k);
        }
        return { type: 'room', params: { amount, size } };
      }
      case 'delay': {
        const amount = lit();
        if (amount === null || args.length !== 1 || !fits('delay', 'amount', amount) || count('delay') !== 1) return null;
        let feedback = 0.5;
        let time = 3 / 16;
        const take: number[] = [];
        const fb = takePartner('delayfeedback');
        const dt = takePartner('delaytime');
        const ds = takePartner('delaysync');
        if (fb === false || dt === false || ds === false || (dt && ds)) return null;
        // Ohne Zeitangabe bleibt das Echo Code: Strudels Standard-Echozeit hängt von der Version ab.
        if (!dt && !ds) return null;
        if (fb) {
          const v = fb.value;
          if (!fits('delay', 'feedback', v)) return null;
          feedback = v;
          take.push(fb.k);
        }
        if (ds) {
          const v = ds.value;
          time = v;
          take.push(ds.k);
        }
        if (dt) {
          const v = dt.value;
          time = (v * this.prog.bpm) / 240;
          take.push(dt.k);
        }
        const option = OPTION_SETS.delayTimes.find((o) => Math.abs(Number(o.value) - time) < 1e-6);
        if (!option) return null;
        take.forEach((k) => used.add(k));
        return { type: 'delay', params: { amount, time: option.value, feedback } };
      }
      case 'attack':
      case 'decay':
      case 'sustain':
      case 'release': {
        const names = ['attack', 'decay', 'sustain', 'release'] as const;
        const vals: Record<string, number | undefined> = {};
        const take: number[] = [];
        for (const n of names) {
          if (n === name) {
            const v = lit();
            if (v === null || args.length !== 1 || count(n) !== 1) return null;
            vals[n] = v;
            continue;
          }
          const p = takePartner(n);
          if (p === false) return null;
          if (p) {
            const v = p.value;
            vals[n] = v;
            take.push(p.k);
          }
        }
        // Wie superdough (getADSRValues): fehlende Werte ergänzen.
        const a = vals['attack'];
        const d = vals['decay'];
        const s = vals['sustain'];
        const r = vals['release'];
        const attack = Math.max(a ?? 0, 0.001);
        const decay = Math.max(d ?? 0, 0.001);
        const sustain = Math.min(s ?? ((a !== undefined && d === undefined) || (a === undefined && d === undefined) ? 1 : 0.001), 1);
        const release = Math.max(r ?? 0, 0.01);
        const params = { attack, decay, sustain, release };
        if (!Object.entries(params).every(([k, v]) => fits('adsr', k, v))) return null;
        take.forEach((k) => used.add(k));
        return { type: 'adsr', params };
      }
      case 'crush': {
        const v = lit();
        return v !== null && args.length === 1 && Number.isInteger(v) && fits('crush', 'bits', v) ? { type: 'crush', params: { bits: v } } : null;
      }
      case 'distort': {
        const v = lit();
        if (v === null || args.length !== 1 || v < 0 || v > 4 || Number(v.toFixed(2)) !== v) return null;
        return { type: 'distort', params: { amount: v / 4 } };
      }
      case 'pan': {
        const v = lit();
        return v !== null && args.length === 1 && fits('pan', 'position', v) ? { type: 'pan', params: { position: v } } : null;
      }
      case 'fast':
      case 'slow': {
        const v = lit();
        if (v === null || args.length !== 1 || v <= 0) return null;
        const ok = (x: number) => x >= 1 && x <= 8 && Number.isInteger(x * 4);
        if (ok(v)) return { type: name, params: { factor: v } };
        const inv = 1 / v;
        if (ok(inv) && Math.abs(inv * v - 1) < 1e-12) return { type: name === 'fast' ? 'slow' : 'fast', params: { factor: inv } };
        return null;
      }
      case 'rev':
        return args.length === 0 ? { type: 'rev', params: {} } : null;
      case 'ply': {
        const v = lit();
        return v !== null && args.length === 1 && Number.isInteger(v) && fits('ply', 'times', v) ? { type: 'ply', params: { times: v } } : null;
      }
      case 'jux':
        return args.length === 1 && this.fnBody(args[0]!) === 'rev()' ? { type: 'jux', params: {} } : null;
      case 'degradeBy': {
        const v = lit();
        return v !== null && args.length === 1 && fits('degrade', 'amount', v) ? { type: 'degrade', params: { amount: v } } : null;
      }
      case 'degrade':
        return args.length === 0 ? { type: 'degrade', params: { amount: 0.5 } } : null;
      case 'sometimesBy':
      case 'sometimes':
      case 'often':
      case 'rarely':
      case 'almostNever':
      case 'almostAlways': {
        const fixed: Record<string, number> = { sometimes: 0.5, often: 0.75, rarely: 0.25, almostNever: 0.1, almostAlways: 0.9 };
        const chance = name === 'sometimesBy' ? lit() : fixed[name]!;
        const fnArg = args[name === 'sometimesBy' ? 1 : 0];
        if (chance === null || !fnArg || args.length !== (name === 'sometimesBy' ? 2 : 1) || !fits('sometimes', 'chance', chance)) return null;
        const body = this.fnBody(fnArg);
        const action = body === 'ply(2)' ? 'ply' : body === 'crush(4)' ? 'crush' : body === upFn ? 'up' : null;
        return action ? { type: 'sometimes', params: { chance, action } } : null;
      }
      case 'firstOf': {
        const n = lit();
        if (n === null || args.length !== 2 || !Number.isInteger(n) || !fits('firstOf', 'every', n)) return null;
        const body = this.fnBody(args[1]!);
        const action = body === 'rev()' ? 'rev' : body === 'fast(2)' ? 'fast' : body === 'degradeBy(0.5)' ? 'degrade' : body === upFn ? 'up' : null;
        return action ? { type: 'firstOf', params: { every: n, action } } : null;
      }
      default:
        return null;
    }
  }

  /** Filter-Sweep: `.lpf(sine.range(300, 3000).slow(4))` (auch `.slow(4).range(…)`). */
  private sweep(m: Method): BlockSpec | null {
    if (m.args.length !== 1) return null;
    const chain = flattenChain(m.args[0]!);
    if (!isIdent(chain.root)) return null;
    const shape = chain.root.name;
    if (!OPTION_SETS.lfoShapes.some((o) => o.value === shape)) return null;
    let min: number | null = null;
    let max: number | null = null;
    let cycles = 1;
    const seen = new Set<string>();
    for (const c of chain.methods) {
      if (!c.call || seen.has(c.name)) return null;
      seen.add(c.name);
      if (c.name === 'range' && c.args.length === 2) {
        min = evalNumber(c.args[0], this.prog.numbers);
        max = evalNumber(c.args[1], this.prog.numbers);
      } else if (c.name === 'slow' && c.args.length === 1) {
        const v = evalNumber(c.args[0], this.prog.numbers);
        if (v === null) return null;
        cycles = v;
      } else return null;
    }
    if (min === null || max === null) return null;
    if (!fits('sweep', 'min', min, 0) || !fits('sweep', 'max', max, 0) || !Number.isInteger(cycles) || !fits('sweep', 'cycles', cycles)) return null;
    return { type: 'sweep', params: { min, max, cycles, shape } };
  }

  /** `x => x.ply(2)`, `ply(2)` und `rev` → einheitlich „ply(2)“ bzw. „rev()“. */
  private fnBody(node: JsNode): string | null {
    if (isIdent(node)) return `${node.name}()`;
    const text = this.prog.src.code.slice(node.start, node.end).replace(/\s+/g, '');
    if (node.type === 'ArrowFunctionExpression') {
      const params = field<JsNode[]>(node, 'params');
      const p = params[0];
      if (params.length !== 1 || !isIdent(p)) return null;
      const m = new RegExp(`^\\(?${p.name}\\)?=>${p.name}\\.(.+)$`).exec(text);
      return m ? m[1]! : null;
    }
    if (isCall(node) && isIdent(node.callee)) return text;
    return null;
  }

  /** Name für eine Code-Quelle: Bass/Melodie/Akkorde nach Inhalt, sonst Klangname. */
  private codeName(chain: Chain, code: string): string {
    const rootName = calleeName(chain.root);
    const notes = [...code.matchAll(/\b[a-gA-G](?:#|b|s)?(-?\d)\b/g)].map((m) => Number(m[1]));
    if (/bass/i.test(code) || (notes.length > 0 && notes.every((o) => o <= 2))) return t('importer.names.bass');
    if (rootName === 'chord' || /\.voicing\(/.test(code)) return t('importer.names.chords');
    if (/\b(note|n)\(/.test(code) || notes.length > 0) return t('importer.names.melody');
    const sound = /\b(?:s|sound)\(\s*["'`]([A-Za-z][\w]*)/.exec(code)?.[1];
    if (sound && NOISES.has(sound)) return t('importer.names.noise');
    if (sound) return capitalize(sound);
    return '';
  }
}

