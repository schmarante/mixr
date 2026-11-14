/**
 * Event-Abfrage für Mini-Notation – ohne @strudel/core.
 *
 * Warum nicht einfach @strudel/core + @strudel/mini? @strudel/core lässt sich in
 * reinem Node (SSR) nicht importieren (Abhängigkeit @kabelsalat/web), der Importer
 * muss aber SSR-sicher und synchron sein. Deshalb nutzen wir nur den echten
 * Strudel-Parser (krill, Peggy-generiert, ohne Abhängigkeiten) und werten dessen
 * AST mit einem kleinen, exakten Nachbau der benötigten Pattern-Operationen aus
 * (Logik 1:1 nach @strudel/mini/mini.mjs + @strudel/core/pattern.mjs).
 *
 * Unterstützt: Folgen, Gewichte (@, _), Pausen (~, -), [ ], Stapel (,), < >,
 * { } (Polymeter), *, /, !, Euklid (a(3,8,2)), a:b und Füße (.).
 * Nicht unterstützt (→ `null`, Aufrufer behält dann Code): Zufall (?, |),
 * Bereiche (..) und gemusterte Argumente (z. B. bd*<2 3>).
 *
 * Die Übereinstimmung mit echtem Strudel prüfen die Tests (importerMini.test.ts).
 */
import { parse as krillParse } from '@strudel/mini/krill-parser.js';

/* ------------------------------------------------------------------ */
/* Exakte Brüche                                                       */
/* ------------------------------------------------------------------ */

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export class Frac {
  readonly n: number;
  readonly d: number;
  constructor(n: number, d = 1) {
    if (d < 0) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  static of(x: number | Frac): Frac {
    if (x instanceof Frac) return x;
    if (Number.isInteger(x)) return new Frac(x);
    // Dezimalzahlen aus Mini-Notation („1.5“, „0.25“) exakt übernehmen.
    let d = 1;
    while (!Number.isInteger(x * d) && d < 1e9) d *= 10;
    return new Frac(Math.round(x * d), d);
  }
  add(o: Frac): Frac {
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Frac): Frac {
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Frac): Frac {
    return new Frac(this.n * o.n, this.d * o.d);
  }
  div(o: Frac): Frac {
    return new Frac(this.n * o.d, this.d * o.n);
  }
  floor(): Frac {
    return new Frac(Math.floor(this.n / this.d));
  }
  cmp(o: Frac): number {
    return this.n * o.d - o.n * this.d;
  }
  lt(o: Frac): boolean {
    return this.cmp(o) < 0;
  }
  eq(o: Frac): boolean {
    return this.cmp(o) === 0;
  }
  min(o: Frac): Frac {
    return this.cmp(o) <= 0 ? this : o;
  }
  max(o: Frac): Frac {
    return this.cmp(o) >= 0 ? this : o;
  }
  valueOf(): number {
    return this.n / this.d;
  }
}

const ZERO = new Frac(0);
const ONE = new Frac(1);

/* ------------------------------------------------------------------ */
/* Minimaler Pattern-Kern                                              */
/* ------------------------------------------------------------------ */

interface Hap {
  wb: Frac;
  we: Frac;
  pb: Frac;
  pe: Frac;
  value: unknown;
}

type Query = (b: Frac, e: Frac) => Hap[];

interface Pat {
  query: Query;
  /** Gesetzt, wenn das Pattern ein einzelner fester Wert ist (für Euklid). */
  atom?: { value: unknown };
  /** Gewicht in der umgebenden Folge (mini.mjs: __weight). */
  weight?: Frac;
}

class Unsupported extends Error {}

const silence: Pat = { query: () => [] };

function cycles(b: Frac, e: Frac): Array<[Frac, Frac]> {
  const out: Array<[Frac, Frac]> = [];
  let c = b.floor();
  while (c.lt(e)) {
    const sb = b.max(c);
    const se = e.min(c.add(ONE));
    if (sb.lt(se)) out.push([sb, se]);
    c = c.add(ONE);
  }
  return out;
}

function splitQueries(q: Query): Query {
  return (b, e) => cycles(b, e).flatMap(([sb, se]) => q(sb, se));
}

function mapTime(h: Hap, f: (t: Frac) => Frac): Hap {
  return { wb: f(h.wb), we: f(h.we), pb: f(h.pb), pe: f(h.pe), value: h.value };
}

function pure(value: unknown): Pat {
  return {
    atom: { value },
    query: splitQueries((b, e) => {
      const c = b.floor();
      return [{ wb: c, we: c.add(ONE), pb: b, pe: e, value }];
    }),
  };
}

function fast(p: Pat, k: Frac): Pat {
  if (k.cmp(ZERO) < 0) throw new Unsupported('negative fast');
  if (k.eq(ZERO)) return silence;
  return { query: (b, e) => p.query(b.mul(k), e.mul(k)).map((h) => mapTime(h, (t) => t.div(k))) };
}

function late(p: Pat, t: Frac): Pat {
  return { query: (b, e) => p.query(b.sub(t), e.sub(t)).map((h) => mapTime(h, (x) => x.add(t))) };
}

function stack(ps: Pat[]): Pat {
  return { query: (b, e) => ps.flatMap((p) => p.query(b, e)) };
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function slowcat(ps: Pat[]): Pat {
  if (ps.length === 1) return ps[0]!;
  const n = new Frac(ps.length);
  return {
    query: splitQueries((b, e) => {
      const c = b.floor();
      const p = ps[mod(c.valueOf(), ps.length)]!;
      const offset = c.sub(b.div(n).floor());
      return p.query(b.sub(offset), e.sub(offset)).map((h) => mapTime(h, (t) => t.add(offset)));
    }),
  };
}

function fastcat(ps: Pat[]): Pat {
  const cat = slowcat(ps);
  return ps.length > 1 ? fast(cat, new Frac(ps.length)) : cat;
}

function fastGap(p: Pat, factor: Frac): Pat {
  return {
    query: splitQueries((b, e) => {
      const c = b.floor();
      const bpos = b.sub(c).mul(factor).min(ONE);
      const epos = e.sub(c).mul(factor).min(ONE);
      if (!bpos.lt(ONE) || !bpos.lt(epos)) return [];
      return p.query(c.add(bpos), c.add(epos)).map((h) => {
        const cyc = h.pb.floor();
        const beginPos = h.pb.sub(cyc).div(factor).min(ONE);
        const endPos = h.pe.sub(cyc).div(factor).min(ONE);
        const pb = cyc.add(beginPos);
        const pe = cyc.add(endPos);
        return {
          wb: pb.sub(h.pb.sub(h.wb).div(factor)),
          we: pe.add(h.we.sub(h.pe).div(factor)),
          pb,
          pe,
          value: h.value,
        };
      });
    }),
  };
}

function compress(p: Pat, b: Frac, e: Frac): Pat {
  if (e.lt(b) || ONE.lt(b) || ONE.lt(e) || b.lt(ZERO) || e.lt(ZERO) || b.eq(e)) return silence;
  return late(fastGap(p, ONE.div(e.sub(b))), b);
}

function timecat(parts: Array<[Frac, Pat]>): Pat {
  if (parts.length === 1) return parts[0]![1];
  const total = parts.reduce((s, [w]) => s.add(w), ZERO);
  let begin = ZERO;
  const ps: Pat[] = [];
  for (const [w, p] of parts) {
    if (w.eq(ZERO)) continue;
    const end = begin.add(w);
    ps.push(compress(p, begin.div(total), end.div(total)));
    begin = end;
  }
  return stack(ps);
}

function repeatCycles(p: Pat, n: Frac): Pat {
  return {
    query: splitQueries((b, e) => {
      const c = b.floor();
      const delta = c.sub(c.div(n).floor());
      return p.query(b.sub(delta), e.sub(delta)).map((h) => mapTime(h, (t) => t.add(delta)));
    }),
  };
}

function mapValues(p: Pat, f: (v: unknown) => unknown): Pat {
  return { query: (b, e) => p.query(b, e).map((h) => ({ ...h, value: f(h.value) })) };
}

/* Bjorklund – Port von @strudel/core/euclid.mjs (gleiche Rotation/Ausrichtung). */
type Seqs = [number[][], number[][]];
function bjorklundRec(n: [number, number], x: Seqs): [[number, number], Seqs] {
  const [ons, offs] = n;
  if (Math.min(ons, offs) <= 1) return [n, x];
  const [xs, ys] = x;
  if (ons > offs) {
    const head = xs.slice(0, offs);
    const rest = xs.slice(offs);
    return bjorklundRec([offs, ons - offs], [head.map((a, i) => a.concat(ys[i]!)), rest]);
  }
  const head = ys.slice(0, ons);
  const rest = ys.slice(ons);
  return bjorklundRec([ons, offs - ons], [xs.map((a, i) => a.concat(head[i]!)), rest]);
}

export function bjorklund(ons: number, steps: number): number[] {
  const inverted = ons < 0;
  const absOns = Math.abs(ons);
  const offs = steps - absOns;
  const [, [a, b]] = bjorklundRec(
    [absOns, offs],
    [Array.from({ length: absOns }, () => [1]), Array.from({ length: Math.max(0, offs) }, () => [0])],
  );
  const pattern = [...a.flat(), ...b.flat()];
  return inverted ? pattern.map((v) => 1 - v) : pattern;
}

function euclid(p: Pat, pulses: number, steps: number, rotation: number): Pat {
  if (!p.atom) throw new Unsupported('euclid on non-atom');
  let bits = bjorklund(pulses, steps);
  if (rotation) bits = [...bits.slice(-rotation), ...bits.slice(0, -rotation)];
  const value = p.atom.value;
  return fastcat(bits.map((bit) => (bit ? pure(value) : silence)));
}

/* ------------------------------------------------------------------ */
/* Krill-AST → Pattern                                                 */
/* ------------------------------------------------------------------ */

type Node = Record<string, unknown>;

function obj(v: unknown): Node {
  if (typeof v !== 'object' || v === null) throw new Unsupported('bad ast');
  return v as Node;
}

function arr(v: unknown): Node[] {
  if (!Array.isArray(v)) throw new Unsupported('bad ast');
  return v.map(obj);
}

/** Zahl aus einem Atom-Knoten (für *, /, !, Euklid). Gemusterte Werte → Unsupported. */
function numberArg(v: unknown): Frac {
  if (typeof v === 'number') return Frac.of(v);
  const node = obj(v);
  // Ein Element/eine Folge mit genau einem Atom („[3]“) ist ebenfalls eine Zahl.
  if (node['type_'] === 'element') return numberArg(node['source_']);
  if (node['type_'] === 'pattern') {
    const src = arr(node['source_']);
    const opts = obj(src[0] ?? {})['options_'];
    if (src.length === 1 && (!opts || arr(obj(opts)['ops'] ?? []).length === 0)) return numberArg(src[0]);
  }
  if (node['type_'] !== 'atom') throw new Unsupported('patterned argument');
  const n = Number(node['source_']);
  if (!Number.isFinite(n)) throw new Unsupported('not a number');
  return Frac.of(n);
}

function intArg(v: unknown): number {
  const f = numberArg(v);
  if (f.d !== 1) throw new Unsupported('not an integer');
  return f.n;
}

function applyOptions(pat: Pat, options: unknown): Pat {
  if (!options) return pat;
  const ops = arr(obj(options)['ops'] ?? []);
  for (const op of ops) {
    const args = obj(op['arguments_'] ?? {});
    switch (op['type_']) {
      case 'stretch': {
        const amount = numberArg(args['amount']);
        if (args['type'] === 'fast') pat = fast(pat, amount);
        else if (args['type'] === 'slow') pat = amount.eq(ZERO) ? silence : fast(pat, ONE.div(amount));
        else throw new Unsupported('stretch');
        break;
      }
      case 'replicate': {
        const amount = numberArg(args['amount']);
        pat = fast(repeatCycles(pat, amount), amount);
        break;
      }
      case 'bjorklund': {
        const rotation = args['rotation'] ? intArg(args['rotation']) : 0;
        pat = euclid(pat, intArg(args['pulse']), intArg(args['step']), rotation);
        break;
      }
      case 'tail': {
        const friend = enter(obj(args['element']));
        if (!friend.atom) throw new Unsupported('patterned tail');
        const b = friend.atom.value;
        pat = mapValues(pat, (a) => (Array.isArray(a) ? [...(a as unknown[]), b] : [a, b]));
        break;
      }
      default:
        // degradeBy (?), range (..) und Unbekanntes: zufällig bzw. nicht nachgebaut.
        throw new Unsupported(String(op['type_']));
    }
  }
  return pat;
}

function enter(node: Node): Pat {
  switch (node['type_']) {
    case 'element':
      return enter(obj(node['source_']));
    case 'atom': {
      const src = node['source_'];
      if (src === '~' || src === '-') return silence;
      const value = typeof src === 'string' && src.trim() !== '' && !isNaN(Number(src)) ? Number(src) : src;
      return pure(value);
    }
    case 'stretch': {
      const amount = numberArg(obj(node['arguments_'])['amount']);
      return amount.eq(ZERO) ? silence : fast(enter(obj(node['source_'])), ONE.div(amount));
    }
    case 'pattern':
      return enterPattern(node);
    default:
      throw new Unsupported(String(node['type_']));
  }
}

function enterPattern(node: Node): Pat {
  const source = arr(node['source_']);
  const children = source.map((child) => applyOptions(enter(child), child['options_']));
  const args = obj(node['arguments_'] ?? {});
  switch (args['alignment']) {
    case 'stack':
      return stack(children);
    case 'polymeter_slowcat':
      return stack(children.map((c) => fast(c, ONE.div(c.weight ?? ONE))));
    case 'polymeter': {
      const steps = args['stepsPerCycle'] ? numberArg(args['stepsPerCycle']) : (children[0]?.weight ?? ONE);
      return stack(children.map((c) => fast(c, steps.div(c.weight ?? ONE))));
    }
    case 'feet':
      return fastcat(children);
    case 'rand':
      throw new Unsupported('rand');
    default: {
      const weighted = source.some((c) => !!obj(c['options_'] ?? {})['weight']);
      if (!weighted) return fastcat(children);
      const weights = source.map((c) => {
        const w = obj(c['options_'] ?? {})['weight'];
        return typeof w === 'number' && w ? Frac.of(w) : ONE;
      });
      const pat = timecat(children.map((c, i) => [weights[i]!, c]));
      return { query: pat.query, ...(pat.atom ? { atom: pat.atom } : {}), weight: weights.reduce((s, w) => s.add(w), ZERO) };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

/** Ein Event innerhalb eines Zyklus (Zeiten relativ zum Zyklusanfang, exakt). */
export interface MiniEvent {
  begin: Frac;
  end: Frac;
  value: unknown;
}

/** Parst Mini-Notation (ohne Anführungszeichen). `null` = nicht parsbar. */
export function parseMini(text: string): unknown | null {
  try {
    return krillParse(`"${text}"`);
  } catch {
    return null;
  }
}

/**
 * Fragt die Events (nur Onsets) der Zyklen 0 … count-1 ab.
 * `null`, wenn die Notation nicht parsbar ist oder Unterstütztes verlässt.
 */
export function miniCycles(text: string, count: number): MiniEvent[][] | null {
  const pat = miniPattern(text);
  return pat && queryCycles(pat, count);
}

/** Ein Atom (Wort/Zahl) der Notation mit Position im Text (ohne Anführungszeichen). */
export interface MiniAtom {
  source: string;
  start: number;
  end: number;
}

/** Alle Atome der Notation – für die Klang-Ersetzung. `null` = nicht parsbar. */
export function miniAtoms(text: string): MiniAtom[] | null {
  const ast = parseMini(text);
  if (ast === null) return null;
  const atoms: MiniAtom[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) {
      const node = v as Node;
      if (node['type_'] === 'atom' && typeof node['source_'] === 'string') {
        const loc = node['location_'] as { start?: { offset?: number }; end?: { offset?: number } } | undefined;
        const from = (loc?.start?.offset ?? 1) - 1;
        const to = (loc?.end?.offset ?? 1) - 1;
        const idx = text.slice(from, to).indexOf(node['source_']);
        if (idx >= 0) atoms.push({ source: node['source_'], start: from + idx, end: from + idx + node['source_'].length });
      } else Object.values(node).forEach(walk);
    }
  };
  walk(ast);
  // Doppelte (z. B. durch geteilte Knoten) entfernen.
  const seen = new Set<number>();
  return atoms.filter((a) => (seen.has(a.start) ? false : (seen.add(a.start), true)));
}

/* ------------------------------------------------------------------ */
/* Zusammengesetzte Muster (cat/seq/stack aus Mini-Notation)            */
/* ------------------------------------------------------------------ */

/** Undurchsichtiges Muster für die Kombination mehrerer Mini-Notationen. */
export type MiniPattern = Pat;

/** Mini-Notation → Muster; null = nicht parsbar/unterstützt. */
export function miniPattern(text: string): MiniPattern | null {
  const ast = parseMini(text);
  if (ast === null) return null;
  try {
    return enter(obj(ast));
  } catch (err) {
    if (err instanceof Unsupported || err instanceof RangeError) return null;
    throw err;
  }
}

/** Strudels `cat`/`slowcat` (ein Muster pro Takt). */
export const catPatterns = (ps: MiniPattern[]): MiniPattern => slowcat(ps);
/** Strudels `seq`/`fastcat` (alle in einem Takt). */
export const seqPatterns = (ps: MiniPattern[]): MiniPattern => fastcat(ps);
/** Strudels `stack`. */
export const stackPatterns = (ps: MiniPattern[]): MiniPattern => stack(ps);

/** Onsets der Zyklen 0 … count-1 (Zeiten relativ zum Zyklusanfang). */
export function queryCycles(pat: MiniPattern, count: number): MiniEvent[][] | null {
  try {
    const out: MiniEvent[][] = [];
    for (let c = 0; c < count; c++) {
      const cyc = new Frac(c);
      out.push(
        pat
          .query(cyc, cyc.add(ONE))
          .filter((h) => h.pb.eq(h.wb))
          .map((h) => ({ begin: h.wb.sub(cyc), end: h.we.sub(cyc), value: h.value }))
          .sort((a, b) => a.begin.cmp(b.begin) || String(a.value).localeCompare(String(b.value))),
      );
    }
    return out;
  } catch (err) {
    if (err instanceof Unsupported || err instanceof RangeError) return null;
    throw err;
  }
}
