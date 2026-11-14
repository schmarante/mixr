#!/usr/bin/env node
/**
 * Erzeugt src/data/strudelSignatures.ts: Parameter und Kurzbeschreibung je Strudel-Funktion,
 * gelesen aus den JSDoc-Kommentaren der installierten Pakete (node_modules/@strudel/*, superdough)
 * – also genau passend zur verwendeten Strudel-Version.
 *
 *   node scripts/import-strudel-signatures.mjs
 *
 * Verwendet vom Code-Editor: Signatur-Hinweis innerhalb der Klammern und Info zu Vorschlägen.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${ROOT}src/data/strudelSignatures.ts`;
const PACKAGES = ['core', 'mini', 'tonal', 'webaudio', 'xen', 'midi', 'motion', 'csound'].map((p) => `${ROOT}node_modules/@strudel/${p}`);
PACKAGES.push(`${ROOT}node_modules/superdough`);

const MAX_DOC = 160;

/**
 * Häufig genutzte Funktionen, deren JSDoc keine @param-Angaben hat: Parameter von Hand
 * (Namen wie in der strudel.cc-Referenz). Überschreibt nur fehlende Parameter.
 */
const PARAM_OVERRIDES = {
  note: [{ name: 'notes', type: 'string | number | Pattern', doc: 'note names (c3, eb4 …) or midi numbers' }],
  stack: [{ name: '...patterns', type: 'Pattern | string', doc: 'played at the same time' }],
  seq: [{ name: '...patterns', type: 'Pattern | string', doc: 'squeezed into one cycle, one after another' }],
  cat: [{ name: '...patterns', type: 'Pattern | string', doc: 'one per cycle, one after another' }],
  arrange: [{ name: '...sections', type: '[cycles, Pattern]', doc: 'e.g. [4, a], [2, b]' }],
  struct: [{ name: 'structure', type: 'string | Pattern', doc: 'rhythm, e.g. "x ~ x x"' }],
  mask: [{ name: 'mask', type: 'string | Pattern', doc: '1 = keep, 0 = silence' }],
  jux: [{ name: 'func', type: 'function', doc: 'applied to the right channel, e.g. rev' }],
  superimpose: [{ name: 'func', type: 'function', doc: 'result is layered over the original' }],
  layer: [{ name: '...funcs', type: 'function', doc: 'each result is layered' }],
  every: [{ name: 'n', type: 'number | Pattern' }, { name: 'func', type: 'function' }],
  ply: [{ name: 'factor', type: 'number | Pattern', doc: 'repeats each event' }],
  chop: [{ name: 'parts', type: 'number | Pattern', doc: 'cuts each sample into parts' }],
  striate: [{ name: 'parts', type: 'number | Pattern' }],
  slice: [{ name: 'parts', type: 'number | Pattern' }, { name: 'indices', type: 'string | Pattern' }],
  splice: [{ name: 'parts', type: 'number | Pattern' }, { name: 'indices', type: 'string | Pattern' }],
  loopAt: [{ name: 'cycles', type: 'number | Pattern' }],
  fit: [],
  chunk: [{ name: 'n', type: 'number | Pattern' }, { name: 'func', type: 'function' }],
  iter: [{ name: 'n', type: 'number | Pattern' }],
  range: [{ name: 'min', type: 'number' }, { name: 'max', type: 'number' }],
  velocity: [{ name: 'velocity', type: 'number | Pattern', doc: 'between 0 and 1' }],
  add: [{ name: 'amount', type: 'number | string | Pattern' }],
  sub: [{ name: 'amount', type: 'number | string | Pattern' }],
  mul: [{ name: 'amount', type: 'number | string | Pattern' }],
  arp: [{ name: 'indices', type: 'string | Pattern', doc: 'which chord notes, e.g. "0 2 1"' }],
  hurry: [{ name: 'factor', type: 'number | Pattern', doc: 'faster and higher' }],
  run: [{ name: 'n', type: 'number', doc: '0 1 2 … n-1' }],
  samples: [{ name: 'sampleMap', type: 'string | object', doc: 'URL, github:user/repo or { name: url }' }, { name: 'baseUrl', type: 'string', optional: true }],
};

/** Argumentnamen aus dem Code nach dem Kommentar (wenn das JSDoc keine @param hat). */
function paramsFromCode(code) {
  const m =
    /register(?:Control)?\((?:\[[^\]]*\]|[^,]+),\s*(?:async\s+)?(?:function\s*[\w$]*\s*)?\(([^)]*)\)/.exec(code) ??
    /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*[\w$]+\s*\(([^)]*)\)/.exec(code) ??
    /^(?:export\s+)?const\s+[\w$]+\s*=\s*(?:async\s+)?(?:function\s*)?\(([^)]*)\)/.exec(code) ??
    /^(?:async\s+)?[\w$]+\s*\(([^)]*)\)\s*\{/.exec(code);
  if (!m) return [];
  const isRegister = /register/.test(m[0]);
  const names = m[1]
    .split(',')
    .map((a) => a.trim().replace(/\s*=.*$/, ''))
    .filter((a) => /^(\.\.\.)?[\w$]+$/.test(a));
  // register(…, function (arg…, pat)): das letzte Argument ist das Pattern selbst
  if (isRegister && names.length && /^(pat|pattern)$/.test(names[names.length - 1])) names.pop();
  return names.map((name) => ({ name }));
}

/** Name der dokumentierten Funktion aus der Code-Zeile nach dem Kommentar. */
function nameFromCode(line) {
  const patterns = [
    /register(?:Control)?\(\s*\[?\s*['"]([\w$]+)['"]/,
    /^export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/,
    /^export\s+const\s+([\w$]+)\s*=/,
    /^(?:export\s+)?const\s+([\w$]+)\s*=/,
    /Pattern\.prototype\.([\w$]+)\s*=/,
    /^(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{/,
  ];
  for (const re of patterns) {
    const m = re.exec(line.trim());
    if (m && m[1] !== 'constructor') return m[1];
  }
  return null;
}

/** Erster Absatz der Beschreibung, Markdown entschärft, gekürzt. */
function shortDoc(lines) {
  const para = [];
  for (const l of lines) {
    if (l.trim() === '') {
      if (para.length) break;
      continue;
    }
    para.push(l.trim());
  }
  let text = para
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text);
  if (sentence && sentence[1].length >= 20) text = sentence[1];
  if (text.length > MAX_DOC) text = `${text.slice(0, MAX_DOC - 1).replace(/\s+\S*$/, '')} …`;
  return text;
}

function parseParam(rest) {
  // {type} name description | name description | {type} [name=default] description
  const m = /^(?:\{([^}]*)\}\s*)?(\[[^\]]+\]|[\w$.]+)?\s*(?:-\s*)?(.*)$/.exec(rest.trim());
  if (!m) return null;
  let name = m[2] ?? '';
  let optional = false;
  if (name.startsWith('[')) {
    optional = true;
    name = name.slice(1, -1).split('=')[0].trim();
  }
  if (!name) return null;
  const param = { name };
  if (m[1]) param.type = m[1].replace(/\s+/g, ' ').trim();
  if (optional) param.optional = true;
  const doc = (m[3] ?? '').trim();
  if (doc) param.doc = doc.length > 100 ? `${doc.slice(0, 99).replace(/\s+\S*$/, '')} …` : doc;
  return param;
}

function parseFile(path, out) {
  const src = readFileSync(path, 'utf8');
  const re = /\/\*\*([\s\S]*?)\*\/\s*\n([^\n]*)/g;
  const after = (index) => src.slice(index, index + 400).replace(/\s*\n\s*/g, ' ');
  let m;
  while ((m = re.exec(src))) {
    const body = m[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, ''))
      .map((l) => l.replace(/\s+$/, ''));
    if (body.some((l) => /@noAutocomplete|@private|@class\b/.test(l))) continue;
    const descLines = [];
    const params = [];
    let name = null;
    let synonyms = [];
    let inTags = false;
    let lastTag = null;
    for (const line of body) {
      const tag = /^@(\w+)\s*(.*)$/.exec(line.trim());
      if (tag) {
        inTags = true;
        lastTag = tag[1];
        if (tag[1] === 'name') name = tag[2].trim().split(/\s+/)[0];
        else if (tag[1] === 'synonyms') synonyms = tag[2].split(',').map((s) => s.trim()).filter(Boolean);
        else if (tag[1] === 'param') {
          const p = parseParam(tag[2]);
          // Unterparameter (options.foo) nicht als eigene Argumente
          if (p && !p.name.includes('.')) params.push(p);
        }
        continue;
      }
      if (!inTags) descLines.push(line);
      else if (lastTag === 'param' && line.trim() && params.length && !params[params.length - 1].doc) {
        params[params.length - 1].doc = line.trim();
      }
    }
    name ??= nameFromCode(m[2]);
    if (!name || !/^[\w$]+$/.test(name)) continue;
    if (params.length === 0) params.push(...(PARAM_OVERRIDES[name] ?? paramsFromCode(after(m.index + m[0].length - m[2].length))));
    const entry = { params };
    const doc = shortDoc(descLines);
    if (doc) entry.doc = doc;
    for (const n of [name, ...synonyms]) {
      if (!/^[\w$]+$/.test(n)) continue;
      const prev = out.get(n);
      // Bevorzugt: Eintrag mit Parametern bzw. Beschreibung; der Hauptname vor Synonymen
      if (!prev || (prev.params.length === 0 && params.length > 0) || (!prev.doc && entry.doc && prev.params.length <= params.length)) {
        out.set(n, n === name ? entry : { ...entry, aliasOf: name });
      }
    }
  }
}

const out = new Map();
for (const dir of PACKAGES) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).sort()) {
    if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) parseFile(`${dir}/${f}`, out);
  }
}

for (const [name, params] of Object.entries(PARAM_OVERRIDES)) {
  const e = out.get(name);
  if (!e) out.set(name, { params });
  else if (e.params.length === 0 || e.params.every((p) => !p.type)) e.params = params;
}

const entries = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const lines = entries.map(([name, e]) => `  ${JSON.stringify(name)}: ${JSON.stringify(e)},`);
const ts = `/**
 * Strudel-Signaturen (Parameter + Kurzbeschreibung, Englisch) aus den JSDoc-Kommentaren
 * der installierten Strudel-Pakete. GENERIERT – nicht von Hand bearbeiten:
 *   node scripts/import-strudel-signatures.mjs
 */

export interface StrudelParam {
  name: string;
  type?: string;
  optional?: boolean;
  doc?: string;
}

export interface StrudelSignature {
  params: readonly StrudelParam[];
  doc?: string;
  /** Hauptname, falls dieser Eintrag ein Synonym ist. */
  aliasOf?: string;
}

export const STRUDEL_SIGNATURES: Readonly<Record<string, StrudelSignature>> = {
${lines.join('\n')}
};
`;
writeFileSync(OUT, ts);
console.log(`${entries.length} Signaturen → ${OUT.replace(ROOT, '')}`);
