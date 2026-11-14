/**
 * Strudel-Theme für CodeMirror: dunkel, passend zu den Design-Tokens aus global.css
 * (Farben als CSS-Variablen mit Rückfallwert – das Theme wird zur Laufzeit eingefügt).
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const v = (name: string, fallback: string) => `var(--color-${name}, ${fallback})`;

const C = {
  canvas: v('canvas', '#0b0d12'),
  panel: v('panel', '#10131a'),
  card: v('card', '#171b24'),
  raised: v('raised', '#1e2330'),
  hover: v('hover', '#262c3a'),
  line: v('line', 'rgb(255 255 255 / 0.07)'),
  lineStrong: v('line-strong', 'rgb(255 255 255 / 0.14)'),
  fg: v('fg', '#eceef3'),
  muted: v('muted', '#a3abbd'),
  faint: v('faint', '#7a8296'),
  accent: v('accent', '#ff8a4c'),
  accentSoft: v('accent-soft', 'rgb(255 138 76 / 0.14)'),
  danger: v('danger', '#ff7b7b'),
  string: v('code-string', '#a5d98a'),
  number: v('code-number', '#f2c063'),
  method: v('code-method', '#7cc4ff'),
  fn: v('code-fn', '#d7a6ff'),
  keyword: v('code-keyword', '#ff9d68'),
  comment: v('code-comment', '#6c7488'),
  mini: v('code-mini', '#e6e08a'),
};

export const strudelTheme = EditorView.theme(
  {
    '&': {
      color: C.fg,
      backgroundColor: 'transparent',
      fontSize: '13px',
      height: '100%',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
      lineHeight: '1.6',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: C.accent, padding: '10px 0' },
    '.cm-line': { padding: '0 14px 0 6px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: C.accent, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'rgb(255 138 76 / 0.28)' },
    '.cm-activeLine': { backgroundColor: 'rgb(255 255 255 / 0.025)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'rgb(122 130 150 / 0.55)',
      border: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 10px', minWidth: '30px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: C.muted },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'rgb(255 255 255 / 0.08)',
      outline: `1px solid ${C.lineStrong}`,
      borderRadius: '2px',
    },
    '.cm-placeholder': { color: C.faint, fontStyle: 'normal' },
    // Mini-Notation: dezent abgesetzt
    '.cm-mini': {
      backgroundColor: 'rgb(230 224 138 / 0.06)',
      borderRadius: '3px',
      boxShadow: '0 0 0 1px rgb(230 224 138 / 0.08)',
    },
    '.cm-mini, .cm-mini span': { color: C.mini },
    // Highlighter: was gerade klingt
    '.cm-strudel-active': {
      backgroundColor: 'rgb(255 138 76 / 0.22)',
      outline: `1.5px solid ${C.accent}`,
      outlineOffset: '-1px',
      borderRadius: '3px',
      color: `${C.fg} !important`,
    },
    '.cm-strudel-active span': { color: `${C.fg} !important` },
    '.cm-strudel-fade': {
      borderRadius: '3px',
      animation: 'cm-strudel-fade 320ms ease-out forwards',
    },
    '@keyframes cm-strudel-fade': {
      from: { backgroundColor: 'rgb(255 138 76 / 0.2)', outline: '1.5px solid rgb(255 138 76 / 0.7)', outlineOffset: '-1px' },
      to: { backgroundColor: 'rgb(255 138 76 / 0)', outline: '1.5px solid rgb(255 138 76 / 0)', outlineOffset: '-1px' },
    },
    // Fehlerstelle
    '.cm-strudel-error': {
      textDecoration: `underline wavy ${C.danger}`,
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '3px',
      backgroundColor: 'rgb(255 123 123 / 0.12)',
      borderRadius: '2px',
    },
    // Suchen
    '.cm-panels': { backgroundColor: C.card, color: C.fg, borderColor: C.line },
    '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${C.line}` },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${C.line}` },
    '.cm-search': { fontSize: '12px', padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' },
    '.cm-search input, .cm-search button, .cm-search label': { fontSize: '12px' },
    '.cm-textfield': {
      backgroundColor: C.canvas,
      border: `1px solid ${C.lineStrong}`,
      borderRadius: '6px',
      color: C.fg,
      padding: '2px 6px',
    },
    '.cm-textfield:focus': { borderColor: C.accent, outline: 'none' },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: C.raised,
      border: `1px solid ${C.line}`,
      borderRadius: '6px',
      color: C.fg,
      padding: '2px 8px',
    },
    '.cm-button:hover': { backgroundColor: C.hover },
    '.cm-panel.cm-search [name=close]': { color: C.muted, fontSize: '16px' },
    '.cm-searchMatch': { backgroundColor: 'rgb(242 192 99 / 0.25)', outline: '1px solid rgb(242 192 99 / 0.4)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgb(255 138 76 / 0.4)' },
    '.cm-selectionMatch': { backgroundColor: 'rgb(255 255 255 / 0.07)' },
    // Autovervollständigung
    '.cm-tooltip': {
      backgroundColor: C.card,
      border: `1px solid ${C.lineStrong}`,
      borderRadius: '10px',
      color: C.fg,
      boxShadow: '0 12px 32px rgb(0 0 0 / 0.5)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '12.5px', maxHeight: '15em' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px 3px 6px', lineHeight: '1.5' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: C.accentSoft, color: C.fg },
    '.cm-completionLabel': { color: C.fg },
    // Signatur-Hinweis (in den Klammern) und Info zum Vorschlag
    '.cm-tooltip.cm-completionInfo': { padding: '0', maxWidth: '360px' },
    '.cm-strudel-signature': { padding: '6px 10px', maxWidth: '420px' },
    '.cm-strudel-signature-head': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '12px', color: C.muted },
    '.cm-strudel-signature-active': { color: C.accent, fontWeight: '600' },
    '.cm-strudel-signature-doc': {
      marginTop: '3px',
      fontFamily: 'var(--font-sans, ui-sans-serif, system-ui)',
      fontSize: '11.5px',
      lineHeight: '1.4',
      color: C.faint,
    },
    '.cm-completionMatchedText': { color: C.accent, textDecoration: 'none', fontWeight: '600' },
    '.cm-completionDetail': {
      color: C.faint,
      fontStyle: 'normal',
      fontFamily: 'var(--font-sans, ui-sans-serif, system-ui)',
      fontSize: '11px',
      marginLeft: '10px',
    },
    '.cm-completionIcon': { opacity: '0.7', width: '1.4em', paddingRight: '4px' },
    '.cm-completionIcon-function::after': { content: "'ƒ'", color: C.fn },
    '.cm-completionIcon-property::after': { content: "'●'", color: C.method, fontSize: '9px' },
    '.cm-completionIcon-constant::after': { content: "'♪'", color: C.string },
    '.cm-completionIcon-enum::after': { content: "'▦'", color: C.number },
  },
  { dark: true },
);

export const strudelHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: C.comment, fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string)], color: C.string },
  { tag: [tags.number, tags.bool, tags.null], color: C.number },
  { tag: [tags.keyword, tags.definitionKeyword, tags.moduleKeyword, tags.controlKeyword, tags.operatorKeyword], color: C.keyword },
  { tag: [tags.function(tags.variableName)], color: C.fn },
  { tag: [tags.function(tags.propertyName), tags.propertyName], color: C.method },
  { tag: [tags.labelName], color: C.keyword, fontWeight: '600' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: C.fg },
  { tag: [tags.operator, tags.punctuation, tags.paren, tags.squareBracket, tags.brace, tags.separator], color: C.muted },
  { tag: tags.invalid, color: C.danger },
]);

export const strudelHighlighting = syntaxHighlighting(strudelHighlightStyle);
