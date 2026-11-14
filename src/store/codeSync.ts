/**
 * Code → Bausteine: führt ein Import-Ergebnis (aus dem Text im Code-Editor) ID-erhaltend
 * mit dem aktuellen Projekt zusammen. Reine Funktionen, ohne Stores (getestet in
 * src/store/__tests__/codeSync.test.ts); die Action dazu ist `syncProjectFromCode` in actions.ts.
 *
 * Prinzip: Drei-Wege-Abgleich wie bei einem Merge.
 *  - `baseline` = Import des AKTUELLEN kompilierten Codes (so sähe das Projekt aus, wenn man
 *    seinen eigenen Code importierte),
 *  - `incoming` = Import des Editor-Texts.
 * Nur was sich zwischen baseline und incoming unterscheidet, wird ins Projekt übertragen –
 * alles andere bleibt exakt wie es ist (IDs, Parameter, die der Code nicht zeigt, Spurfarben,
 * Abschnittsnamen, überbrückte Bausteine, stumme Spuren …). Weil beide Seiten denselben
 * Importer durchlaufen, verschwinden Darstellungsunterschiede (z. B. automatische Orbits).
 */
import { TRACK_COLORS } from '../blocks/catalog';
import { compile } from '../agents/compiler/compile';
import type { ImportResult } from '../agents/importer';
import type {
  Arrangement,
  ArrangementSection,
  BlockNode,
  ProjectSettings,
  ResolvedTrack,
  SectionCell,
  TrackNode,
  VisualAst,
  VisualEdge,
  VisualNode,
} from '../types/ast';
import { resolveTracks } from './selectors';

export type CodeSyncResult =
  /** Der Code ändert nichts an den Bausteinen (z. B. nur Kommentare/Leerzeichen). */
  | { kind: 'unchanged' }
  /** Nicht ohne Verlust als Bausteine darstellbar (z. B. Song-Ablauf mit uneinheitlichen Abschnitten). */
  | { kind: 'unrepresentable' }
  | { kind: 'changed'; ast: VisualAst; settings: ProjectSettings };

export interface CodeSyncInput {
  ast: VisualAst;
  settings: ProjectSettings;
  /** Import des aktuellen kompilierten Codes; null = leer/nicht importierbar. */
  baseline: ImportResult | null;
  incoming: ImportResult;
  /**
   * Steht im Code ein Tempo (setcpm/setcps)? Ohne Tempo im Code und ohne bisherigen Code
   * (leeres Projekt) bleibt das eingestellte Tempo.
   */
  incomingHasTempo?: boolean;
  /** ID-Erzeuger (Tests: deterministisch). */
  newId: (prefix: string) => string;
}

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

/** Längste gemeinsame Teilfolge → Paare [i, j] (aufsteigend). */
export function lcsPairs<A, B>(a: readonly A[], b: readonly B[], eq: (x: A, y: B) => boolean): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

function sameBlock(a: BlockNode, b: BlockNode): boolean {
  return a.type === b.type && JSON.stringify(a.params) === JSON.stringify(b.params);
}

/** Automatischer Effektbus des Compilers (`.orbit(2)` hinter Hall/Echo) – kein Baustein des Nutzers. */
function isOrbitArtifact(b: BlockNode): boolean {
  return b.type === 'code-fx' && /^\.orbit\(\d+\)$/.test(String(b.params['code'] ?? '').trim());
}

function isSource(b: BlockNode): boolean {
  return b.type === 'drums' || b.type === 'melody' || b.type === 'chords' || b.type === 'sample' || b.type === 'code';
}

function normName(name: string): string {
  return name.trim().toLowerCase();
}

/** Spuren, die der Compiler ausgibt (hörbar, mit Klangquelle) + Bausteine, die im Code fehlen. */
function emittedInfo(rt: ResolvedTrack, settings: ProjectSettings): { emitted: boolean; hidden: Set<string> } {
  const { track, chain } = rt;
  const solo = { ...track, params: { ...track.params, muted: false, solo: false, name: 'x' } };
  const nodes: VisualNode[] = [solo, ...chain];
  const ids = [track.id, ...chain.map((b) => b.id)];
  const edges: VisualEdge[] = ids.slice(1).map((id, i) => ({ id: `e${i}`, source: ids[i]!, target: id }));
  const res = compile({ nodes, edges }, { bpm: settings.bpm > 0 ? settings.bpm : 120 });
  const hidden = new Set<string>(chain.filter((b) => b.bypassed).map((b) => b.id));
  for (const d of res.diagnostics) if (d.nodeId && d.nodeId !== track.id) hidden.add(d.nodeId);
  return { emitted: res.code !== '', hidden };
}

/** Abschnitte in der Reihenfolge, in der der Compiler sie ausgibt (Schleife / Startabschnitt). */
export function compiledSectionOrder(arr: Arrangement | undefined): ArrangementSection[] {
  if (!arr) return [];
  const sections = arr.sections.filter((s) => Number.isFinite(s.cycles) && s.cycles > 0);
  const loop = arr.loopSection ? sections.filter((s) => s.id === arr.loopSection) : [];
  const startAt = arr.startSection ? sections.findIndex((s) => s.id === arr.startSection) : -1;
  if (loop.length > 0) return loop;
  return startAt > 0 ? [...sections.slice(startAt), ...sections.slice(0, startAt)] : sections;
}

function sameCell(a: SectionCell | undefined, b: SectionCell | undefined): boolean {
  return (a?.on ?? false) === (b?.on ?? false) && (a?.code ?? '') === (b?.code ?? '');
}

/* ------------------------------------------------------------------ */
/* Spur-Abgleich                                                       */
/* ------------------------------------------------------------------ */

/** Ordnet Spuren zweier Listen zu: erst gleiche Namen (Reihenfolge erhaltend), dann der Rest nach Position. */
function matchTracks(a: readonly ResolvedTrack[], b: readonly ResolvedTrack[]): Map<number, number> {
  const pairs = lcsPairs(a, b, (x, y) => normName(x.track.params.name) === normName(y.track.params.name));
  const map = new Map<number, number>(pairs);
  const freeA = a.map((_, i) => i).filter((i) => !map.has(i));
  const used = new Set(map.values());
  const freeB = b.map((_, j) => j).filter((j) => !used.has(j));
  // Rest nach Position: nur zwischen denselben Ankern (sonst würde eine gelöschte Spur eine neue „umbenennen“)
  for (const i of freeA) {
    const prevA = Math.max(-1, ...[...map.keys()].filter((k) => k < i));
    const nextA = Math.min(a.length, ...[...map.keys()].filter((k) => k > i));
    const lo = prevA >= 0 ? map.get(prevA)! : -1;
    const hi = nextA < a.length ? map.get(nextA)! : b.length;
    const j = freeB.find((x) => x > lo && x < hi && ![...map.values()].includes(x));
    if (j !== undefined) map.set(i, j);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Bausteine einer Spur                                                */
/* ------------------------------------------------------------------ */

interface ChainPatch {
  chain: BlockNode[];
  /** Ein Konflikt (Änderung an etwas, das keinen Baustein im Projekt hat) → ganze Kette ersetzen. */
  conflict: boolean;
}

/**
 * Überträgt die Änderungen baseline → incoming auf die Projekt-Kette.
 * @param align baseline-Index → Projekt-Baustein (nur sichtbare, d. h. im Code vorhandene)
 */
function patchChain(
  project: readonly BlockNode[],
  base: readonly BlockNode[],
  next: readonly BlockNode[],
  align: ReadonlyMap<number, BlockNode>,
  newId: (prefix: string) => string,
): ChainPatch {
  const chain = project.map((b) => b);
  const indexOf = (id: string) => chain.findIndex((b) => b.id === id);
  const eq = lcsPairs(base, next, sameBlock);
  // Anker = letzter Projekt-Baustein vor der Stelle (für Einfügungen)
  let anchorId: string | null = null;
  let conflict = false;

  const applyHunk = (bFrom: number, bTo: number, nFrom: number, nTo: number) => {
    const removed = new Set<number>();
    for (let bi = bFrom; bi < bTo; bi++) removed.add(bi);
    for (let nj = nFrom; nj < nTo; nj++) {
      const nb = next[nj]!;
      // Geänderter Baustein: erster noch offener baseline-Baustein gleicher Art
      const bi = [...removed].find((i) => base[i]!.type === nb.type);
      if (bi !== undefined) {
        removed.delete(bi);
        const target = align.get(bi);
        if (!target) {
          conflict = true;
          continue;
        }
        const at = indexOf(target.id);
        const { bypassed: _b, ...rest } = target;
        chain[at] = { ...rest, params: structuredClone(nb.params) };
        anchorId = target.id;
        continue;
      }
      // Neue Bausteine direkt hinter dem Anker einfügen (Reihenfolge erhalten)
      const block: BlockNode = { id: newId('block'), type: nb.type, params: structuredClone(nb.params) };
      if (isSource(nb) && chain.some((b) => isSource(b) && !b.bypassed)) {
        conflict = true;
        continue;
      }
      let at = anchorId ? indexOf(anchorId) + 1 : 0;
      if (!anchorId && !isSource(nb) && chain[0] && isSource(chain[0])) at = 1;
      chain.splice(at, 0, block);
      anchorId = block.id;
    }
    for (const bi of removed) {
      const target = align.get(bi);
      if (target) chain.splice(indexOf(target.id), 1);
      else if (!isOrbitArtifact(base[bi]!)) conflict = true;
    }
  };

  let bPrev = 0;
  let nPrev = 0;
  for (const [bi, nj] of [...eq, [base.length, next.length] as [number, number]]) {
    if (bi > bPrev || nj > nPrev) applyHunk(bPrev, bi, nPrev, nj);
    if (bi < base.length) {
      const target = align.get(bi);
      if (target) anchorId = target.id;
    }
    bPrev = bi + 1;
    nPrev = nj + 1;
  }
  return { chain, conflict };
}

/** Kette komplett aus dem Import übernehmen; IDs gleichartiger Bausteine bleiben, überbrückte bleiben erhalten. */
function replaceChain(project: readonly BlockNode[], hidden: ReadonlySet<string>, next: readonly BlockNode[], artifacts: readonly BlockNode[], newId: (prefix: string) => string): BlockNode[] {
  const pool = project.filter((b) => !hidden.has(b.id));
  const out: BlockNode[] = [];
  for (const nb of next) {
    if (artifacts.some((a) => sameBlock(a, nb))) continue;
    const i = pool.findIndex((b) => b.type === nb.type);
    const id = i >= 0 ? pool.splice(i, 1)[0]!.id : newId('block');
    out.push({ id, type: nb.type, params: structuredClone(nb.params) });
  }
  const hasSource = out.some(isSource);
  for (const b of project) if (hidden.has(b.id) && !(hasSource && isSource(b))) out.push(b);
  return out;
}

/* ------------------------------------------------------------------ */
/* Zusammenführen                                                      */
/* ------------------------------------------------------------------ */

export function mergeImportedProject({ ast, settings, baseline, incoming, incomingHasTempo = true, newId }: CodeSyncInput): CodeSyncResult {
  const projectTracks = resolveTracks(ast);
  const baseTracks = baseline ? resolveTracks(baseline.ast) : [];
  const nextTracks = resolveTracks(incoming.ast);

  // Song-Ablauf, den der Importer nicht als Bausteine abbilden kann (z. B. Abschnitte je Spur
  // unterschiedlich lang) → nicht übernehmen, sonst würden Spuren zu Code-Bausteinen.
  if (baseline?.ast.arrangement && !incoming.ast.arrangement) {
    const arrangeCode = nextTracks.some((rt) => rt.chain.some((b) => b.type === 'code' && /\barrange\s*\(/.test(String(b.params['code'] ?? ''))));
    if (arrangeCode) return { kind: 'unrepresentable' };
  }

  // 1. Projekt-Spuren, die im Code stehen ↔ baseline-Spuren
  const info = new Map(projectTracks.map((rt) => [rt.track.id, emittedInfo(rt, settings)]));
  const anySolo = projectTracks.some((rt) => rt.track.params.solo);
  const playing = projectTracks.filter(
    (rt) => !rt.track.params.muted && (!anySolo || rt.track.params.solo) && info.get(rt.track.id)!.emitted,
  );
  const baseToProject = new Map<number, ResolvedTrack>();
  if (playing.length === baseTracks.length) baseTracks.forEach((_, i) => baseToProject.set(i, playing[i]!));
  else for (const [i, j] of matchTracks(baseTracks, playing)) baseToProject.set(i, playing[j]!);

  // 2. baseline ↔ incoming
  const nextToBase = new Map<number, number>();
  for (const [bi, nj] of matchTracks(baseTracks, nextTracks)) nextToBase.set(nj, bi);
  const pairedBase = new Set(nextToBase.values());

  // 3. Spuren erzeugen bzw. anpassen
  const nodes: VisualNode[] = [];
  const chains: Array<{ trackId: string; blockIds: string[] }> = [];
  const resultTrack = new Map<number, string>(); // incoming-Index → Spur-ID
  const removedProjectTracks = new Set<string>();
  baseTracks.forEach((_, bi) => {
    if (!pairedBase.has(bi)) {
      const p = baseToProject.get(bi);
      if (p) removedProjectTracks.add(p.track.id);
    }
  });
  const matchedProject = new Set<string>();
  let colorIndex = projectTracks.length;

  const built = nextTracks.map((nt, nj): { track: TrackNode; chain: BlockNode[] } => {
    const bi = nextToBase.get(nj);
    const bt = bi !== undefined ? baseTracks[bi] : undefined;
    const pt = bi !== undefined ? baseToProject.get(bi) : undefined;
    if (!bt || !pt) {
      const color = TRACK_COLORS[colorIndex++ % TRACK_COLORS.length]!;
      const track: TrackNode = {
        id: newId('track'),
        type: 'track',
        params: { ...nt.track.params, color, solo: anySolo && !nt.track.params.muted },
      };
      const chain = nt.chain.map((b) => ({ id: newId('block'), type: b.type, params: structuredClone(b.params) }));
      resultTrack.set(nj, track.id);
      return { track, chain };
    }
    matchedProject.add(pt.track.id);
    resultTrack.set(nj, pt.track.id);
    const params = { ...pt.track.params };
    if (nt.track.params.name !== bt.track.params.name) params.name = nt.track.params.name;
    if (nt.track.params.volume !== bt.track.params.volume) params.volume = nt.track.params.volume;
    if (nt.track.params.muted) params.muted = true;
    const track: TrackNode = { ...pt.track, params };

    const hidden = info.get(pt.track.id)!.hidden;
    const visible = pt.chain.filter((b) => !hidden.has(b.id));
    const align = new Map<number, BlockNode>();
    for (const [i, j] of lcsPairs(bt.chain, visible, (x, y) => x.type === y.type)) align.set(i, visible[j]!);
    const patched = patchChain(pt.chain, bt.chain, nt.chain, align, newId);
    if (!patched.conflict) return { track, chain: patched.chain };
    const artifacts = bt.chain.filter((b, i) => !align.has(i) && isOrbitArtifact(b));
    return { track, chain: replaceChain(pt.chain, hidden, nt.chain, artifacts, newId) };
  });

  // 4. Reihenfolge: Code-Reihenfolge; Spuren, die nicht im Code stehen (stumm, ohne Klang …),
  //    bleiben hinter ihrem bisherigen Vorgänger.
  const kept = projectTracks.filter((rt) => !matchedProject.has(rt.track.id) && !removedProjectTracks.has(rt.track.id));
  const anchorOf = new Map<string, string | null>();
  for (const rt of kept) {
    const idx = projectTracks.indexOf(rt);
    let anchor: string | null = null;
    for (let k = idx - 1; k >= 0; k--) {
      const id = projectTracks[k]!.track.id;
      if (matchedProject.has(id)) {
        anchor = id;
        break;
      }
    }
    anchorOf.set(rt.track.id, anchor);
  }
  const emit = (track: TrackNode, chain: BlockNode[]) => {
    nodes.push(track);
    chains.push({ trackId: track.id, blockIds: chain.map((b) => b.id) });
    for (const b of chain) nodes.push(b);
  };
  const emitKeptAfter = (anchor: string | null) => {
    for (const rt of kept) if (anchorOf.get(rt.track.id) === anchor) emit(rt.track, rt.chain);
  };
  emitKeptAfter(null);
  for (const b of built) {
    emit(b.track, b.chain);
    if (matchedProject.has(b.track.id)) emitKeptAfter(b.track.id);
  }
  // Knoten-Reihenfolge wie im Rest der App: Spuren in Anzeige-Reihenfolge, Bausteine dahinter
  const trackNodes = nodes.filter((n): n is TrackNode => n.type === 'track');
  const blockNodes = nodes.filter((n) => n.type !== 'track');
  const edges: VisualEdge[] = [];
  for (const c of chains) {
    const ids = [c.trackId, ...c.blockIds];
    for (let i = 0; i < ids.length - 1; i++) edges.push({ id: `e-${ids[i]}-${ids[i + 1]}`, source: ids[i]!, target: ids[i + 1]! });
  }
  const next: VisualAst = { nodes: [...trackNodes, ...blockNodes], edges };

  // 5. Song-Ablauf
  const arrangement = mergeArrangement({
    project: ast.arrangement,
    base: baseline?.ast.arrangement,
    incoming: incoming.ast.arrangement,
    baseTrackIds: baseTracks.map((rt) => rt.track.id),
    nextTrackIds: nextTracks.map((rt) => rt.track.id),
    nextToBase,
    baseToProjectId: new Map([...baseToProject].map(([i, rt]) => [i, rt.track.id])),
    resultTrack,
    survivingTracks: new Set(trackNodes.map((t) => t.id)),
    newId,
  });
  if (arrangement === 'unrepresentable') return { kind: 'unrepresentable' };
  if (arrangement) next.arrangement = arrangement;

  // 6. Einstellungen: nur, was sich im Code wirklich geändert hat
  const nextSettings: ProjectSettings = { ...settings };
  const baseBpm = baseline?.settings.bpm;
  if (incoming.settings.bpm !== baseBpm && (baseline || incomingHasTempo)) nextSettings.bpm = incoming.settings.bpm;
  const basePrelude = baseline?.settings.prelude ?? '';
  const nextPrelude = incoming.settings.prelude ?? '';
  if (nextPrelude !== basePrelude) {
    if (nextPrelude.trim() === '') delete nextSettings.prelude;
    else nextSettings.prelude = nextPrelude;
  }

  if (sameProject(next, ast) && JSON.stringify(nextSettings) === JSON.stringify(settings)) return { kind: 'unchanged' };
  return { kind: 'changed', ast: next, settings: nextSettings };
}

/* ------------------------------------------------------------------ */
/* Song-Ablauf                                                         */
/* ------------------------------------------------------------------ */

interface ArrangementMergeInput {
  project: Arrangement | undefined;
  base: Arrangement | undefined;
  incoming: Arrangement | undefined;
  baseTrackIds: string[];
  nextTrackIds: string[];
  nextToBase: ReadonlyMap<number, number>;
  baseToProjectId: ReadonlyMap<number, string>;
  /** incoming-Index → Spur-ID im Ergebnis */
  resultTrack: ReadonlyMap<number, string>;
  survivingTracks: ReadonlySet<string>;
  newId: (prefix: string) => string;
}

/**
 * Abschnitte des Codes (`ref`, Längen) → Projekt-Abschnitte in Compiler-Reihenfolge.
 * Der Compiler fasst aufeinanderfolgende Pausen zusammen, deshalb kann ein Code-Abschnitt
 * mehrere Projekt-Abschnitte umfassen. null = Grenzen passen nicht zusammen.
 */
function groupSections(ref: readonly number[], ordered: readonly ArrangementSection[]): string[][] | null {
  const groups: string[][] = [];
  let k = 0;
  let pos = 0;
  for (const len of ref) {
    const end = pos + len;
    const group: string[] = [];
    let p = pos;
    while (k < ordered.length && p + ordered[k]!.cycles <= end + 1e-9) {
      p += ordered[k]!.cycles;
      group.push(ordered[k]!.id);
      k++;
    }
    if (group.length === 0 || Math.abs(p - end) > 1e-9) return null;
    groups.push(group);
    pos = end;
  }
  return k === ordered.length ? groups : null;
}

function toCell(c: SectionCell | undefined): SectionCell {
  return c?.on ? (c.code ? { on: true, code: c.code } : { on: true }) : { on: false };
}

function mergeArrangement(m: ArrangementMergeInput): Arrangement | undefined | 'unrepresentable' {
  const { project, base, incoming } = m;
  if (!base && !incoming) return prune(project, m.survivingTracks);

  // Code ohne Song-Ablauf → Ablauf behalten, die betroffenen Spuren spielen durchgehend
  if (!incoming) {
    const arr = prune(project, m.survivingTracks);
    if (!arr) return undefined;
    const cells = { ...arr.cells };
    m.nextToBase.forEach((bi, nj) => {
      const bid = m.baseTrackIds[bi]!;
      if (base?.cells[bid]) delete cells[m.resultTrack.get(nj)!];
    });
    return { ...arr, cells };
  }

  const ordered = compiledSectionOrder(project);
  const ref = base ? base.sections : ordered;
  const nextSections = incoming.sections;

  // Gleicher Aufbau → Abschnitte (IDs, Namen, Schleife) behalten, nur Änderungen übertragen.
  // Verglichen wird je Projekt-Abschnitt: Der Compiler fasst Pausen je Spur zusammen, Code und
  // baseline können deshalb unterschiedlich grob unterteilt sein.
  const patch = (): Arrangement | null => {
    if (!project) return null;
    const groupsB = groupSections(ref.map((s) => s.cycles), ordered);
    if (!groupsB) return null;
    let groupsN = groupSections(nextSections.map((s) => s.cycles), ordered);
    const cycleChanges = new Map<string, number>();
    if (!groupsN) {
      // Nur Längen geändert (gleiche Anzahl, keine zusammengefassten Abschnitte) → nach Position
      if (nextSections.length !== ref.length || !groupsB.every((g) => g.length === 1)) return null;
      groupsN = groupsB;
      nextSections.forEach((ns, i) => {
        if (Math.abs(ns.cycles - ref[i]!.cycles) > 1e-9) cycleChanges.set(groupsB[i]![0]!, ns.cycles);
      });
    }
    const indexIn = (groups: string[][], sid: string) => groups.findIndex((g) => g.includes(sid));
    const arr = structuredClone(prune(project, m.survivingTracks) ?? project);
    for (const sec of arr.sections) {
      const cycles = cycleChanges.get(sec.id);
      if (cycles !== undefined) sec.cycles = cycles;
      const ni = indexIn(groupsN, sec.id);
      const ns = ni >= 0 ? nextSections[ni] : undefined;
      if (ns?.name && groupsN[ni]!.length === 1 && ns.name !== ref[indexIn(groupsB, sec.id)]?.name) sec.name = ns.name;
    }
    m.nextTrackIds.forEach((nid, nj) => {
      const trackId = m.resultTrack.get(nj)!;
      const bi = m.nextToBase.get(nj);
      const bid = bi !== undefined ? m.baseTrackIds[bi] : undefined;
      const nextRow = incoming.cells[nid];
      const baseRow = bid !== undefined ? base?.cells[bid] : undefined;
      if (!nextRow) {
        if (baseRow || bid === undefined) delete arr.cells[trackId];
        return;
      }
      const row = (arr.cells[trackId] ??= Object.fromEntries(arr.sections.map((s) => [s.id, { on: true } as SectionCell])));
      for (const sec of ordered) {
        const nc = nextRow[nextSections[indexIn(groupsN!, sec.id)]!.id];
        if (baseRow && sameCell(nc, baseRow[ref[indexIn(groupsB, sec.id)]!.id])) continue;
        row[sec.id] = toCell(nc);
      }
    });
    return arr;
  };
  const patched = patch();
  if (patched) return patched;

  // Aufbau geändert. Mit Schleife/Startabschnitt zeigt der Code nur einen Ausschnitt des Songs –
  // ein Neuaufbau würde die übrigen Abschnitte verlieren.
  if (project && (project.loopSection || project.startSection)) return 'unrepresentable';

  // Neu aufbauen: IDs/Namen nach Position übernehmen
  const sections: ArrangementSection[] = nextSections.map((ns, i) => {
    const old = ordered[i];
    const id = old?.id ?? m.newId('section');
    const name = ns.name ?? old?.name;
    return name ? { id, cycles: ns.cycles, name } : { id, cycles: ns.cycles };
  });
  const cells: Arrangement['cells'] = {};
  // Spuren, die nicht im Code stehen, behalten ihre Zeilen (für weiter existierende Abschnitte)
  const ids = new Set(sections.map((s) => s.id));
  const fromCode = new Set(m.resultTrack.values());
  for (const [trackId, row] of Object.entries(project?.cells ?? {})) {
    if (!m.survivingTracks.has(trackId) || fromCode.has(trackId)) continue;
    cells[trackId] = Object.fromEntries(Object.entries(row).filter(([sid]) => ids.has(sid)));
  }
  m.nextTrackIds.forEach((nid, nj) => {
    const row = incoming.cells[nid];
    if (!row) return;
    cells[m.resultTrack.get(nj)!] = Object.fromEntries(nextSections.map((ns, i) => [sections[i]!.id, toCell(row[ns.id])]));
  });
  return { sections, cells, loopSection: null };
}

/** Inhaltlich gleich (Spuren mit Ketten + Ablauf), unabhängig von der Knoten-Reihenfolge. */
function sameProject(a: VisualAst, b: VisualAst): boolean {
  return JSON.stringify(resolveTracks(a)) === JSON.stringify(resolveTracks(b)) && JSON.stringify(a.arrangement ?? null) === JSON.stringify(b.arrangement ?? null);
}

/** Zeilen gelöschter Spuren entfernen. */
function prune(arr: Arrangement | undefined, surviving: ReadonlySet<string>): Arrangement | undefined {
  if (!arr) return undefined;
  const cells = Object.fromEntries(Object.entries(arr.cells).filter(([id]) => surviving.has(id)));
  return Object.keys(cells).length === Object.keys(arr.cells).length ? arr : { ...arr, cells };
}
