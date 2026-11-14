import { getBlockDef } from '../../blocks/catalog';
import { blockLabel } from '../../blocks/text';
import { t } from '../../i18n';
import type { CompileDiagnostic } from '../../store/agentBus';
import { resolveTracks } from '../../store/selectors';
import type { Arrangement, BlockNode, EffectBlockType, ModifierBlockType, ProjectSettings, ResolvedTrack, VisualAst } from '../../types/ast';
import {
  DURATION_SENSITIVE,
  emitChainBlock,
  emitSource,
  isSourceType,
  orbitEffect,
  sourceInfo,
  type BlockContext,
} from './blocks';
import { appendChain, commentText, fmtNum } from './format';
import { ParamError, ParamReader } from './params';

export interface CompileResult {
  code: string;
  diagnostics: CompileDiagnostic[];
}

const DEFAULT_BPM = 120;

interface EmittedTrack {
  trackId: string;
  name: string;
  /** Quelle + Modifier/Effekte, ohne orbit/gain. */
  expr: string;
  volume: number;
  usesRoom: boolean;
  usesDelay: boolean;
}

/**
 * Reine Funktion: visueller AST → Strudel-Code (SSR-sicher, keine Browser-APIs).
 *
 * Fehlerhafte Teile werden nie als kaputter Code ausgegeben, sondern übersprungen
 * und als freundliche Diagnose gemeldet.
 */
export function compile(ast: VisualAst, settings: ProjectSettings): CompileResult {
  const diagnostics: CompileDiagnostic[] = [];
  const report = (nodeId: string | null, message: string) => diagnostics.push({ nodeId, message });

  let bpm = settings.bpm;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) {
    report(null, t('compiler.invalidTempo', { bpm: DEFAULT_BPM }));
    bpm = DEFAULT_BPM;
  }

  const tracks = resolveTracks(ast);
  const anySolo = tracks.some((t) => t.track.params.solo === true);
  const playing = tracks.filter((t) => t.track.params.muted !== true && (!anySolo || t.track.params.solo === true));

  const emitted: EmittedTrack[] = [];
  for (const t of playing) {
    const e = compileTrack(t, report);
    if (e) emitted.push(e);
  }
  if (emitted.length === 0) return { code: '', diagnostics };

  // Hall & Echo sind in Strudel pro „Orbit“ (Effektbus) global. Nutzen mehrere
  // Spuren denselben Effekt, bekommt jede ihren eigenen Orbit – sonst würden sich
  // z. B. unterschiedliche Raumgrößen gegenseitig überschreiben.
  //
  // Code, der Orbits selbst setzt (`.o(2)`, `.orbit(2)` – z. B. für Sidechain per
  // `.duck(2)`), hat Vorrang: solche Spuren bekommen keinen automatischen Orbit, und
  // die automatischen Nummern meiden alle im Code belegten.
  const SETS_ORBIT = /\.(?:o|orbit)\s*\(/;
  const usedOrbits = new Set<number>();
  for (const src of [settings.prelude ?? '', ...emitted.map((e) => e.expr)]) {
    for (const m of src.matchAll(/\.(?:o|orbit|duck)\s*\(\s*"?(\d+)/g)) usedOrbits.add(Number(m[1]));
  }
  const needOrbits =
    emitted.filter((e) => e.usesRoom).length > 1 || emitted.filter((e) => e.usesDelay).length > 1;
  let nextOrbit = 2;
  const takeOrbit = () => {
    while (usedOrbits.has(nextOrbit)) nextOrbit++;
    return nextOrbit++;
  };

  const identifiers = new Set<string>();
  const blocks = emitted.map((e) => {
    const orbit = needOrbits && (e.usesRoom || e.usesDelay) && !SETS_ORBIT.test(e.expr) ? `.orbit(${takeOrbit()})` : '';
    const tail = `${orbit}.gain(${fmtNum(e.volume, 2)})`;
    const arranged = arrangeTrack(e, ast.arrangement, identifiers, report);
    if (arranged) return `// ${e.name}\n${arranged.decl}\n$: ${arranged.expr}${tail}`;
    return `// ${e.name}\n$: ${appendChain(e.expr, tail)}`;
  });

  // Setup-Code (register(…), Konstanten …) vor den Spuren, unverändert
  const prelude = settings.prelude?.trim();
  const head = prelude ? [`setcpm(${fmtNum(bpm)}/4)`, `// Setup\n${prelude}`] : [`setcpm(${fmtNum(bpm)}/4)`];
  return { code: [...head, ...blocks].join('\n\n'), diagnostics };
}

function compileTrack(
  { track, chain }: ResolvedTrack,
  report: (nodeId: string | null, message: string) => void,
): EmittedTrack | null {
  const name = commentText(String(track.params.name ?? '')) || t('compiler.unnamedTrack');
  const active = chain.filter((b) => !b.bypassed);

  const sourceBlock = active.find((b) => isSourceType(b.type));
  if (!sourceBlock) {
    const bypassed = chain.find((b) => isSourceType(b.type) && b.bypassed);
    report(
      track.id,
      bypassed
        ? t('compiler.sourceBypassed', { track: name })
        : t('compiler.noSource', { track: name }),
    );
    return null;
  }

  const ctx: BlockContext = {
    source: sourceInfo(sourceBlock, reader(sourceBlock)),
    stretchDrums: !active.some((b) => DURATION_SENSITIVE.has(b.type)),
  };

  const source = tryEmit(sourceBlock, report, (p) => emitSource(ctx.source.type, p, ctx));
  if (source === null) return null; // Diagnose kommt vom Block selbst

  let expr = source;
  let usesRoom = false;
  let usesDelay = false;
  for (const block of active) {
    if (block === sourceBlock) continue;
    if (isSourceType(block.type)) {
      report(block.id, t('compiler.extraSource', { track: name, block: blockLabel(block.type) }));
      continue;
    }
    const type = block.type as ModifierBlockType | EffectBlockType;
    const code = tryEmit(block, report, (p) => emitChainBlock(type, p, ctx));
    if (code === null) continue;
    expr = appendChain(expr, code); // Kette einzeln anhängen (freier Code kann mit // enden)
    const orbitFx = orbitEffect(block);
    if (orbitFx === 'room') usesRoom = true;
    if (orbitFx === 'delay') usesDelay = true;
  }

  let volume = Number(track.params.volume);
  if (!Number.isFinite(volume)) {
    report(track.id, t('compiler.invalidVolume', { track: name }));
    volume = 0.8;
  }
  volume = Math.min(1, Math.max(0, volume));

  return { trackId: track.id, name, expr, volume, usesRoom, usesDelay };
}

/**
 * Spur im Song-Ablauf: `const kickPart = <Spur>` + `arrange([4, silence], [8, kickPart.lpf(2000)], …)`.
 * Entspricht exakt Strudels `arrange(…stack(…))` des Originals – jeder Abschnitt
 * beginnt die Spur von vorn. Spuren ohne Eintrag im Arrangement spielen durchgehend.
 */
function arrangeTrack(
  e: EmittedTrack,
  arrangement: Arrangement | undefined,
  identifiers: Set<string>,
  report: (nodeId: string | null, message: string) => void,
): { decl: string; expr: string } | null {
  const sections = arrangement?.sections.filter((s) => Number.isFinite(s.cycles) && s.cycles > 0) ?? [];
  const cells = arrangement?.cells[e.trackId];
  if (!arrangement || sections.length === 0 || !cells) return null;
  if (sections.length !== arrangement.sections.length) report(null, t('compiler.invalidSection'));

  const ident = uniqueIdentifier(e.name, identifiers);
  const loop = arrangement.loopSection ? sections.filter((s) => s.id === arrangement.loopSection) : [];
  const startAt = arrangement.startSection ? sections.findIndex((s) => s.id === arrangement.startSection) : -1;
  const ordered = loop.length > 0 ? loop : startAt > 0 ? [...sections.slice(startAt), ...sections.slice(0, startAt)] : sections;
  // Aufeinanderfolgende Pausen zusammenfassen ([4, silence], [8, silence] → [12, silence]) –
  // exakt gleichwertig. Abschnitte mit Klang bleiben getrennt: jeder beginnt die Spur von vorn.
  const entries: { cycles: number; expr: string }[] = [];
  for (const s of ordered) {
    const cell = cells[s.id];
    const last = entries[entries.length - 1];
    if (!cell?.on) {
      if (last?.expr === 'silence') last.cycles += s.cycles;
      else entries.push({ cycles: s.cycles, expr: 'silence' });
      continue;
    }
    const extra = (cell.code ?? '').trim().replace(/;+$/, '');
    entries.push({ cycles: s.cycles, expr: extra === '' ? ident : appendChain(ident, extra.startsWith('.') ? extra : `.${extra}`) });
  }
  const parts = entries.map((e) => `[${fmtNum(e.cycles)}, ${e.expr}]`);
  return { decl: `const ${ident} = ${e.expr}`, expr: `arrange(${parts.join(', ')})` };
}

const RESERVED = new Set(['silence', 'arrange', 'stack', 'cat', 'seq', 'note', 'sound', 'chord', 'n', 's']);

/** Spurname → gültiger, eindeutiger JS-Bezeichner, z. B. „Hi-Hat 2“ → hiHat2Part. */
function uniqueIdentifier(name: string, used: Set<string>): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let base = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  if (base === '' || /^\d/.test(base)) base = `track${base}`;
  base = `${base}Part`;
  let ident = base;
  for (let i = 2; used.has(ident) || RESERVED.has(ident); i++) ident = `${base}${i}`;
  used.add(ident);
  return ident;
}

function reader(block: BlockNode): ParamReader {
  return new ParamReader(block, getBlockDef(block.type));
}

function tryEmit(
  block: BlockNode,
  report: (nodeId: string | null, message: string) => void,
  emit: (p: ParamReader) => string,
): string | null {
  const def = getBlockDef(block.type);
  if (!def) {
    report(block.id, t('compiler.unknownBlock', { type: String(block.type) }));
    return null;
  }
  try {
    return emit(reader(block));
  } catch (err) {
    if (err instanceof ParamError) {
      report(block.id, t('compiler.blockSkipped', { block: blockLabel(block.type), message: err.message }));
      return null;
    }
    throw err;
  }
}
