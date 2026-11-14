/**
 * JavaScript-Ebene des Importers: Parsen mit acorn, Methodenketten zerlegen und
 * Quelltext-Ausschnitte (ohne Kommentare, mit gezielten Ersetzungen) erzeugen.
 *
 * Code wird nie neu generiert, sondern aus den Original-Ausschnitten (acorn-Ranges)
 * zusammengesetzt – so bleiben Anführungszeichen erhalten (in Strudel sind "…" und
 * `…` Mini-Notation, '…' normale Strings).
 */
import { parse, type Comment } from 'acorn';

/* ------------------------------------------------------------------ */
/* Minimale ESTree-Typen (nur was der Importer liest)                  */
/* ------------------------------------------------------------------ */

export interface JsNode {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } };
}

export interface Ident extends JsNode {
  type: 'Identifier';
  name: string;
}
export interface Lit extends JsNode {
  type: 'Literal';
  value: unknown;
  raw: string;
}
export interface TemplateLit extends JsNode {
  type: 'TemplateLiteral';
  expressions: JsNode[];
  quasis: Array<JsNode & { value: { raw: string; cooked: string | null } }>;
}
export interface CallExpr extends JsNode {
  type: 'CallExpression';
  callee: JsNode;
  arguments: JsNode[];
}
export interface MemberExpr extends JsNode {
  type: 'MemberExpression';
  object: JsNode;
  property: JsNode;
  computed: boolean;
}
export interface FunctionLike extends JsNode {
  type: 'ArrowFunctionExpression' | 'FunctionExpression' | 'FunctionDeclaration';
  params: JsNode[];
  body: JsNode;
  id?: Ident | null;
}
export interface Program extends JsNode {
  type: 'Program';
  body: JsNode[];
}

export const isIdent = (n: JsNode | null | undefined): n is Ident => n?.type === 'Identifier';
export const isCall = (n: JsNode | null | undefined): n is CallExpr => n?.type === 'CallExpression';
export const isMember = (n: JsNode | null | undefined): n is MemberExpr => n?.type === 'MemberExpression';
export const isLit = (n: JsNode | null | undefined): n is Lit => n?.type === 'Literal';
export const isTemplate = (n: JsNode | null | undefined): n is TemplateLit => n?.type === 'TemplateLiteral';
export const isFunction = (n: JsNode | null | undefined): n is FunctionLike =>
  n?.type === 'ArrowFunctionExpression' || n?.type === 'FunctionExpression' || n?.type === 'FunctionDeclaration';

/** Eigenschaft eines Knotens lesen (ESTree-Felder ohne eigene Typen). */
export function field<T = unknown>(node: JsNode, key: string): T {
  return (node as unknown as Record<string, T>)[key] as T;
}

/* ------------------------------------------------------------------ */
/* Parsen                                                              */
/* ------------------------------------------------------------------ */

export interface ParsedSource {
  code: string;
  program: Program;
  comments: Comment[];
}

export class SyntaxProblem extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
  }
}

export function parseSource(code: string): ParsedSource {
  const comments: Comment[] = [];
  try {
    const program = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      locations: true,
      onComment: comments,
    }) as unknown as Program;
    return { code, program, comments };
  } catch (err) {
    const loc = (err as { loc?: { line: number; column: number } }).loc;
    const message = err instanceof Error ? err.message.replace(/\s*\(\d+:\d+\)$/, '') : String(err);
    throw new SyntaxProblem(message, loc?.line ?? 1, (loc?.column ?? 0) + 1);
  }
}

/** Direkte Kindknoten (in Quelltext-Reihenfolge). */
export function children(node: JsNode): JsNode[] {
  const out: JsNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (isNode(v)) out.push(v);
    } else if (isNode(value)) out.push(value);
  }
  return out.sort((a, b) => a.start - b.start);
}

function isNode(v: unknown): v is JsNode {
  return typeof v === 'object' && v !== null && typeof (v as JsNode).type === 'string' && typeof (v as JsNode).start === 'number';
}

/** Tiefensuche über alle Knoten (mit Elternknoten). */
export function walk(node: JsNode, visit: (node: JsNode, parent: JsNode | null) => void, parent: JsNode | null = null): void {
  visit(node, parent);
  for (const c of children(node)) walk(c, visit, node);
}

/* ------------------------------------------------------------------ */
/* Methodenketten                                                      */
/* ------------------------------------------------------------------ */

export interface Method {
  name: string;
  /** Aufruf `.name(…)`; `null` bei reinem Eigenschaftszugriff (`.add` in `.add.squeeze(…)`). */
  call: CallExpr | null;
  member: MemberExpr;
  args: JsNode[];
  /** Quelltextbereich „.name(…)“ (ab Ende des Objekts davor). */
  start: number;
  end: number;
}

export interface Chain {
  root: JsNode;
  methods: Method[];
}

/** Zerlegt `a(…).b(…).c` in Wurzel `a(…)` und Methoden [b, c]. */
export function flattenChain(expr: JsNode): Chain {
  const methods: Method[] = [];
  let cur = expr;
  for (;;) {
    if (isCall(cur) && isMember(cur.callee) && !cur.callee.computed && isIdent(cur.callee.property)) {
      const member = cur.callee;
      methods.unshift({ name: (member.property as Ident).name, call: cur, member, args: cur.arguments, start: member.object.end, end: cur.end });
      cur = member.object;
      continue;
    }
    if (isMember(cur) && !cur.computed && isIdent(cur.property)) {
      methods.unshift({ name: cur.property.name, call: null, member: cur, args: [], start: cur.object.end, end: cur.end });
      cur = cur.object;
      continue;
    }
    break;
  }
  return { root: cur, methods };
}

/** Name der aufgerufenen Funktion bei `name(…)`, sonst null. */
export function calleeName(node: JsNode): string | null {
  return isCall(node) && isIdent(node.callee) ? node.callee.name : null;
}

/** String-Wert eines Literals ('…', "…" oder `…` ohne Platzhalter), sonst null. */
export function stringValue(node: JsNode | undefined): string | null {
  if (isLit(node) && typeof node.value === 'string') return node.value;
  if (isTemplate(node) && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
  return null;
}

/** Ist der String Mini-Notation im Sinne des Transpilers ("…" oder `…`)? */
export function quoteOf(node: JsNode, code: string): '"' | "'" | '`' {
  const c = code[node.start];
  return c === "'" ? "'" : c === '`' ? '`' : '"';
}

/* ------------------------------------------------------------------ */
/* Konstante Zahlen                                                    */
/* ------------------------------------------------------------------ */

/**
 * Wertet konstante Zahlenausdrücke aus (`120/4`, `-0.5`, `slider(3000, 0, 5000)`,
 * Verweise auf numerische Konstanten). Sonst `null`.
 */
export function evalNumber(node: JsNode | undefined, consts: ReadonlyMap<string, number> = new Map()): number | null {
  if (!node) return null;
  if (isLit(node)) return typeof node.value === 'number' ? node.value : null;
  if (isIdent(node)) return consts.get(node.name) ?? null;
  if (node.type === 'UnaryExpression') {
    const v = evalNumber(field<JsNode>(node, 'argument'), consts);
    const op = field<string>(node, 'operator');
    if (v === null) return null;
    return op === '-' ? -v : op === '+' ? v : null;
  }
  if (node.type === 'BinaryExpression') {
    const a = evalNumber(field<JsNode>(node, 'left'), consts);
    const b = evalNumber(field<JsNode>(node, 'right'), consts);
    if (a === null || b === null) return null;
    const r = BINARY[field<string>(node, 'operator')]?.(a, b);
    return r === undefined || !Number.isFinite(r) ? null : r;
  }
  if (isCall(node) && isIdent(node.callee) && node.callee.name === 'slider') return evalNumber(node.arguments[0], consts);
  return null;
}

const BINARY: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '**': (a, b) => a ** b,
};

/* ------------------------------------------------------------------ */
/* Quelltext ausgeben                                                  */
/* ------------------------------------------------------------------ */

/**
 * Setzt Quelltext aus Original-Ausschnitten zusammen. `hook` darf für einzelne
 * Knoten einen Ersatztext liefern (rekursiv über `print`). Kommentare werden
 * entfernt, entstehende Leerzeilen zusammengezogen.
 */
export class Printer {
  /** Namen, die in der aktuellen Funktion als Parameter verdeckt sind. */
  readonly shadowed: string[][] = [];

  constructor(
    readonly src: ParsedSource,
    private readonly hook: (node: JsNode, printer: Printer, parent: JsNode | null) => string | undefined,
  ) {}

  isShadowed(name: string): boolean {
    return this.shadowed.some((s) => s.includes(name));
  }

  print(node: JsNode, parent: JsNode | null = null): string {
    const replaced = this.hook(node, this, parent);
    if (replaced !== undefined) return replaced;
    if (isFunction(node)) {
      const names: string[] = [];
      for (const p of node.params) walk(p, (n) => isIdent(n) && names.push(n.name));
      this.shadowed.push(names);
      try {
        return this.range(node.start, node.end, children(node), node);
      } finally {
        this.shadowed.pop();
      }
    }
    if (isLit(node)) return node.raw;
    if (isTemplate(node)) return this.range(node.start, node.end, node.expressions, node, true);
    if (isIdent(node)) return node.name;
    if (isMember(node) && !node.computed) return this.range(node.start, node.end, [node.object], node);
    if (node.type === 'Property' && !field<boolean>(node, 'computed')) {
      if (field<boolean>(node, 'shorthand')) {
        const value = field<JsNode>(node, 'value');
        const text = this.print(value, node);
        return isIdent(value) && text !== value.name ? `${value.name}: ${text}` : text;
      }
      return this.range(node.start, node.end, [field<JsNode>(node, 'value')], node);
    }
    return this.range(node.start, node.end, children(node), node);
  }

  /** Bereich [start, end) mit den gegebenen Kindknoten (der Rest ist „Lücke“). */
  range(start: number, end: number, kids: JsNode[], parent: JsNode | null, raw = false): string {
    let out = '';
    let pos = start;
    for (const kid of [...kids].sort((a, b) => a.start - b.start)) {
      if (kid.start < pos || kid.end > end) continue;
      out += raw ? this.src.code.slice(pos, kid.start) : this.gap(pos, kid.start);
      out += this.print(kid, parent);
      pos = kid.end;
    }
    out += raw ? this.src.code.slice(pos, end) : this.gap(pos, end);
    return out;
  }

  /** Quelltext zwischen Knoten: ohne Kommentare, ohne Leerzeilen. */
  gap(start: number, end: number): string {
    let text = '';
    let pos = start;
    for (const c of this.src.comments) {
      if (c.end <= start || c.start >= end) continue;
      text += this.src.code.slice(pos, Math.max(pos, c.start));
      pos = Math.min(end, c.end);
      if (c.type === 'Block') text += ' ';
    }
    text += this.src.code.slice(pos, end);
    return text.replace(/[ \t]+(?=\n)/g, '').replace(/\n{2,}/g, '\n');
  }
}

/** Entfernt gemeinsame Einrückung ab der zweiten Zeile und überflüssigen Leerraum. */
export function tidy(text: string): string {
  const lines = text.trim().split('\n');
  if (lines.length === 1) return lines[0]!.trim();
  const rest = lines.slice(1).filter((l) => l.trim() !== '');
  const indent = Math.min(...rest.map((l) => /^[ \t]*/.exec(l)![0].length));
  return [lines[0]!.trimEnd(), ...lines.slice(1).map((l) => l.slice(Math.min(indent, /^[ \t]*/.exec(l)![0].length)).trimEnd())]
    .filter((l) => l.trim() !== '')
    .join('\n');
}

/** Methoden-Ausschnitt „.name(…)“ ohne führenden Leerraum/Zeilenumbruch. */
export function tidyMethod(text: string): string {
  return tidy(text.replace(/^\s*\.\s*/, '.'));
}
