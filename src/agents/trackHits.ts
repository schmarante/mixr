/**
 * Welche Spur schlägt gerade an? Strudel-Haps tragen keine Spur-ID, aber die Positionen
 * ihrer Mini-Notation im evaluierten Code (`hap.context.locations`). Der Compiler schreibt
 * jede Spur als eigenen, durch Leerzeilen getrennten Block mit `// <Spurname>` davor –
 * darüber lässt sich jede Position einer Spur zuordnen.
 */
import type { TrackHit } from '../store/agentBus';

export interface TrackBlock {
  /** Zeichen-Offset des Blockanfangs im Code. */
  start: number;
  /** Spurname aus dem Kommentar (null: Block ohne Namenskommentar, z. B. setcpm). */
  name: string | null;
}

/** Höchstens so viele Anschläge je Tick (Akkorde, schnelle Hi-Hats …). */
const MAX_HITS = 32;

/** Blöcke (durch Leerzeilen getrennt) mit Startoffset und Namenskommentar der ersten Zeile. */
export function trackBlocksOf(code: string): TrackBlock[] {
  const blocks: TrackBlock[] = [];
  const re = /(?:^|\n[ \t]*\n)([ \t]*)(\S)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const start = m.index + m[0].length - m[1]!.length - 1;
    const lineEnd = code.indexOf('\n', start);
    const firstLine = code.slice(start, lineEnd < 0 ? undefined : lineEnd);
    const comment = /^\s*\/\/\s*(.+?)\s*$/.exec(firstLine);
    blocks.push({ start, name: comment?.[1] ?? null });
  }
  return blocks;
}

/** Spurname zum Offset (letzter Block, der davor beginnt). */
export function blockNameAt(blocks: readonly TrackBlock[], offset: number): string | null {
  let name: string | null = null;
  for (const b of blocks) {
    if (b.start > offset) break;
    name = b.name;
  }
  return name;
}

interface HitHap {
  whole?: { begin: { valueOf(): number } } | null;
  context?: { locations?: Array<{ start: number }> };
  value?: unknown;
}

/** Klang-Merkmale aus dem Hap-Wert übernehmen (nur, was für Frequenz-Schätzungen taugt). */
function describe(name: string, value: unknown): TrackHit {
  const hit: TrackHit = { name };
  if (!value || typeof value !== 'object') return hit;
  const v = value as Record<string, unknown>;
  if (typeof v.freq === 'number' && Number.isFinite(v.freq)) hit.freq = v.freq;
  if (typeof v.note === 'number' || typeof v.note === 'string') hit.note = v.note;
  if (typeof v.n === 'number' && Number.isFinite(v.n)) hit.n = v.n;
  const s = v.s ?? v.sound;
  if (typeof s === 'string') hit.s = s;
  return hit;
}

/**
 * Anschläge (Onsets) im Zyklus-Fenster [from, to) – je Hap einer, mit Spurname und
 * Klang-Merkmalen. Haps ohne zuordenbare Position werden übergangen.
 */
export function trackHitsBetween(
  pattern: { queryArc(begin: number, end: number, controls?: Record<string, unknown>): unknown[] },
  from: number,
  to: number,
  blocks: readonly TrackBlock[],
  controls?: Record<string, unknown>,
): TrackHit[] {
  if (!(to > from) || blocks.length === 0) return [];
  const haps = pattern.queryArc(from, to, controls) as HitHap[];
  const hits: TrackHit[] = [];
  for (const hap of haps) {
    const begin = hap.whole?.begin.valueOf();
    if (begin === undefined || begin < from || begin >= to) continue;
    const loc = hap.context?.locations?.[0];
    if (!loc) continue;
    const name = blockNameAt(blocks, loc.start);
    if (!name) continue;
    hits.push(describe(name, hap.value));
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}
