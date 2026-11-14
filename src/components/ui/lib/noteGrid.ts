import { NOTE_GRID_BARS, type NoteGridValue } from '../../../types/ast';

/**
 * Reine Helfer für den Melodie-Editor (Haltetöne, mehrere Takte).
 * Modell: `cells[col]` = Stufen, die in Spalte `col` BEGINNEN, `lengths[col][k]` = Dauer
 * von `cells[col][k]` in Steps (Default 1). Spalten gesamt = steps × bars.
 * Alle Funktionen sind immutabel und liefern ein normalisiertes Raster.
 */

export interface NormalGrid {
  steps: number;
  bars: number;
  total: number;
  cells: number[][];
  lengths: number[][];
}

export interface GridNote {
  degree: number;
  start: number;
  len: number;
}

export function validBars(v: unknown): number {
  return typeof v === 'number' && (NOTE_GRID_BARS as readonly number[]).includes(v) ? v : 1;
}

/** Bringt jedes (auch altes/importiertes) Raster in eine verlässliche Form. */
export function normalizeGrid(v: NoteGridValue): NormalGrid {
  const steps = Math.max(1, Math.round(v.steps) || 16);
  const bars = validBars(v.bars);
  const total = steps * bars;
  const cells: number[][] = [];
  const lengths: number[][] = [];
  for (let col = 0; col < total; col++) {
    const degs = v.cells[col] ?? [];
    const lens = v.lengths?.[col] ?? [];
    const pairs = degs.map((d, k) => [d, Math.max(1, Math.min(Math.round(lens[k] ?? 1) || 1, total - col))] as const);
    // doppelte Stufen in einer Spalte zusammenfassen (längste gewinnt), aufsteigend sortiert
    const byDeg = new Map<number, number>();
    for (const [d, l] of pairs) byDeg.set(d, Math.max(l, byDeg.get(d) ?? 0));
    const sorted = [...byDeg.keys()].sort((a, b) => a - b);
    cells.push(sorted);
    lengths.push(sorted.map((d) => byDeg.get(d)!));
  }
  return { steps, bars, total, cells, lengths };
}

/** Zurück ins gespeicherte Format – ohne Haltetöne/Takte wie bisher kompakt. */
export function toValue(g: NormalGrid): NoteGridValue {
  const held = g.lengths.some((row) => row.some((l) => l > 1));
  if (!held && g.bars === 1) return { steps: g.steps, cells: g.cells };
  return { steps: g.steps, bars: g.bars, cells: g.cells, lengths: g.lengths };
}

export function gridNotes(g: NormalGrid): GridNote[] {
  const out: GridNote[] = [];
  g.cells.forEach((degs, start) => degs.forEach((degree, k) => out.push({ degree, start, len: g.lengths[start]?.[k] ?? 1 })));
  return out;
}

/** Note (gleiche Stufe), die Spalte `col` belegt – beginnend dort oder davor gehalten. */
export function noteAt(g: NormalGrid, degree: number, col: number): GridNote | null {
  for (let s = col; s >= 0; s--) {
    const k = g.cells[s]?.indexOf(degree) ?? -1;
    if (k >= 0) {
      const len = g.lengths[s]?.[k] ?? 1;
      return s + len > col ? { degree, start: s, len } : null;
    }
  }
  return null;
}

function clone(g: NormalGrid): NormalGrid {
  return { ...g, cells: g.cells.map((c) => [...c]), lengths: g.lengths.map((l) => [...l]) };
}

function put(g: NormalGrid, degree: number, start: number, len: number) {
  const degs = g.cells[start]!;
  const lens = g.lengths[start]!;
  const k = degs.indexOf(degree);
  if (k >= 0) {
    lens[k] = len;
    return;
  }
  let at = degs.findIndex((d) => d > degree);
  if (at < 0) at = degs.length;
  degs.splice(at, 0, degree);
  lens.splice(at, 0, len);
}

/** Erste Startspalte derselben Stufe nach `col` (oder total). */
function nextStart(g: NormalGrid, degree: number, col: number): number {
  for (let s = col + 1; s < g.total; s++) if (g.cells[s]?.includes(degree)) return s;
  return g.total;
}

/**
 * Setzt eine 1-Step-Note (bzw. `len`). Liegt die Spalte im Haltebereich einer Note
 * derselben Stufe, wird diese bis davor gekürzt.
 */
export function addNote(g: NormalGrid, degree: number, col: number, len = 1): NormalGrid {
  if (col < 0 || col >= g.total) return g;
  const next = clone(g);
  const hit = noteAt(next, degree, col);
  if (hit && hit.start === col) return g;
  if (hit) put(next, degree, hit.start, col - hit.start);
  put(next, degree, col, Math.max(1, Math.min(len, nextStart(next, degree, col) - col)));
  return next;
}

export function removeNote(g: NormalGrid, degree: number, start: number): NormalGrid {
  const k = g.cells[start]?.indexOf(degree) ?? -1;
  if (k < 0) return g;
  const next = clone(g);
  next.cells[start]!.splice(k, 1);
  next.lengths[start]!.splice(k, 1);
  return next;
}

/** Größte erlaubte Länge: bis zur nächsten Note derselben Stufe bzw. zum Rasterende. */
export function maxLength(g: NormalGrid, degree: number, start: number): number {
  return nextStart(g, degree, start) - start;
}

export function setNoteLength(g: NormalGrid, degree: number, start: number, len: number): NormalGrid {
  const k = g.cells[start]?.indexOf(degree) ?? -1;
  if (k < 0) return g;
  const clamped = Math.max(1, Math.min(Math.round(len), maxLength(g, degree, start)));
  if (g.lengths[start]![k] === clamped) return g;
  const next = clone(g);
  next.lengths[start]![k] = clamped;
  return next;
}

/** Ändert die Länge in Takten. Neue Takte sind leer; beim Kürzen fallen Noten weg, Haltetöne werden gekappt. */
export function setBars(g: NormalGrid, bars: number): { grid: NormalGrid; removed: number } {
  const b = validBars(bars);
  const total = g.steps * b;
  let removed = 0;
  const cells: number[][] = [];
  const lengths: number[][] = [];
  for (let col = 0; col < Math.max(total, g.total); col++) {
    if (col >= total) {
      removed += g.cells[col]?.length ?? 0;
      continue;
    }
    cells.push([...(g.cells[col] ?? [])]);
    lengths.push((g.lengths[col] ?? []).map((l) => Math.min(l, total - col)));
  }
  return { grid: { steps: g.steps, bars: b, total, cells, lengths }, removed };
}

/** Anzahl Noten, die in Takt `bar` beginnen. */
export function notesInBar(g: NormalGrid, bar: number): number {
  let n = 0;
  for (let col = bar * g.steps; col < (bar + 1) * g.steps; col++) n += g.cells[col]?.length ?? 0;
  return n;
}

/** Füllt alle leeren Takte mit einer Kopie von Takt 1 (Haltetöne bleiben im Takt). */
export function repeatFirstBar(g: NormalGrid): NormalGrid {
  const next = clone(g);
  for (let bar = 1; bar < g.bars; bar++) {
    if (notesInBar(g, bar) > 0) continue;
    for (let s = 0; s < g.steps; s++) {
      const col = bar * g.steps + s;
      next.cells[col] = [...g.cells[s]!];
      next.lengths[col] = g.lengths[s]!.map((l) => Math.min(l, g.steps - s));
    }
  }
  return next;
}

export function clearGrid(g: NormalGrid): NormalGrid {
  return { ...g, cells: g.cells.map(() => []), lengths: g.lengths.map(() => []) };
}

/**
 * Steps pro Schlag für Beat-Markierung und Gruppierung: steps/4, wenn ganzzahlig
 * (16 → 4, 12 → 3, 8 → 2, 4 → 1), sonst keine Unterteilung (ein Block = ganzer Takt).
 */
export function stepsPerBeat(steps: number): number {
  return steps % 4 === 0 ? steps / 4 : steps;
}
