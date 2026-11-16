/**
 * Importer-Agent: verwandelt fremden Strudel-Code (REPL-Code von strudel.cc,
 * Dateien, Share-Links) in ein editierbares mixr-Projekt.
 *
 * Signaturen sind verbindlich (UI-Dialog und WebMCP verlassen sich darauf).
 *
 * Aufbau:
 *  - source.ts   – acorn-Parsing, Methodenketten, Quelltext-Ausschnitte ohne Kommentare
 *  - mini.ts     – Event-Abfrage für Mini-Notation (Strudel-Parser krill, SSR-sicher)
 *  - sounds.ts   – Ersatz nicht verfügbarer Klänge durch freie Klänge
 *  - methods.ts  – Wissen über Strudel-Methoden (Aliase, Visualisierungen …)
 *  - convert.ts  – Programm → Spur-Entwürfe (Bausteine oder Code)
 *  - index.ts    – öffentliche API, AST-Aufbau
 */
import { TRACK_COLORS, defaultParams } from '../../blocks/catalog';
import { t, type TKey, type TParams } from '../../i18n';
import type { BlockNode, ProjectSettings, TrackNode, VisualAst, VisualEdge } from '../../types/ast';
import { convertProgram } from './convert';
import { SyntaxProblem, parseSource } from './source';

/** Was mit einem Teil des importierten Codes passiert ist. */
export type ImportNoteKind =
  /** in Bausteine umgewandelt */
  | 'converted'
  /** unverändert als Code-Baustein übernommen (nichts geht verloren) */
  | 'keptAsCode'
  /** Klang/Wert ersetzt (z. B. nicht verfügbarer Sound → freier Ersatz) */
  | 'substituted'
  /** bewusst weggelassen (z. B. reine Visualisierung wie _pianoroll) */
  | 'dropped'
  /** Hinweis ohne Auswirkung */
  | 'info';

export interface ImportNote {
  kind: ImportNoteKind;
  /** Name der betroffenen Spur (bereits im Ergebnis-AST), falls zuordenbar. */
  trackName?: string;
  /** Text-Key im Namespace `importer` + Platzhalterwerte (UI übersetzt). */
  message: { key: TKey; params?: TParams };
}

export interface ImportResult {
  ast: VisualAst;
  settings: ProjectSettings;
  notes: ImportNote[];
  /** Kurzstatistik für die Vorschau. */
  stats: { tracks: number; blocks: number; codeBlocks: number; substituted: number; dropped: number };
}

/** Code nicht lesbar (Syntaxfehler o. Ä.) – `message` ist ein Text-Key. */
export class ImportError extends Error {
  constructor(
    readonly messageKey: TKey,
    readonly params?: TParams,
  ) {
    super(String(messageKey));
    this.name = 'ImportError';
  }
}

/**
 * Wandelt Strudel-Code in ein Projekt um. Reine Funktion (SSR-/Node-sicher).
 * @throws ImportError, wenn der Code nicht geparst werden kann
 */
export interface ImportOptions {
  /**
   * Klangnamen, die es beim Nutzer zusätzlich gibt (eigene Sample-Slots, z. B. „vox“).
   * Sie werden nicht ersetzt – auch nicht als „vox:3“ oder als „bank_name“.
   */
  availableSounds?: readonly string[];
}

export function importStrudelCode(code: string, options: ImportOptions = {}): ImportResult {
  let src;
  try {
    src = parseSource(code);
  } catch (err) {
    if (err instanceof SyntaxProblem) {
      throw new ImportError('importer.error.syntax', { line: err.line, column: err.column, message: err.message });
    }
    throw err;
  }
  const converted = convertProgram(src, options);
  if (converted.tracks.length === 0) throw new ImportError('importer.error.noPattern');

  const prefix = idPrefix();
  const astExtra: Pick<VisualAst, 'arrangement'> = {};
  const nodes: VisualAst['nodes'] = [];
  const edges: VisualEdge[] = [];
  const notes: ImportNote[] = converted.notes.map((n) => toNote(n));
  const used = new Set<string>();
  let blockCount = 0;
  let codeBlocks = 0;

  converted.tracks.forEach((draft, i) => {
    const name = uniqueName(draft.name.trim() || t('importer.names.track', { n: i + 1 }), used);
    const track: TrackNode = {
      id: `${prefix}-t${i + 1}`,
      type: 'track',
      params: {
        name,
        color: TRACK_COLORS[i % TRACK_COLORS.length]!,
        volume: Math.round(draft.volume * 10000) / 10000,
        muted: draft.muted,
        solo: false,
      },
    };
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
    notes.push(...draft.notes.map((n) => toNote(n, name)));
  });

  const merged = mergeNotes(notes);
  const trackIds = nodes.filter((n) => n.type === 'track').map((n) => n.id);
  if (converted.arrangement) {
    const sections = converted.arrangement.sections.map((sec, i) => ({ id: `${prefix}-s${i + 1}`, ...sec }));
    const cells: NonNullable<VisualAst['arrangement']>['cells'] = {};
    for (const c of converted.arrangement.cells) {
      const id = trackIds[c.track]!;
      cells[id] ??= {};
      cells[id][sections[c.section]!.id] = c.code === undefined ? { on: c.on } : { on: c.on, code: c.code };
    }
    Object.assign(astExtra, { arrangement: { sections, cells } });
  }
  return {
    ast: { nodes, edges, ...astExtra },
    settings: converted.prelude ? { bpm: converted.bpm, prelude: converted.prelude } : { bpm: converted.bpm },
    notes: merged,
    stats: {
      tracks: converted.tracks.length,
      blocks: blockCount,
      codeBlocks,
      substituted: merged.filter((n) => n.kind === 'substituted').length,
      dropped: merged.filter((n) => n.kind === 'dropped').length,
    },
  };
}

/**
 * Fasst gleichartige Hinweise zusammen: alle Visualisierungen zu einem Hinweis
 * (mit Anzahl), identische Hinweise mehrerer Spuren zu einem ohne Spurnamen.
 */
function mergeNotes(notes: ImportNote[]): ImportNote[] {
  const visuals = notes.filter((n) => n.message.key === 'importer.note.visualsDropped');
  const rest = notes.filter((n) => n.message.key !== 'importer.note.visualsDropped');
  const groups = new Map<string, ImportNote[]>();
  for (const n of rest) {
    const id = `${n.kind}|${n.message.key}|${JSON.stringify(n.message.params ?? {})}`;
    groups.set(id, [...(groups.get(id) ?? []), n]);
  }
  const out: ImportNote[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const tracks = new Set(group.map((n) => n.trackName));
    out.push(tracks.size > 1 ? { kind: first.kind, message: first.message } : first);
  }
  if (visuals.length > 0) {
    const names = [...new Set(visuals.map((n) => String(n.message.params?.['names'] ?? '')))].join(', ');
    out.push({ kind: 'dropped', message: { key: 'importer.note.visualsDropped', params: { count: visuals.length, names } } });
  }
  return out;
}

function toNote(n: { kind: ImportNoteKind; key: TKey; params?: TParams }, trackName?: string): ImportNote {
  const message = n.params ? { key: n.key, params: n.params } : { key: n.key };
  return trackName === undefined ? { kind: n.kind, message } : { kind: n.kind, trackName, message };
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  for (let i = 2; used.has(candidate); i++) candidate = `${name} ${i}`;
  used.add(candidate);
  return candidate;
}

/** Eindeutiges ID-Präfix pro Import (Anhängen an ein bestehendes Projekt darf nicht kollidieren). */
function idPrefix(): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `imp-${random}`;
}

/* ------------------------------------------------------------------ */
/* Eingabe                                                             */
/* ------------------------------------------------------------------ */

const STRUDEL_LINK = /^https?:\/\/(?:[\w-]+\.)*strudel\.cc(?:\/[^\s#]*)?(?:#(\S*))?$/i;

/**
 * Normalisiert Eingaben: strudel.cc-Share-Links (`https://strudel.cc/#<base64>`),
 * sonst der Text unverändert. Liefert `null`, wenn ein Link nicht dekodierbar ist.
 */
export function decodeStrudelInput(input: string): string | null {
  const trimmed = input.trim();
  const m = STRUDEL_LINK.exec(trimmed);
  if (!m) return input;
  const hash = m[1];
  if (!hash) return null;
  try {
    const base64 = decodeURIComponent(hash).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const code = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return code.trim() === '' ? null : code;
  } catch {
    return null;
  }
}

/** Typische Strudel-Aufrufe (Muster-Funktionen, Tempo, Samples). */
const STRUDEL_CALL =
  /(?:^|[^\w.$])(?:s|sound|note|n|chord|stack|cat|seq|fastcat|slowcat|arrange|setcpm|setcps|setCpm|setCps|samples)\s*\(/;
const STRONG = [
  /^\s*_?\$\w*\s*:/m, // $: / $name: / _$:
  /\bset(?:cpm|cps|Cpm|Cps)\s*\(/,
  /\b(?:s|sound|note|n|chord)\s*\(\s*["'`][^"'`\n]*["'`]\s*\)/,
  /\.(?:bank|scale|voicing|lpf|room|delay|gain|fast|slow|jux)\s*\(/,
];

/** Heuristik: sieht ein eingefügter Text nach Strudel-Code aus? (für Einfügen-Erkennung) */
export function looksLikeStrudelCode(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > 512 * 1024) return false;
  let parsed = false;
  try {
    parseSource(trimmed);
    parsed = true;
  } catch {
    parsed = false;
  }
  if (parsed) return STRUDEL_CALL.test(trimmed) || /^\s*_?\$\w*\s*:/m.test(trimmed);
  // Nicht (ganz) gültiges JS – z. B. halb fertig eingefügt: nur bei mehreren starken Signalen.
  return STRONG.filter((re) => re.test(trimmed)).length >= 2;
}
