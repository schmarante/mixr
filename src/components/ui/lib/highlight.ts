/**
 * Leichtgewichtiges Syntax-Highlighting für Strudel-Code (JS + Mini-Notation in Strings).
 * Liefert Token-Zeilen – das Rendering passiert in React (kein innerHTML).
 */

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'mini'
  | 'number'
  | 'method'
  | 'fn'
  | 'keyword'
  | 'label'
  | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set(['const', 'let', 'var', 'return', 'true', 'false', 'null', 'undefined', 'await', 'new', 'function']);

const RE = {
  ws: /\s+/y,
  comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
  string: /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?/y,
  number: /(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/y,
  ident: /[A-Za-z_$][\w$]*/y,
  label: /\$:|[A-Za-z_]\w*:(?=\s)/y,
  arrow: /=>/y,
};

function match(re: RegExp, src: string, pos: number): string | null {
  re.lastIndex = pos;
  const m = re.exec(src);
  return m && m.index === pos ? m[0] : null;
}

/** Zerlegt einen String-Inhalt (Mini-Notation) in feinere Tokens. */
function miniTokens(text: string): Token[] {
  const quote = text[0] ?? '';
  const closed = text.length > 1 && text[text.length - 1] === quote;
  const inner = text.slice(1, closed ? -1 : undefined);
  const out: Token[] = [{ kind: 'string', text: quote }];
  const re = /([<>[\]{}(),|.~*!@?:/%_^-])|(\d+(?:\.\d+)?)|([^<>[\]{}(),|.~*!@?:/%_^\-\d]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    if (m[1]) out.push({ kind: 'mini', text: m[1] });
    else if (m[2]) out.push({ kind: 'number', text: m[2] });
    else if (m[3]) out.push({ kind: 'string', text: m[3] });
  }
  if (closed) out.push({ kind: 'string', text: quote });
  return out;
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let prevSignificant = '';
  while (pos < src.length) {
    let t: string | null;
    if ((t = match(RE.ws, src, pos))) {
      tokens.push({ kind: 'plain', text: t });
    } else if ((t = match(RE.comment, src, pos))) {
      tokens.push({ kind: 'comment', text: t });
    } else if ((t = match(RE.string, src, pos))) {
      tokens.push(...(t.startsWith('"') || t.startsWith('`') ? miniTokens(t) : [{ kind: 'string' as const, text: t }]));
      prevSignificant = 's';
    } else if (prevSignificant !== '.' && (t = match(RE.label, src, pos))) {
      tokens.push({ kind: 'label', text: t });
      prevSignificant = ':';
    } else if ((t = match(RE.arrow, src, pos))) {
      tokens.push({ kind: 'keyword', text: t });
      prevSignificant = '>';
    } else if ((t = match(RE.number, src, pos))) {
      tokens.push({ kind: 'number', text: t });
      prevSignificant = '0';
    } else if ((t = match(RE.ident, src, pos))) {
      const next = src.slice(pos + t.length).match(/^\s*\(/);
      const kind: TokenKind =
        prevSignificant === '.' ? 'method' : KEYWORDS.has(t) ? 'keyword' : next ? 'fn' : 'plain';
      tokens.push({ kind, text: t });
      prevSignificant = 'a';
    } else {
      t = src[pos]!;
      tokens.push({ kind: 'punct', text: t });
      prevSignificant = t;
    }
    pos += t.length;
  }
  return tokens;
}

/** Tokens zeilenweise (für Zeilennummern). */
export function tokenizeLines(src: string): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokenize(src)) {
    const parts = tok.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ kind: tok.kind, text: part });
    });
  }
  return lines;
}

export const TOKEN_CLASSES: Record<TokenKind, string> = {
  plain: 'text-fg',
  comment: 'text-code-comment italic',
  string: 'text-code-string',
  mini: 'text-code-mini',
  number: 'text-code-number',
  method: 'text-code-method',
  fn: 'text-code-fn',
  keyword: 'text-code-keyword',
  label: 'text-code-keyword font-semibold',
  punct: 'text-muted',
};
