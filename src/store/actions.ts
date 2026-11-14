import { atom } from 'nanostores';
import { TRACK_COLORS, defaultParams, getBlockDef } from '../blocks/catalog';
import { blockLabel } from '../blocks/text';
import { t } from '../i18n';
import type {
  Arrangement,
  BlockNode,
  BlockType,
  ParamValues,
  ProjectSettings,
  SectionCell,
  TrackNode,
  TrackParams,
  UserSampleSlot,
  VisualAst,
  VisualEdge,
  VisualNode,
} from '../types/ast';
import { isTrackNode } from '../types/ast';
import { compile } from '../agents/compiler/compile';
import { importStrudelCode, type ImportResult } from '../agents/importer';
import { projectEpoch, projectSettings, uiState, visualAstStore } from './agentBus';
import { mergeImportedProject, type CodeSyncResult } from './codeSync';
import { chainIds, findNode, resolveTracks, trackOfBlock } from './selectors';

/**
 * Einzige Schreib-API für den visuellen AST. Wird von der UI und vom
 * AI-Assistant genutzt. Alle Mutationen sind immutabel und landen in der
 * Undo-Historie.
 */

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Ersetzt die Kette einer Spur durch die gegebene Block-Reihenfolge. */
function withChain(ast: VisualAst, trackId: string, blockIds: string[]): VisualAst {
  const old = new Set([trackId, ...chainIds(ast, trackId)]);
  const edges = ast.edges.filter((e) => !old.has(e.source));
  const ids = [trackId, ...blockIds];
  for (let i = 0; i < ids.length - 1; i++) {
    edges.push({ id: `e-${ids[i]}-${ids[i + 1]}`, source: ids[i]!, target: ids[i + 1]! } satisfies VisualEdge);
  }
  return { ...ast, edges };
}

/* ------------------------------------------------------------------ */
/* Undo / Redo                                                          */
/* ------------------------------------------------------------------ */

interface Snapshot {
  ast: VisualAst;
  settings: ProjectSettings;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 600;
const past: Snapshot[] = [];
const future: Snapshot[] = [];
let lastCommit: { key: string; at: number } | null = null;

export const historyState = atom<{ canUndo: boolean; canRedo: boolean }>({ canUndo: false, canRedo: false });

function snapshot(): Snapshot {
  return { ast: visualAstStore.get(), settings: { ...projectSettings.get() } };
}

function syncHistoryState() {
  historyState.set({ canUndo: past.length > 0, canRedo: future.length > 0 });
}

/**
 * Wendet eine Mutation an und legt einen Undo-Punkt an.
 * @param coalesceKey Gleiche Keys innerhalb von COALESCE_MS werden zu einem
 *   Undo-Schritt zusammengefasst (z. B. Slider-Drag).
 */
function commit(mutate: (ast: VisualAst) => VisualAst, coalesceKey?: string) {
  const now = Date.now();
  const coalesce = coalesceKey !== undefined && lastCommit?.key === coalesceKey && now - lastCommit.at < COALESCE_MS;
  if (!coalesce) {
    past.push(snapshot());
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  future.length = 0;
  lastCommit = coalesceKey !== undefined ? { key: coalesceKey, at: now } : null;
  visualAstStore.set(mutate(visualAstStore.get()));
  syncHistoryState();
}

function restore(s: Snapshot) {
  visualAstStore.set(s.ast);
  projectSettings.set(s.settings);
  const sel = uiState.get().selectedNodeId;
  if (sel && !findNode(s.ast, sel)) uiState.setKey('selectedNodeId', null);
}

export function undo() {
  const prev = past.pop();
  if (!prev) return;
  future.push(snapshot());
  lastCommit = null;
  restore(prev);
  syncHistoryState();
}

export function redo() {
  const next = future.pop();
  if (!next) return;
  past.push(snapshot());
  lastCommit = null;
  restore(next);
  syncHistoryState();
}

/* ------------------------------------------------------------------ */
/* Spuren                                                              */
/* ------------------------------------------------------------------ */

/**
 * Legt eine neue Spur an, optional direkt mit Klangquelle.
 * @returns ID der neuen Spur
 */
export function addTrack(sourceType?: BlockType, params?: Partial<TrackParams>): string {
  const ast = visualAstStore.get();
  const trackCount = ast.nodes.filter(isTrackNode).length;
  const number = trackCount + 1;
  const name = sourceType
    ? t('blocks.track.numbered', { name: blockLabel(sourceType), number })
    : t('blocks.track.untitled', { number });
  const track: TrackNode = {
    id: newId('track'),
    type: 'track',
    params: {
      name,
      color: TRACK_COLORS[trackCount % TRACK_COLORS.length]!,
      volume: 0.8,
      muted: false,
      solo: false,
      ...params,
    },
  };
  const blocks: BlockNode[] = sourceType ? [{ id: newId('block'), type: sourceType, params: defaultParams(sourceType) }] : [];
  commit((a) =>
    withChain(
      { ...a, nodes: [...a.nodes, track, ...blocks] },
      track.id,
      blocks.map((b) => b.id),
    ),
  );
  return track.id;
}

export function removeTrack(trackId: string) {
  commit((a) => {
    const remove = new Set([trackId, ...chainIds(a, trackId)]);
    const next: VisualAst = {
      nodes: a.nodes.filter((n) => !remove.has(n.id)),
      edges: a.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target)),
    };
    if (a.arrangement) {
      const { [trackId]: _removed, ...cells } = a.arrangement.cells;
      next.arrangement = { ...a.arrangement, cells };
    }
    return next;
  });
  const sel = uiState.get().selectedNodeId;
  if (sel && !findNode(visualAstStore.get(), sel)) uiState.setKey('selectedNodeId', null);
}

export function duplicateTrack(trackId: string): string | undefined {
  const ast = visualAstStore.get();
  const track = findNode(ast, trackId);
  if (!track || !isTrackNode(track)) return undefined;
  const name = t('blocks.track.copy', { name: track.params.name });
  const copy: TrackNode = { ...track, id: newId('track'), params: { ...track.params, name, solo: false } };
  const blocks = chainIds(ast, trackId)
    .map((id) => findNode(ast, id))
    .filter((n): n is BlockNode => n !== undefined && !isTrackNode(n))
    .map((b) => ({ ...structuredClone(b), id: newId('block') }));
  commit((a) => {
    const idx = a.nodes.findIndex((n) => n.id === trackId);
    const nodes = [...a.nodes];
    // Spur direkt nach dem Original einsortieren (Reihenfolge der Track-Knoten = Anzeige-Reihenfolge)
    const lastOfOriginal = Math.max(idx, ...chainIds(a, trackId).map((id) => nodes.findIndex((n) => n.id === id)));
    nodes.splice(lastOfOriginal + 1, 0, copy, ...blocks);
    const cells = a.arrangement?.cells[trackId];
    const arrangement = a.arrangement && cells ? { ...a.arrangement, cells: { ...a.arrangement.cells, [copy.id]: structuredClone(cells) } } : a.arrangement;
    return withChain(arrangement ? { ...a, nodes, arrangement } : { ...a, nodes }, copy.id, blocks.map((b) => b.id));
  });
  return copy.id;
}

export function updateTrack(trackId: string, patch: Partial<TrackParams>, coalesce = false) {
  commit(
    (a) => ({
      ...a,
      nodes: a.nodes.map((n) => (n.id === trackId && isTrackNode(n) ? { ...n, params: { ...n.params, ...patch } } : n)),
    }),
    coalesce ? `track:${trackId}:${Object.keys(patch).join(',')}` : undefined,
  );
}

/** Verschiebt eine Spur in der Anzeige-Reihenfolge. */
export function moveTrack(trackId: string, toIndex: number) {
  commit((a) => {
    const tracks = a.nodes.filter(isTrackNode);
    const from = tracks.findIndex((t) => t.id === trackId);
    if (from < 0) return a;
    const [moved] = tracks.splice(from, 1);
    tracks.splice(Math.max(0, Math.min(toIndex, tracks.length)), 0, moved!);
    return { ...a, nodes: [...tracks, ...a.nodes.filter((n) => !isTrackNode(n))] };
  });
}

/* ------------------------------------------------------------------ */
/* Blöcke                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fügt einen Block in die Kette einer Spur ein.
 * - Klangquellen (kind "source") stehen immer an Position 0; eine vorhandene
 *   Quelle wird ersetzt.
 * - Andere Blöcke werden an `index` (Default: Ende) eingefügt, nie vor die Quelle.
 * @returns ID des neuen Blocks
 */
export function addBlock(trackId: string, type: BlockType, index?: number, params?: ParamValues): string {
  const block: BlockNode = { id: newId('block'), type, params: { ...defaultParams(type), ...params } };
  const isSource = getBlockDef(type).kind === 'source';
  commit((a) => {
    let ids = chainIds(a, trackId);
    let nodes = [...a.nodes, block];
    const firstIsSource = ids[0] !== undefined && isSourceNode(a, ids[0]);
    if (isSource) {
      if (firstIsSource) {
        const old = ids[0]!;
        nodes = nodes.filter((n) => n.id !== old);
        ids = ids.slice(1);
      }
      ids = [block.id, ...ids];
    } else {
      const min = firstIsSource ? 1 : 0;
      const at = Math.max(min, Math.min(index ?? ids.length, ids.length));
      ids = [...ids.slice(0, at), block.id, ...ids.slice(at)];
    }
    return withChain({ ...a, nodes }, trackId, ids);
  });
  return block.id;
}

function isSourceNode(ast: VisualAst, id: string): boolean {
  const n = findNode(ast, id);
  return n !== undefined && !isTrackNode(n) && getBlockDef(n.type).kind === 'source';
}

export function removeBlock(blockId: string) {
  commit((a) => {
    const trackId = trackOfBlock(a, blockId);
    const withoutNode = { ...a, nodes: a.nodes.filter((n) => n.id !== blockId) };
    if (!trackId) return withoutNode;
    return withChain(withoutNode, trackId, chainIds(a, trackId).filter((id) => id !== blockId));
  });
  if (uiState.get().selectedNodeId === blockId) uiState.setKey('selectedNodeId', null);
}

/**
 * Verschiebt einen Block innerhalb seiner Spur oder in eine andere Spur.
 * Klangquellen bleiben vorne; Nicht-Quellen können nicht vor eine Quelle.
 */
export function moveBlock(blockId: string, toTrackId: string, toIndex: number) {
  commit((a) => {
    const fromTrackId = trackOfBlock(a, blockId);
    if (!fromTrackId) return a;
    let next = withChain(a, fromTrackId, chainIds(a, fromTrackId).filter((id) => id !== blockId));
    const target = chainIds(next, toTrackId);
    if (isSourceNode(a, blockId)) {
      // Quelle in andere Spur: ersetzt dortige Quelle nicht stillschweigend → nur wenn keine vorhanden
      if (target[0] !== undefined && isSourceNode(next, target[0])) return a;
      return withChain(next, toTrackId, [blockId, ...target]);
    }
    const min = target[0] !== undefined && isSourceNode(next, target[0]) ? 1 : 0;
    const at = Math.max(min, Math.min(toIndex, target.length));
    next = withChain(next, toTrackId, [...target.slice(0, at), blockId, ...target.slice(at)]);
    return next;
  });
}

/**
 * Ändert Block-Parameter (Merge).
 * @param coalesce true bei kontinuierlichen Eingaben (Slider, Tippen)
 */
export function updateBlockParams(blockId: string, patch: ParamValues, coalesce = false) {
  commit(
    (a) => ({
      ...a,
      nodes: a.nodes.map((n) => (n.id === blockId && !isTrackNode(n) ? { ...n, params: { ...n.params, ...patch } } : n)),
    }),
    coalesce ? `block:${blockId}:${Object.keys(patch).join(',')}` : undefined,
  );
}

export function setBlockBypassed(blockId: string, bypassed: boolean) {
  commit((a) => ({
    ...a,
    nodes: a.nodes.map((n) => (n.id === blockId && !isTrackNode(n) ? { ...n, bypassed } : n)),
  }));
}

/* ------------------------------------------------------------------ */
/* Projekt                                                             */
/* ------------------------------------------------------------------ */

export function setBpm(bpm: number, coalesce = true) {
  const clamped = Math.round(Math.max(40, Math.min(220, bpm)));
  const now = Date.now();
  const key = 'settings:bpm';
  if (!(coalesce && lastCommit?.key === key && now - lastCommit.at < COALESCE_MS)) {
    past.push(snapshot());
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  future.length = 0;
  lastCommit = { key, at: now };
  projectSettings.setKey('bpm', clamped);
  syncHistoryState();
}

/** Ersetzt das komplette Projekt (Vorlage laden, AI-Assistant, Import). Undo-fähig. */
export function loadProject(ast: VisualAst, settings?: Partial<ProjectSettings>) {
  past.push(snapshot());
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  lastCommit = null;
  visualAstStore.set(structuredClone(ast));
  // Setup-Code und eigene Samples gehören zum Projekt: beim Laden ersetzen (fehlen sie, sind sie weg)
  const { prelude: _previous, samples: _previousSamples, ...current } = projectSettings.get();
  projectSettings.set({ ...current, ...settings });
  uiState.setKey('selectedNodeId', null);
  syncHistoryState();
  projectEpoch.set(projectEpoch.get() + 1);
}

/**
 * Setzt den Setup-Code des Projekts (leer = entfernen). Undo-fähig.
 * @param coalesce true beim Tippen
 */
export function setPrelude(code: string, coalesce = false) {
  const now = Date.now();
  const key = 'settings:prelude';
  if (!(coalesce && lastCommit?.key === key && now - lastCommit.at < COALESCE_MS)) {
    past.push(snapshot());
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  future.length = 0;
  lastCommit = coalesce ? { key, at: now } : null;
  const { prelude: _previous, ...current } = projectSettings.get();
  projectSettings.set(code.trim() === '' ? current : { ...current, prelude: code });
  syncHistoryState();
}

/** Hängt Setup-Code an den vorhandenen an (z. B. „Import → Zum Projekt hinzufügen“). */
export function appendPrelude(code: string) {
  const extra = code.trim();
  if (extra === '') return;
  const existing = projectSettings.get().prelude?.trim();
  setPrelude(existing ? `${existing}\n\n${extra}` : extra);
}

/**
 * Setzt die eigenen Sample-Slots des Projekts (leer = entfernen). Undo-fähig.
 * @param coalesceKey gleiche Keys kurz hintereinander = ein Undo-Schritt (z. B. Umbenennen beim Tippen)
 */
export function setUserSamples(slots: UserSampleSlot[], coalesceKey?: string) {
  const now = Date.now();
  if (!(coalesceKey !== undefined && lastCommit?.key === coalesceKey && now - lastCommit.at < COALESCE_MS)) {
    past.push(snapshot());
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  future.length = 0;
  lastCommit = coalesceKey !== undefined ? { key: coalesceKey, at: now } : null;
  const { samples: _previous, ...current } = projectSettings.get();
  projectSettings.set(slots.length === 0 ? current : { ...current, samples: slots });
  syncHistoryState();
}

/**
 * Hängt die Spuren eines anderen Projekts (z. B. Import) an das aktuelle an –
 * ein Undo-Schritt, Tempo & Co. bleiben unverändert. Alle IDs werden neu vergeben
 * (keine Kollisionen), Kanten neu aufgebaut, Spurfarben laufen reihum weiter.
 * Blöcke, die zu keiner Spur gehören, werden verworfen.
 * @param prelude Setup-Code des anderen Projekts – wird im SELBEN Undo-Schritt an den
 *   vorhandenen angehängt (wie appendPrelude, aber ohne zweiten Undo-Punkt).
 * @returns IDs der neuen Spuren (in Reihenfolge)
 */
export function appendProject(ast: VisualAst, prelude?: string, samples?: UserSampleSlot[]): string[] {
  const incoming = resolveTracks(ast);
  if (incoming.length === 0) return [];
  const offset = visualAstStore.get().nodes.filter(isTrackNode).length;
  const nodes: VisualNode[] = [];
  const chains: { trackId: string; blockIds: string[] }[] = [];
  const idMap = new Map<string, string>();
  incoming.forEach(({ track, chain }, i) => {
    const trackId = newId('track');
    idMap.set(track.id, trackId);
    const color = TRACK_COLORS[(offset + i) % TRACK_COLORS.length]!;
    nodes.push({ ...structuredClone(track), id: trackId, params: { ...structuredClone(track.params), color } });
    const blocks = chain.map((b) => ({ ...structuredClone(b), id: newId('block') }));
    nodes.push(...blocks);
    chains.push({ trackId, blockIds: blocks.map((b) => b.id) });
  });
  commit((a) => {
    const merged = chains.reduce((acc, c) => withChain(acc, c.trackId, c.blockIds), { ...a, nodes: [...a.nodes, ...nodes] });
    // Arrangement: hat das aktuelle Projekt keins, übernimmt es das importierte (vorhandene
    // Spuren spielen darin durchgehend). Gibt es schon eins, spielen neue Spuren durchgehend.
    if (!a.arrangement && ast.arrangement) {
      const cells: Arrangement['cells'] = {};
      for (const [oldId, row] of Object.entries(ast.arrangement.cells)) {
        const newTrack = idMap.get(oldId);
        if (newTrack) cells[newTrack] = structuredClone(row);
      }
      return { ...merged, arrangement: { sections: structuredClone(ast.arrangement.sections), cells, loopSection: null } };
    }
    return merged;
  });
  // commit() hat den Undo-Punkt samt Einstellungen schon gesichert → Setup-Code direkt ergänzen
  const extra = prelude?.trim();
  if (extra) {
    const existing = projectSettings.get().prelude?.trim();
    projectSettings.set({ ...projectSettings.get(), prelude: existing ? `${existing}\n\n${extra}` : extra });
  }
  // Eigene Samples ergänzen (gleicher Undo-Schritt); gleichnamige Slots behält das Projekt
  if (samples && samples.length > 0) {
    const current = projectSettings.get().samples ?? [];
    const names = new Set(current.map((s) => s.name));
    const added = samples.filter((s) => !names.has(s.name));
    if (added.length > 0) projectSettings.set({ ...projectSettings.get(), samples: [...current, ...added] });
  }
  return chains.map((c) => c.trackId);
}

/* ------------------------------------------------------------------ */
/* Arrangement (Song-Ablauf)                                           */
/* ------------------------------------------------------------------ */

function mutateArrangement(mutate: (arr: Arrangement, ast: VisualAst) => Arrangement | undefined, coalesceKey?: string) {
  commit((a) => {
    const next = mutate(structuredClone(a.arrangement ?? { sections: [], cells: {}, loopSection: null }), a);
    if (!next) {
      const { arrangement: _removed, ...rest } = a;
      return rest;
    }
    return { ...a, arrangement: next };
  }, coalesceKey);
}

/**
 * Legt ein Arrangement an: ein Abschnitt, in dem alle Spuren spielen.
 * @returns ID des Abschnitts
 */
export function createArrangement(cycles = 8): string {
  const id = newId('section');
  mutateArrangement(() => ({ sections: [{ id, cycles }], cells: {}, loopSection: null }));
  return id;
}

/** Entfernt das Arrangement – alle Spuren spielen wieder als Loop. */
export function removeArrangement() {
  mutateArrangement(() => undefined);
}

/**
 * Fügt einen Abschnitt ein (Default: am Ende). Spuren übernehmen den Zustand des
 * Abschnitts davor (bzw. danach), damit der Song nicht plötzlich verstummt.
 * @returns ID des neuen Abschnitts
 */
export function addSection(cycles = 8, index?: number, name?: string): string {
  const id = newId('section');
  mutateArrangement((arr) => {
    const at = Math.max(0, Math.min(index ?? arr.sections.length, arr.sections.length));
    const neighbour = arr.sections[at - 1] ?? arr.sections[at];
    arr.sections.splice(at, 0, name ? { id, cycles, name } : { id, cycles });
    if (neighbour) {
      for (const row of Object.values(arr.cells)) {
        const prev = row[neighbour.id];
        if (prev?.on) row[id] = { on: true };
      }
    }
    return arr;
  });
  return id;
}

export function updateSection(sectionId: string, patch: { cycles?: number; name?: string }, coalesce = false) {
  mutateArrangement(
    (arr) => {
      arr.sections = arr.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const next = { ...s };
        if (patch.cycles !== undefined && Number.isFinite(patch.cycles) && patch.cycles > 0) next.cycles = patch.cycles;
        if (patch.name !== undefined) {
          if (patch.name.trim() === '') delete next.name;
          else next.name = patch.name.trim();
        }
        return next;
      });
      return arr;
    },
    coalesce ? `section:${sectionId}` : undefined,
  );
}

export function removeSection(sectionId: string) {
  mutateArrangement((arr) => {
    arr.sections = arr.sections.filter((s) => s.id !== sectionId);
    for (const row of Object.values(arr.cells)) delete row[sectionId];
    if (arr.loopSection === sectionId) arr.loopSection = null;
    return arr.sections.length > 0 ? arr : undefined;
  });
}

export function moveSection(sectionId: string, toIndex: number) {
  mutateArrangement((arr) => {
    const from = arr.sections.findIndex((s) => s.id === sectionId);
    if (from < 0) return arr;
    const [moved] = arr.sections.splice(from, 1);
    arr.sections.splice(Math.max(0, Math.min(toIndex, arr.sections.length)), 0, moved!);
    return arr;
  });
}

/**
 * Setzt den Zustand einer Spur in einem Abschnitt. Hatte die Spur noch keinen
 * Eintrag (= spielte überall), werden zuerst alle Abschnitte auf „an“ gesetzt.
 */
export function setSectionCell(trackId: string, sectionId: string, cell: SectionCell, coalesce: boolean | string = false) {
  mutateArrangement(
    (arr) => {
      const row = (arr.cells[trackId] ??= Object.fromEntries(arr.sections.map((s) => [s.id, { on: true } as SectionCell])));
      const code = cell.code?.trim();
      row[sectionId] = code ? { on: cell.on, code } : { on: cell.on };
      return arr;
    },
    // string = gemeinsamer Schlüssel, z. B. ein Mal-Strich über mehrere Zellen → ein Undo-Schritt
    typeof coalesce === 'string' ? coalesce : coalesce ? `cell:${trackId}:${sectionId}` : undefined,
  );
}

/**
 * Dupliziert einen Abschnitt direkt dahinter – samt Namen, Länge, an/aus und
 * Varianten aller Spuren. Ein Undo-Schritt.
 * @returns ID des neuen Abschnitts
 */
export function duplicateSection(sectionId: string): string | undefined {
  const source = visualAstStore.get().arrangement?.sections.find((s) => s.id === sectionId);
  if (!source) return undefined;
  const id = newId('section');
  mutateArrangement((arr) => {
    const at = arr.sections.findIndex((s) => s.id === sectionId);
    arr.sections.splice(at + 1, 0, { ...structuredClone(source), id });
    for (const row of Object.values(arr.cells)) {
      const cell = row[sectionId];
      if (cell) row[id] = structuredClone(cell);
    }
    if (arr.loopSection === sectionId) arr.loopSection = null;
    return arr;
  });
  return id;
}

/**
 * Nur einen Abschnitt in Schleife spielen (null = ganzer Song). Arbeitsmodus –
 * bewusst ohne Undo-Schritt (ändert die Musik nicht, nur was gerade läuft).
 */
export function setLoopSection(sectionId: string | null) {
  const a = visualAstStore.get();
  if (!a.arrangement) return;
  visualAstStore.set({ ...a, arrangement: { ...a.arrangement, loopSection: sectionId } });
}

/**
 * Wiedergabe ab einem Abschnitt (null = von vorn). Wie die Schleife ein Arbeitsmodus
 * ohne Undo-Schritt. Die UI startet die Wiedergabe danach neu (Strudel beginnt bei 0).
 */
export function setStartSection(sectionId: string | null) {
  const a = visualAstStore.get();
  if (!a.arrangement) return;
  visualAstStore.set({ ...a, arrangement: { ...a.arrangement, startSection: sectionId } });
}

/* ------------------------------------------------------------------ */
/* Code → Bausteine (Code-Editor)                                      */
/* ------------------------------------------------------------------ */

/**
 * Übernimmt das Import-Ergebnis eines im Code-Editor bearbeiteten Texts ID-erhaltend ins
 * Projekt (Details: src/store/codeSync.ts): Spuren werden über Namen/Reihenfolge zugeordnet,
 * IDs, Farben, Auswahl, Sample-Slots, Abschnittsnamen und alles, was der Code nicht zeigt
 * (stumme Spuren, überbrückte Bausteine …), bleiben erhalten. Nicht Abbildbares bleibt –
 * wie beim Import – Code-Baustein.
 *
 * @param options.series Tipp-Serie: alle Aufrufe mit demselben Schlüssel bilden EINEN
 *   Undo-Schritt (unabhängig vom Zeitabstand), solange dazwischen nichts anderes passiert.
 * @param options.hasTempo Steht im Code ein setcpm/setcps? (Sonst bleibt das Tempo eines leeren Projekts.)
 * @returns was passiert ist ('unchanged' = keine Änderung, kein Undo-Schritt)
 */
export function syncProjectFromCode(result: ImportResult, options: { series?: string; hasTempo?: boolean } = {}): CodeSyncResult['kind'] {
  const ast = visualAstStore.get();
  const settings = projectSettings.get();
  const availableSounds = (settings.samples ?? []).map((s) => s.name);
  let baseline: ImportResult | null = null;
  const current = compile(ast, settings).code;
  if (current.trim() !== '') {
    try {
      baseline = importStrudelCode(current, { availableSounds });
    } catch {
      baseline = null; // eigener Code nicht importierbar (sollte nicht vorkommen) → alles gilt als neu
    }
  }
  const merged = mergeImportedProject({ ast, settings, baseline, incoming: result, incomingHasTempo: options.hasTempo ?? true, newId });
  if (merged.kind !== 'changed') return merged.kind;

  const key = options.series;
  if (!(key !== undefined && lastCommit?.key === key)) {
    past.push(snapshot());
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  future.length = 0;
  lastCommit = key !== undefined ? { key, at: Date.now() } : null;
  visualAstStore.set(merged.ast);
  projectSettings.set(merged.settings);
  const sel = uiState.get().selectedNodeId;
  // 'prelude' = reservierte Auswahl des Setup-Codes (components/ui/lib/prelude.ts)
  const selGone = sel === 'prelude' ? !merged.settings.prelude?.trim() : sel !== null && !findNode(merged.ast, sel);
  if (selGone) uiState.setKey('selectedNodeId', null);
  syncHistoryState();
  return 'changed';
}

/** Beendet eine Tipp-Serie: die nächste Änderung bekommt einen eigenen Undo-Schritt. */
export function endEditSeries(series: string) {
  if (lastCommit?.key === series) lastCommit = null;
}

export function clearProject() {
  loadProject({ nodes: [], edges: [] });
}

export function selectNode(id: string | null) {
  uiState.setKey('selectedNodeId', id);
}
