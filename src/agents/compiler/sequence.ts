/**
 * Kompakte Mini-Notation für Step-Sequenzen (Drum- und Noten-Raster).
 *
 * Zwei Kompressionsstufen:
 *  1. Periodenfaltung (immer erlaubt, exakt äquivalent – gleiche Onsets UND
 *     gleiche Dauern): "~ hh ~ hh ~ hh ~ hh" → "[~ hh]*4".
 *  2. Ausdünnen (`stretch`): Liegen alle Treffer auf jedem d-ten Step, wird das
 *     Raster um Faktor d vergröbert: "bd ~ ~ ~ bd ~ ~ ~ …" → "bd bd bd bd" → "bd*4".
 *     Das erhält alle Onsets, verlängert aber die Event-Dauer. Für Samples ohne
 *     Hüllkurve/`clip` ist das klanglich identisch (superdough spielt das Sample
 *     dann in voller Länge, unabhängig von der Hap-Dauer). Der Compiler schaltet
 *     es deshalb ab, sobald eine Spur Hüllkurve oder freien Code enthält.
 */

const REST = '~';

function divisors(n: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= n; d++) if (n % d === 0) out.push(d);
  return out;
}

/** Größter Teiler d von n, sodass alle Nicht-Pausen auf Vielfachen von d liegen. */
function stretchFactor(tokens: string[]): number {
  const n = tokens.length;
  const ds = divisors(n).reverse();
  for (const d of ds) {
    if (tokens.every((t, i) => t === REST || i % d === 0)) return d;
  }
  return 1;
}

/** Kleinste Periode p (Teiler von n, p < n), mit der sich die Folge exakt wiederholt. */
function minimalPeriod(tokens: string[]): number {
  const n = tokens.length;
  for (const p of divisors(n)) {
    if (p === n) break;
    if (tokens.every((t, i) => t === tokens[i % p])) return p;
  }
  return n;
}

export interface SequenceOptions {
  /** Ausdünnen erlauben (ändert Event-Dauern, nicht Onsets). */
  stretch: boolean;
}

/**
 * Formatiert eine Folge von Mini-Notation-Tokens (`~` = Pause) möglichst lesbar.
 * Die Wiederholungsform wird nur gewählt, wenn sie spürbar kürzer ist.
 */
export function compressSequence(input: string[], { stretch }: SequenceOptions): string {
  let tokens = input;
  if (tokens.length === 0) return REST;
  if (stretch) {
    const d = stretchFactor(tokens);
    if (d > 1) tokens = tokens.filter((_, i) => i % d === 0);
  }
  const plain = tokens.join(' ');
  const p = minimalPeriod(tokens);
  if (p === tokens.length) return plain;
  const reps = tokens.length / p;
  const unit = tokens.slice(0, p);
  const repeated = p === 1 ? `${unit[0]}*${reps}` : `[${unit.join(' ')}]*${reps}`;
  // Klammern sind für Einsteiger eine Hürde → kleiner Malus.
  const cost = repeated.length + (p === 1 ? 0 : 2);
  return cost < plain.length ? repeated : plain;
}

/** Drum-Zeile → Mini-Notation, z. B. ([x,_,_,_]*4, "bd") → "bd*4". */
export function drumRow(name: string, hits: boolean[], opts: SequenceOptions): string {
  return compressSequence(
    hits.map((h) => (h ? name : REST)),
    opts,
  );
}

/**
 * Noten-Raster mit Haltetönen → Mini-Notation mit Gewichten („@“).
 * Noten werden auf monophone Stimmen verteilt (Akkorde mit gleichem Start und
 * gleicher Dauer bleiben zusammen) und per Komma gestapelt:
 *   Stufe 0 über 4 Steps, Pause, Akkord über 2 → "0@4 ~ [0,2,4]@2"
 * `total` = Spalten gesamt; jede Stimme füllt genau `total` Steps.
 */
export function heldNoteSequence(cells: number[][], lengths: number[][], total: number): string {
  // Gruppen: gleiche Startspalte + gleiche Dauer = ein Akkord-Token
  const groups: { start: number; len: number; degrees: number[] }[] = [];
  cells.forEach((cell, start) => {
    const byLen = new Map<number, number[]>();
    cell.forEach((deg, k) => {
      const len = Math.max(1, Math.min(lengths[start]?.[k] ?? 1, total - start));
      byLen.set(len, [...(byLen.get(len) ?? []), deg]);
    });
    for (const [len, degrees] of [...byLen].sort((a, b) => b[0] - a[0])) groups.push({ start, len, degrees });
  });
  // Greedy auf Stimmen verteilen: erste Stimme, die zum Startzeitpunkt frei ist
  const voices: { end: number; items: { start: number; len: number; degrees: number[] }[] }[] = [];
  for (const g of groups) {
    let voice = voices.find((v) => v.end <= g.start);
    if (!voice) {
      voice = { end: 0, items: [] };
      voices.push(voice);
    }
    voice.items.push(g);
    voice.end = g.start + g.len;
  }
  const weighted = (token: string, w: number) => (w === 1 ? token : `${token}@${w}`);
  const voiceStrings = voices.map((v) => {
    const parts: string[] = [];
    let pos = 0;
    for (const it of v.items) {
      if (it.start > pos) parts.push(weighted(REST, it.start - pos));
      parts.push(weighted(noteToken([...it.degrees].sort((a, b) => a - b)), it.len));
      pos = it.start + it.len;
    }
    if (pos < total) parts.push(weighted(REST, total - pos));
    return parts.join(' ');
  });
  return voiceStrings.length > 0 ? voiceStrings.join(', ') : weighted(REST, total);
}

/** Noten-Raster-Zelle → Token: [] → "~", [3] → "3", [0,2,4] → "[0,2,4]". */
export function noteToken(cell: number[]): string {
  if (cell.length === 0) return REST;
  if (cell.length === 1) return String(cell[0]);
  return `[${cell.join(',')}]`;
}
