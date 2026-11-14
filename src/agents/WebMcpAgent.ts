/**
 * WebMCP-Agent („Der AI-Assistant“ aus der Architektur-Spezifikation)
 *
 * Stellt strudelmixr als Werkzeugkasten für KI-Agenten im Browser bereit
 * (WebMCP, https://webmachinelearning.github.io/webmcp/ – `document.modelContext`).
 * Ein Agent in Chrome & Co. kann damit das Projekt lesen, Spuren und Bausteine
 * anlegen, Beats/Melodien setzen, Tempo ändern und abspielen – über dieselbe
 * Schreib-API (src/store/actions.ts) wie die UI: alles ist sofort sichtbar,
 * hörbar und per Rückgängig umkehrbar.
 *
 * - Nur im Browser und nur in sicheren Kontexten; ohne WebMCP-Unterstützung No-op.
 * - Werkzeugbeschreibungen sind bewusst Englisch (Sprache der Agenten), Texte
 *   für Menschen (Labels in list_block_types) folgen der UI-Sprache.
 * - Eingaben werden gegen den Block-Katalog geprüft und auf erlaubte Bereiche
 *   begrenzt; ungültige Werte führen zu einer verständlichen Fehlermeldung.
 */
import { BLOCK_CATALOG, STEPS, emptyDrumGrid, getBlockDef } from '../blocks/catalog';
import { blockDescription, blockLabel, templateDescription, templateName } from '../blocks/text';
import { TEMPLATES, templateProject } from '../data/templates';
import {
  compiledStrudelCode,
  compileState,
  playbackState,
  projectSettings,
  resolvedTracks,
  transportCommand,
  visualAstStore,
} from '../store/agentBus';
import {
  addBlock,
  addSection,
  addTrack,
  appendProject,
  createArrangement,
  removeArrangement,
  removeSection,
  setLoopSection,
  setSectionCell,
  updateSection,
  loadProject,
  moveBlock,
  redo,
  removeBlock,
  removeTrack,
  setBlockBypassed,
  setBpm,
  undo,
  updateBlockParams,
  updateTrack,
} from '../store/actions';
import { findNode } from '../store/selectors';
import { ImportError, decodeStrudelInput, importStrudelCode } from './importer';
import { translate } from '../i18n';
import type {
  BlockNode,
  BlockType,
  DrumGridValue,
  NoteGridValue,
  ParamDef,
  ParamValue,
  ParamValues,
  SourceBlockType,
  TrackParams,
} from '../types/ast';
import { NOTE_GRID_BARS, isTrackNode } from '../types/ast';

/* ------------------------------------------------------------------ */
/* WebMCP-Typen (Draft CG Report, 2026-11-12) – nur was wir nutzen       */
/* ------------------------------------------------------------------ */

type JsonSchema = Record<string, unknown>;

interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
}

interface ModelContext extends EventTarget {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<void>;
}

declare global {
  interface Document {
    /** WebMCP – nur in unterstützenden Browsern vorhanden. */
    readonly modelContext?: ModelContext;
  }
}

/* ------------------------------------------------------------------ */
/* Eingabe-Prüfung                                                     */
/* ------------------------------------------------------------------ */

/** Fehler, deren Text der aufrufende Agent zu sehen bekommt. */
export class ToolInputError extends Error {}

function fail(message: string): never {
  throw new ToolInputError(message);
}

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v === '') fail(`"${key}" must be a non-empty string.`);
  return v;
}

function optNum(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${key}" must be a number.`);
  return v;
}

const BLOCK_TYPES = Object.keys(BLOCK_CATALOG) as BlockType[];
const SOURCE_TYPES = BLOCK_TYPES.filter((t) => BLOCK_CATALOG[t].kind === 'source') as SourceBlockType[];

function asBlockType(v: unknown): BlockType {
  if (typeof v !== 'string' || !(BLOCK_TYPES as string[]).includes(v)) {
    fail(`Unknown block type "${String(v)}". Use list_block_types to see the available types.`);
  }
  return v as BlockType;
}

function requireBlock(blockId: string): BlockNode {
  const node = findNode(visualAstStore.get(), blockId);
  if (!node || isTrackNode(node)) fail(`No block with id "${blockId}". Use get_project to see the current ids.`);
  return node;
}

function requireTrack(trackId: string) {
  const node = findNode(visualAstStore.get(), trackId);
  if (!node || !isTrackNode(node)) fail(`No track with id "${trackId}". Use get_project to see the current ids.`);
  return node;
}

/** Drum-Muster aus Strings wie "x---x---x---x---" (x = Schlag, sonst Pause). */
export function parseDrumPattern(pattern: unknown, instruments: readonly string[]): DrumGridValue {
  if (typeof pattern !== 'object' || pattern === null) fail('"pattern" must be an object like {"bd": "x---x---x---x---"}.');
  const grid = emptyDrumGrid(STEPS);
  for (const [inst, row] of Object.entries(pattern)) {
    if (!instruments.includes(inst)) fail(`Unknown instrument "${inst}". Available: ${instruments.join(', ')}.`);
    if (typeof row !== 'string') fail(`Pattern for "${inst}" must be a string of ${STEPS} characters.`);
    const steps = row.replace(/\s+/g, '');
    if (steps.length !== STEPS) fail(`Pattern for "${inst}" must have exactly ${STEPS} steps (got ${steps.length}).`);
    grid.rows[inst] = [...steps].map((c) => c === 'x' || c === 'X');
  }
  return grid;
}

/** Noten-Raster aus Skalenstufen je Step: Zahl, Akkord [0,2,4] oder null (Pause). */
/**
 * Noten-Raster aus Skalenstufen je Step: Zahl, Akkord [0,2,4], null (Pause) oder
 * {"notes": 0 | [0,2,4], "length": 4} für Haltetöne (Länge in Steps).
 * Länge des Arrays = 16 × bars (1, 2, 4, 8 oder 16 Takte).
 */
export function parseNoteSteps(steps: unknown, degrees: number, bars = 1): NoteGridValue {
  if (!(NOTE_GRID_BARS as readonly number[]).includes(bars)) fail(`"bars" must be one of ${NOTE_GRID_BARS.join(', ')}.`);
  const total = STEPS * bars;
  if (!Array.isArray(steps) || steps.length !== total) {
    fail(`"steps" must be an array of exactly ${total} entries (${STEPS} per bar × ${bars} bar${bars > 1 ? 's' : ''}).`);
  }
  const cells: number[][] = [];
  const lengths: number[][] = [];
  steps.forEach((s: unknown, i) => {
    let notes: unknown = s;
    let length = 1;
    if (typeof s === 'object' && s !== null && !Array.isArray(s)) {
      const o = s as { notes?: unknown; length?: unknown };
      notes = o.notes;
      if (o.length !== undefined) {
        if (typeof o.length !== 'number' || !Number.isInteger(o.length) || o.length < 1) fail(`Step ${i + 1}: "length" must be a whole number of steps ≥ 1.`);
        length = Math.min(o.length, total - i);
      }
    }
    const list = notes === null || notes === undefined ? [] : Array.isArray(notes) ? notes : [notes];
    cells[i] = list.map((n: unknown) => {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= degrees) {
        fail(`Step ${i + 1}: scale degrees must be integers from 0 to ${degrees - 1} (0 = root note).`);
      }
      return n;
    });
    lengths[i] = cells[i]!.map(() => length);
  });
  const held = lengths.some((row) => row.some((l) => l > 1));
  return held || bars > 1 ? { steps: STEPS, bars, cells, lengths } : { steps: STEPS, cells };
}

/** Prüft/klemmt einen einzelnen Parameterwert gegen seine Definition. */
export function coerceParam(def: ParamDef, value: unknown): ParamValue {
  switch (def.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`"${def.key}" must be a number.`);
      return Math.min(def.max, Math.max(def.min, value));
    }
    case 'select': {
      const allowed = def.options.map((o) => o.value);
      if (typeof value !== 'string' || !allowed.includes(value)) fail(`"${def.key}" must be one of: ${allowed.join(', ')}.`);
      return value;
    }
    case 'toggle':
      if (typeof value !== 'boolean') fail(`"${def.key}" must be true or false.`);
      return value;
    case 'text':
      if (typeof value !== 'string') fail(`"${def.key}" must be a string.`);
      return value;
    case 'drumGrid':
      return parseDrumPattern(value, def.instruments.map((i) => i.value));
    case 'noteGrid':
      return parseNoteSteps(value, def.degrees);
  }
}

export function coerceParams(type: BlockType, params: unknown): ParamValues {
  if (params === undefined) return {};
  if (typeof params !== 'object' || params === null) fail('"params" must be an object.');
  const defs = getBlockDef(type).params;
  const out: ParamValues = {};
  for (const [key, value] of Object.entries(params)) {
    const def = defs.find((d) => d.key === key);
    if (!def) fail(`Block "${type}" has no parameter "${key}". Available: ${defs.map((d) => d.key).join(', ') || 'none'}.`);
    out[key] = coerceParam(def, value);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lesesicht für Agenten                                               */
/* ------------------------------------------------------------------ */

function gridToStrings(grid: DrumGridValue): Record<string, string> {
  return Object.fromEntries(Object.entries(grid.rows).map(([k, row]) => [k, row.map((on) => (on ? 'x' : '-')).join('')]));
}

function paramsForAgent(params: ParamValues): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => {
      if (typeof v === 'object' && 'rows' in v) return [k, gridToStrings(v)];
      if (typeof v === 'object' && 'cells' in v) {
        const steps = v.cells.map((c, i) => {
          const notes = c.length === 0 ? null : c.length === 1 ? c[0] : c;
          const len = Math.max(1, ...(v.lengths?.[i] ?? [1]));
          return len > 1 && notes !== null ? { notes, length: len } : notes;
        });
        return [k, v.bars && v.bars > 1 ? { bars: v.bars, steps } : steps];
      }
      return [k, v];
    }),
  );
}

function arrangementForAgent() {
  const arr = visualAstStore.get().arrangement;
  if (!arr) return null;
  return {
    sections: arr.sections.map((sec) => ({ id: sec.id, name: sec.name ?? null, cycles: sec.cycles })),
    totalCycles: arr.sections.reduce((sum, sec) => sum + sec.cycles, 0),
    loopSection: arr.loopSection ?? null,
    /** trackId → sectionId → {on, code?}; tracks without an entry play in every section */
    cells: arr.cells,
  };
}

function requireSection(sectionId: string) {
  const sec = visualAstStore.get().arrangement?.sections.find((x) => x.id === sectionId);
  if (!sec) fail(`No section with id "${sectionId}". Use get_project to see the arrangement.`);
  return sec;
}

export function projectSnapshot() {
  const pb = playbackState.get();
  const { bpm, prelude } = projectSettings.get();
  return {
    bpm,
    setupCode: prelude ?? null,
    isPlaying: pb.isPlaying,
    engineStatus: pb.status,
    engineError: pb.error,
    tracks: resolvedTracks.get().map(({ track, chain }) => ({
      id: track.id,
      name: track.params.name,
      volume: track.params.volume,
      muted: track.params.muted,
      solo: track.params.solo,
      blocks: chain.map((b) => ({
        id: b.id,
        type: b.type,
        kind: BLOCK_CATALOG[b.type].kind,
        bypassed: b.bypassed === true,
        params: paramsForAgent(b.params),
      })),
    })),
    arrangement: arrangementForAgent(),
    diagnostics: compileState.get().diagnostics,
    strudelCode: compiledStrudelCode.get(),
  };
}

function paramSchemaForAgent(def: ParamDef): Record<string, unknown> {
  switch (def.type) {
    case 'number':
      return { key: def.key, type: 'number', min: def.min, max: def.max, step: def.step, default: def.default, unit: def.unit };
    case 'select':
      return { key: def.key, type: 'select', options: def.options.map((o) => o.value), default: def.default };
    case 'toggle':
      return { key: def.key, type: 'boolean', default: def.default };
    case 'text':
      return { key: def.key, type: 'text', syntax: def.syntax, default: def.default };
    case 'drumGrid':
      return {
        key: def.key,
        type: 'drumPattern',
        format: `object instrument → ${STEPS} chars, "x" = hit, "-" = rest (use set_drum_pattern)`,
        instruments: def.instruments.map((i) => i.value),
      };
    case 'noteGrid':
      return {
        key: def.key,
        type: 'noteSteps',
        format: `array of ${STEPS} steps: scale degree 0-${def.degrees - 1}, array for chords, null for rest (use set_notes)`,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Werkzeuge                                                           */
/* ------------------------------------------------------------------ */

const ok = (summary: string, extra: Record<string, unknown> = {}) => ({ ok: true, summary, ...extra });

const ID = { type: 'string' } as const;

export const TOOLS: ModelContextTool[] = [
  {
    name: 'get_project',
    title: 'Read project',
    description:
      'Returns the current strudelmixr project: tempo, setup code (custom functions/constants that run before all tracks), playback state, all tracks with their block chains (ids, types, parameters) and the generated Strudel code. Call this first and after changes to get ids.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => projectSnapshot(),
  },
  {
    name: 'list_block_types',
    title: 'List building blocks',
    description:
      'Lists every available building block: sources (start a track: drums, melody, chords, sample, code), modifiers (rhythm/timing) and effects, with their parameters, ranges and allowed values.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () =>
      BLOCK_TYPES.map((type) => ({
        type,
        kind: BLOCK_CATALOG[type].kind,
        label: blockLabel(type),
        description: blockDescription(type),
        params: BLOCK_CATALOG[type].params.map(paramSchemaForAgent),
      })),
  },
  {
    name: 'list_templates',
    title: 'List templates',
    description: 'Lists the starter templates (genre presets) that can be loaded with load_template.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () =>
      TEMPLATES.map((t) => ({
        id: t.id,
        name: templateName(t.id),
        description: templateDescription(t.id),
        bpm: t.settings.bpm,
        tracks: t.ast.nodes.filter(isTrackNode).length,
      })),
  },
  {
    name: 'load_template',
    title: 'Load template',
    description: 'Replaces the current project with a starter template (undoable). Optionally starts playback.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', enum: TEMPLATES.map((t) => t.id) }, play: { type: 'boolean' } },
      required: ['id'],
    },
    annotations: { consequentialHint: true },
    execute: async (input) => {
      const project = templateProject(str(input, 'id'));
      if (!project) fail(`Unknown template "${String(input.id)}".`);
      loadProject(project.ast, project.settings);
      if (input.play === true) transportCommand.set({ action: 'play', at: Date.now() });
      return ok(`Loaded template "${String(input.id)}".`, { project: projectSnapshot() });
    },
  },
  {
    name: 'import_strudel_code',
    title: 'Import Strudel code',
    description:
      'Turns Strudel code (as written on strudel.cc, or a strudel.cc share link) into an editable strudelmixr project: setcpm becomes the tempo, every $: block a track; drum patterns, melodies, chords and effects become blocks, everything else is kept as code. Sounds strudelmixr does not ship are swapped for free ones. mode "replace" (default) replaces the project, "append" adds the tracks. Undoable. Returns the notes about swapped, kept and dropped parts.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Strudel code or a https://strudel.cc/#… link' },
        mode: { type: 'string', enum: ['replace', 'append'] },
        play: { type: 'boolean' },
      },
      required: ['code'],
    },
    annotations: { consequentialHint: true, untrustedContentHint: true },
    execute: async (input) => {
      const code = decodeStrudelInput(str(input, 'code'));
      if (code === null) fail('The strudel.cc link could not be decoded.');
      let result: ReturnType<typeof importStrudelCode>;
      try {
        result = importStrudelCode(code);
      } catch (err) {
        if (err instanceof ImportError) fail(`Could not import: ${translate('en', err.messageKey, err.params)}`);
        throw err;
      }
      if (input.mode === 'append') appendProject(result.ast);
      else loadProject(result.ast, result.settings);
      if (input.play === true) transportCommand.set({ action: 'play', at: Date.now() });
      return ok(`Imported ${result.stats.tracks} track(s).`, {
        stats: result.stats,
        notes: result.notes.map((n) => ({
          kind: n.kind,
          track: n.trackName,
          text: translate('en', n.message.key, n.message.params),
        })),
        project: projectSnapshot(),
      });
    },
  },
  {
    name: 'export_midi',
    title: 'Export as MIDI',
    description:
      'Exports the notes the project plays as a Standard MIDI File (format 1, 480 PPQ, tempo from the project). Every track is evaluated by Strudel itself, so code blocks, setup code and the song arrangement are included; drums go to channel 10 (General MIDI). Returns the file as base64 plus a short summary. "bars" = length (1–64, default: arrangement length or the loop length of all tracks).',
    inputSchema: { type: 'object', properties: { bars: { type: 'integer', minimum: 1, maximum: 64 } } },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const bars = optNum(input, 'bars');
      if (bars !== undefined && (!Number.isInteger(bars) || bars < 1 || bars > 64)) fail('"bars" must be an integer from 1 to 64.');
      const { exportMidi, toBase64 } = await import('./midi/export');
      const res = await exportMidi(visualAstStore.get(), projectSettings.get(), bars === undefined ? {} : { bars });
      if (res.tracks.length === 0) fail('No audible track plays any notes – nothing to export.');
      return ok(`Exported ${res.tracks.length} MIDI track(s), ${res.bars} bar(s) at ${res.bpm} BPM.`, {
        fileName: 'strudelmixr.mid',
        mimeType: 'audio/midi',
        base64: toBase64(res.bytes),
        bytes: res.bytes.length,
        bars: res.bars,
        bpm: res.bpm,
        tracks: res.tracks,
        notes: res.notes.map((n) => translate('en', n.key, n.params)),
      });
    },
  },
  {
    name: 'import_midi',
    title: 'Import MIDI file',
    description:
      'Turns a Standard MIDI File (base64) into an editable project: tempo from the file, one track per MIDI track and channel; channel 10 becomes drum grids, other channels melody blocks (16th grid, held notes, up to 16 bars) or exact note code; longer pieces become a song arrangement. mode "replace" (default) replaces the project, "append" adds the tracks. Undoable. Returns notes about what was mapped or left out.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'The .mid file as base64 (a data: URL works too)' },
        mode: { type: 'string', enum: ['replace', 'append'] },
        play: { type: 'boolean' },
      },
      required: ['data'],
    },
    annotations: { consequentialHint: true, untrustedContentHint: true },
    execute: async (input) => {
      const { fromBase64 } = await import('./midi/export');
      const { importMidi, MidiImportError } = await import('./midi/import');
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(str(input, 'data'));
      } catch {
        fail('"data" is not valid base64.');
      }
      let result: ReturnType<typeof importMidi>;
      try {
        result = importMidi(bytes);
      } catch (err) {
        if (err instanceof MidiImportError) fail(`Could not import: ${translate('en', err.messageKey, err.params)}`);
        throw err;
      }
      if (input.mode === 'append') appendProject(result.ast);
      else loadProject(result.ast, result.settings);
      if (input.play === true) transportCommand.set({ action: 'play', at: Date.now() });
      return ok(`Imported ${result.stats.tracks} track(s) from MIDI.`, {
        stats: result.stats,
        notes: result.notes.map((n) => ({ kind: n.kind, track: n.trackName, text: translate('en', n.message.key, n.message.params) })),
        project: projectSnapshot(),
      });
    },
  },
  {
    name: 'add_track',
    title: 'Add track',
    description: 'Adds a new track that starts with a sound source block. Returns the new track id and source block id.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: SOURCE_TYPES, description: 'Sound source of the track.' },
        name: { type: 'string' },
        volume: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['source'],
    },
    execute: async (input) => {
      const source = asBlockType(input.source);
      if (BLOCK_CATALOG[source].kind !== 'source') fail(`"${source}" is not a sound source. Use one of: ${SOURCE_TYPES.join(', ')}.`);
      const patch: Partial<TrackParams> = {};
      if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim();
      const volume = optNum(input, 'volume');
      if (volume !== undefined) patch.volume = Math.min(1, Math.max(0, volume));
      const trackId = addTrack(source, patch);
      const sourceBlockId = resolvedTracks.get().find((t) => t.track.id === trackId)?.chain[0]?.id;
      return ok(`Added track with a ${source} source.`, { trackId, sourceBlockId });
    },
  },
  {
    name: 'update_track',
    title: 'Change track',
    description: 'Renames a track or changes its volume (0-1), mute or solo state.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: ID,
        name: { type: 'string' },
        volume: { type: 'number', minimum: 0, maximum: 1 },
        muted: { type: 'boolean' },
        solo: { type: 'boolean' },
      },
      required: ['trackId'],
    },
    execute: async (input) => {
      const track = requireTrack(str(input, 'trackId'));
      const patch: Partial<TrackParams> = {};
      if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim();
      const volume = optNum(input, 'volume');
      if (volume !== undefined) patch.volume = Math.min(1, Math.max(0, volume));
      if (typeof input.muted === 'boolean') patch.muted = input.muted;
      if (typeof input.solo === 'boolean') patch.solo = input.solo;
      updateTrack(track.id, patch);
      return ok(`Updated track "${track.params.name}".`);
    },
  },
  {
    name: 'remove_track',
    title: 'Remove track',
    description: 'Deletes a track and all its blocks (undoable).',
    inputSchema: { type: 'object', properties: { trackId: ID }, required: ['trackId'] },
    annotations: { consequentialHint: true },
    execute: async (input) => {
      const track = requireTrack(str(input, 'trackId'));
      removeTrack(track.id);
      return ok(`Removed track "${track.params.name}".`);
    },
  },
  {
    name: 'add_block',
    title: 'Add block',
    description:
      'Adds a modifier or effect block to a track (appended at the end, or at "index"). Adding a source block replaces the track\'s current source. Parameters are optional; see list_block_types.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: ID,
        type: { type: 'string', enum: BLOCK_TYPES },
        index: { type: 'integer', minimum: 0 },
        params: { type: 'object' },
      },
      required: ['trackId', 'type'],
    },
    execute: async (input) => {
      const track = requireTrack(str(input, 'trackId'));
      const type = asBlockType(input.type);
      const params = coerceParams(type, input.params);
      const index = optNum(input, 'index');
      const blockId = addBlock(track.id, type, index, params);
      return ok(`Added ${type} to "${track.params.name}".`, { blockId });
    },
  },
  {
    name: 'update_block',
    title: 'Change block parameters',
    description:
      'Changes parameters of a block (only the given keys). Numbers are clamped to their range. For drum patterns use set_drum_pattern, for melodies set_notes. "bypassed": true mutes the block without deleting it.',
    inputSchema: {
      type: 'object',
      properties: { blockId: ID, params: { type: 'object' }, bypassed: { type: 'boolean' } },
      required: ['blockId'],
    },
    execute: async (input) => {
      const block = requireBlock(str(input, 'blockId'));
      const params = coerceParams(block.type, input.params);
      if (Object.keys(params).length > 0) updateBlockParams(block.id, params);
      if (typeof input.bypassed === 'boolean') setBlockBypassed(block.id, input.bypassed);
      return ok(`Updated ${block.type} block.`, { params: paramsForAgent(params) });
    },
  },
  {
    name: 'set_drum_pattern',
    title: 'Set drum pattern',
    description: `Sets the step pattern of a drums block. One string of ${STEPS} steps per instrument ("x" = hit, "-" = rest; 4 steps = 1 beat). Instruments: bd (kick), sd (snare), cp (clap), hh (closed hi-hat), oh (open hi-hat), rim. Instruments you leave out are cleared.`,
    inputSchema: {
      type: 'object',
      properties: {
        blockId: ID,
        pattern: {
          type: 'object',
          additionalProperties: { type: 'string', pattern: `^[xX-]{${STEPS}}$` },
          description: 'e.g. {"bd": "x---x---x---x---", "sd": "----x-------x---", "hh": "--x---x---x---x-"}',
        },
      },
      required: ['blockId', 'pattern'],
    },
    execute: async (input) => {
      const block = requireBlock(str(input, 'blockId'));
      const def = getBlockDef(block.type).params.find((p) => p.type === 'drumGrid');
      if (!def || def.type !== 'drumGrid') fail(`Block "${block.type}" has no drum pattern.`);
      updateBlockParams(block.id, { [def.key]: coerceParam(def, input.pattern) });
      return ok('Drum pattern set.');
    },
  },
  {
    name: 'set_notes',
    title: 'Set melody notes',
    description: `Sets the notes of a melody block as scale degrees per step (${STEPS} steps per bar, 4 steps = 1 beat). 0 = root note of the chosen key/scale, higher numbers go up the scale; an array is a chord (e.g. [0,2,4]), null a rest, and {"notes": 4, "length": 3} a note held for 3 steps. "bars" (1, 2, 4, 8, 16) makes a longer melody: then "steps" has ${STEPS} × bars entries. Key, scale, octave and sound are parameters of the block (update_block).`,
    inputSchema: {
      type: 'object',
      properties: {
        blockId: ID,
        bars: { type: 'integer', enum: [...NOTE_GRID_BARS] },
        steps: {
          type: 'array',
          minItems: STEPS,
          maxItems: STEPS * 16,
          items: {
            anyOf: [
              { type: 'integer' },
              { type: 'array', items: { type: 'integer' } },
              { type: 'null' },
              {
                type: 'object',
                properties: {
                  notes: { anyOf: [{ type: 'integer' }, { type: 'array', items: { type: 'integer' } }] },
                  length: { type: 'integer', minimum: 1 },
                },
                required: ['notes'],
              },
            ],
          },
        },
      },
      required: ['blockId', 'steps'],
    },
    execute: async (input) => {
      const block = requireBlock(str(input, 'blockId'));
      const def = getBlockDef(block.type).params.find((p) => p.type === 'noteGrid');
      if (!def || def.type !== 'noteGrid') fail(`Block "${block.type}" has no notes.`);
      const bars = optNum(input, 'bars') ?? 1;
      updateBlockParams(block.id, { [def.key]: parseNoteSteps(input.steps, def.degrees, bars) });
      return ok('Notes set.');
    },
  },
  {
    name: 'move_block',
    title: 'Move block',
    description: 'Moves a block to another position, optionally into another track. Sources always stay first.',
    inputSchema: {
      type: 'object',
      properties: { blockId: ID, trackId: ID, index: { type: 'integer', minimum: 0 } },
      required: ['blockId', 'trackId', 'index'],
    },
    execute: async (input) => {
      const block = requireBlock(str(input, 'blockId'));
      const track = requireTrack(str(input, 'trackId'));
      moveBlock(block.id, track.id, optNum(input, 'index') ?? 0);
      return ok(`Moved ${block.type} block.`);
    },
  },
  {
    name: 'remove_block',
    title: 'Remove block',
    description: 'Deletes a block from its track (undoable).',
    inputSchema: { type: 'object', properties: { blockId: ID }, required: ['blockId'] },
    execute: async (input) => {
      const block = requireBlock(str(input, 'blockId'));
      removeBlock(block.id);
      return ok(`Removed ${block.type} block.`);
    },
  },
  {
    name: 'create_arrangement',
    title: 'Create song arrangement',
    description:
      'Turns the loop project into a song: creates an arrangement with sections (each a number of bars/cycles). Tracks play in every section until you change them with set_section_cell. Returns the section ids.',
    inputSchema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          minItems: 1,
          items: { type: 'object', properties: { cycles: { type: 'number', minimum: 1 }, name: { type: 'string' } }, required: ['cycles'] },
        },
      },
      required: ['sections'],
    },
    execute: async (input) => {
      if (!Array.isArray(input.sections) || input.sections.length === 0) fail('"sections" must be a non-empty array.');
      const specs = input.sections as { cycles?: unknown; name?: unknown }[];
      const valid = specs.map((sp, i) => {
        if (typeof sp.cycles !== 'number' || !(sp.cycles > 0)) fail(`Section ${i + 1}: "cycles" must be a number > 0.`);
        return { cycles: sp.cycles, name: typeof sp.name === 'string' ? sp.name : undefined };
      });
      if (visualAstStore.get().arrangement) removeArrangement();
      const first = createArrangement(valid[0]!.cycles);
      if (valid[0]!.name) updateSection(first, { name: valid[0]!.name });
      const ids = [first, ...valid.slice(1).map((sp) => addSection(sp.cycles, undefined, sp.name))];
      return ok(`Arrangement with ${ids.length} section(s) created.`, { sectionIds: ids });
    },
  },
  {
    name: 'update_section',
    title: 'Change section',
    description: 'Renames a section of the arrangement or changes its length in bars (cycles).',
    inputSchema: {
      type: 'object',
      properties: { sectionId: ID, cycles: { type: 'number', minimum: 1 }, name: { type: 'string' } },
      required: ['sectionId'],
    },
    execute: async (input) => {
      const sec = requireSection(str(input, 'sectionId'));
      const patch: { cycles?: number; name?: string } = {};
      const cycles = optNum(input, 'cycles');
      if (cycles !== undefined) {
        if (!(cycles > 0)) fail('"cycles" must be > 0.');
        patch.cycles = cycles;
      }
      if (typeof input.name === 'string') patch.name = input.name;
      updateSection(sec.id, patch);
      return ok('Section updated.');
    },
  },
  {
    name: 'add_section',
    title: 'Add section',
    description: 'Adds a section to the arrangement (at the end or at "index"). Tracks continue as in the neighbouring section.',
    inputSchema: {
      type: 'object',
      properties: { cycles: { type: 'number', minimum: 1 }, index: { type: 'integer', minimum: 0 }, name: { type: 'string' } },
      required: ['cycles'],
    },
    execute: async (input) => {
      if (!visualAstStore.get().arrangement) fail('There is no arrangement yet – use create_arrangement first.');
      const cycles = optNum(input, 'cycles');
      if (cycles === undefined || !(cycles > 0)) fail('"cycles" must be a number > 0.');
      const id = addSection(cycles, optNum(input, 'index'), typeof input.name === 'string' ? input.name : undefined);
      return ok('Section added.', { sectionId: id });
    },
  },
  {
    name: 'remove_section',
    title: 'Remove section',
    description: 'Deletes a section of the arrangement (undoable). Removing the last section removes the arrangement.',
    inputSchema: { type: 'object', properties: { sectionId: ID }, required: ['sectionId'] },
    annotations: { consequentialHint: true },
    execute: async (input) => {
      const sec = requireSection(str(input, 'sectionId'));
      removeSection(sec.id);
      return ok('Section removed.');
    },
  },
  {
    name: 'set_section_cell',
    title: 'Track on/off in a section',
    description:
      'Decides whether a track plays in a section of the arrangement. Optional "code" is a Strudel method chain applied to the track only in this section, e.g. ".lpf(800)" or ".slow(2)".',
    inputSchema: {
      type: 'object',
      properties: { trackId: ID, sectionId: ID, on: { type: 'boolean' }, code: { type: 'string' } },
      required: ['trackId', 'sectionId', 'on'],
    },
    execute: async (input) => {
      const track = requireTrack(str(input, 'trackId'));
      const sec = requireSection(str(input, 'sectionId'));
      if (typeof input.on !== 'boolean') fail('"on" must be true or false.');
      const code = typeof input.code === 'string' ? input.code : undefined;
      setSectionCell(track.id, sec.id, code ? { on: input.on, code } : { on: input.on });
      return ok(`"${track.params.name}" ${input.on ? 'plays' : 'is silent'} in this section.`);
    },
  },
  {
    name: 'loop_section',
    title: 'Loop a section',
    description: 'Plays only one section of the arrangement in a loop (to work on it); sectionId null plays the whole song again.',
    inputSchema: { type: 'object', properties: { sectionId: { type: ['string', 'null'] } }, required: ['sectionId'] },
    execute: async (input) => {
      if (input.sectionId === null) {
        setLoopSection(null);
        return ok('Playing the whole song.');
      }
      const sec = requireSection(str(input, 'sectionId'));
      setLoopSection(sec.id);
      return ok('Looping the section.');
    },
  },
  {
    name: 'set_tempo',
    title: 'Set tempo',
    description: 'Sets the tempo in BPM (40-220).',
    inputSchema: { type: 'object', properties: { bpm: { type: 'number', minimum: 40, maximum: 220 } }, required: ['bpm'] },
    execute: async (input) => {
      const bpm = optNum(input, 'bpm');
      if (bpm === undefined) fail('"bpm" is required.');
      setBpm(bpm, false);
      return ok(`Tempo set to ${projectSettings.get().bpm} BPM.`);
    },
  },
  {
    name: 'play',
    title: 'Play',
    description:
      'Starts playback. Browsers only allow audio after the user has interacted with the page; if the engine reports an error, ask the user to press the play button once.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      transportCommand.set({ action: 'play', at: Date.now() });
      await waitFor(() => playbackState.get().status !== 'loading', 8000);
      const pb = playbackState.get();
      return pb.isPlaying ? ok('Playing.') : { ok: false, summary: pb.error ?? 'Playback did not start – the user may need to press play once.' };
    },
  },
  {
    name: 'stop',
    title: 'Stop',
    description: 'Stops playback.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      transportCommand.set({ action: 'stop', at: Date.now() });
      return ok('Stopped.');
    },
  },
  {
    name: 'undo',
    title: 'Undo',
    description: 'Undoes the last change to the project.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      undo();
      return ok('Undone.');
    },
  },
  {
    name: 'redo',
    title: 'Redo',
    description: 'Redoes the last undone change.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      redo();
      return ok('Redone.');
    },
  },
];

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => (cond() || Date.now() - start > timeoutMs ? resolve() : setTimeout(tick, 100));
    setTimeout(tick, 150);
  });
}

/* ------------------------------------------------------------------ */
/* Registrierung                                                       */
/* ------------------------------------------------------------------ */

let controller: AbortController | null = null;

/** Wrappt execute: Eingabefehler werden als lesbare Antwort zurückgegeben statt als Ausnahme. */
function guarded(tool: ModelContextTool): ModelContextTool {
  return {
    ...tool,
    execute: async (input, options) => {
      try {
        return await tool.execute(input ?? {}, options);
      } catch (err) {
        if (err instanceof ToolInputError) return { ok: false, error: err.message };
        throw err;
      }
    },
  };
}

export function isWebMcpSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof document.modelContext?.registerTool === 'function';
}

/**
 * Registriert alle Werkzeuge bei `document.modelContext`. Nur im Browser,
 * idempotent; ohne WebMCP-Unterstützung passiert nichts.
 */
export function startWebMcpAgent(): void {
  if (controller || !isWebMcpSupported()) return;
  const mc = document.modelContext;
  if (!mc) return;
  controller = new AbortController();
  const { signal } = controller;
  for (const tool of TOOLS) {
    mc.registerTool(guarded(tool), { signal }).catch((err: unknown) => {
      console.warn(`[WebMCP] Werkzeug „${tool.name}“ nicht registriert:`, err);
    });
  }
}

/** Meldet alle Werkzeuge wieder ab (z. B. bei HMR). */
export function stopWebMcpAgent(): void {
  controller?.abort();
  controller = null;
}
