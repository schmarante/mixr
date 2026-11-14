/**
 * Formatierungs- und Escaping-Helfer für den Compiler (rein, SSR-sicher).
 */

/** Rundet sauber (keine 0.30000000000000004) und vermeidet "-0". */
export function fmtNum(n: number, decimals = 4): string {
  const r = Number(n.toFixed(decimals));
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * Macht Nutzertext für einen doppelt gequoteten Strudel-String sicher.
 * Doppelte Anführungszeichen werden vom Transpiler als Mini-Notation gelesen;
 * innerhalb von Mini-Notation haben `"`, `\` und Backticks keine Bedeutung –
 * sie werden daher entfernt (statt escaped), Zeilenumbrüche werden zu Leerzeichen.
 */
export function sanitizeMini(input: string): string {
  return input
    .replace(/["\\`]/g, '')
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Prüft, ob alle Klammern ( [ { < korrekt verschachtelt sind. */
export function bracketsBalanced(text: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' };
  const stack: string[] = [];
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') stack.push(ch);
    else if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.length === 0;
}

/** Erzeugt ein Strudel-String-Literal aus bereits bereinigtem Text. */
export function quote(text: string): string {
  return `"${sanitizeMini(text)}"`;
}

/** Text für eine einzeilige `//`-Kommentarzeile. */
export function commentText(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
}

/** Freie Code-Felder: Leerraum und abschließende Semikolons entfernen. */
export function trimCode(code: string): string {
  return code.trim().replace(/;+\s*$/, '').trim();
}

/**
 * Hängt eine Methodenkette an einen (evtl. mehrzeiligen) Ausdruck.
 * Endet die letzte Zeile mit einem Kommentar, beginnt die Kette in einer neuen
 * Zeile – sonst würde sie auskommentiert.
 */
export function appendChain(expr: string, chain: string): string {
  if (!chain) return expr;
  const lastLine = expr.slice(expr.lastIndexOf('\n') + 1);
  return /\/\/|\/\*/.test(lastLine) ? `${expr}\n  ${chain}` : `${expr}${chain}`;
}
