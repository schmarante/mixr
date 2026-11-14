import { getBlockDef } from '../../../blocks/catalog';
import { optionLabel, paramUnit } from '../../../blocks/text';
import { getLocale, t } from '../../../i18n';
import type {
  BlockNode,
  BlockType,
  DrumGridValue,
  NoteGridValue,
  NumberParamDef,
  ParamDef,
  ParamValue,
} from '../../../types/ast';

/* ------------------------------------------------------------------ */
/* Typ-Guards                                                          */
/* ------------------------------------------------------------------ */

export function isDrumGridValue(v: unknown): v is DrumGridValue {
  return typeof v === 'object' && v !== null && 'rows' in v && typeof (v as DrumGridValue).steps === 'number';
}

/** Melodie-Raster, auch mit Haltetönen (`lengths`) und mehreren Takten (`bars`). */
export function isNoteGridValue(v: unknown): v is NoteGridValue {
  if (typeof v !== 'object' || v === null || !('cells' in v)) return false;
  const g = v as Partial<NoteGridValue>;
  return (
    Array.isArray(g.cells) &&
    typeof g.steps === 'number' &&
    (g.bars === undefined || typeof g.bars === 'number') &&
    (g.lengths === undefined || Array.isArray(g.lengths))
  );
}

export function numberValue(def: NumberParamDef, v: ParamValue | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def.default;
}

export function stringValue(def: { default: string }, v: ParamValue | undefined): string {
  return typeof v === 'string' ? v : def.default;
}

export function boolValue(def: { default: boolean }, v: ParamValue | undefined): boolean {
  return typeof v === 'boolean' ? v : def.default;
}

/* ------------------------------------------------------------------ */
/* Zahlen formatieren / runden                                         */
/* ------------------------------------------------------------------ */

function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

export function roundToStep(v: number, def: Pick<NumberParamDef, 'min' | 'max' | 'step'>): number {
  const clamped = Math.min(def.max, Math.max(def.min, v));
  const stepped = def.step > 0 ? Math.round((clamped - def.min) / def.step) * def.step + def.min : clamped;
  return Number(Math.min(def.max, Math.max(def.min, stepped)).toFixed(decimalsOf(def.step)));
}

/** Prozent-Darstellung für 0…1-Regler ohne Einheit (für Einsteiger greifbarer). */
export function isPercentParam(def: NumberParamDef): boolean {
  return def.min === 0 && def.max === 1 && def.unit === undefined;
}

/* Zahlformate je Sprache (Dezimaltrennzeichen, Prozent-Schreibweise) – gecacht. */
const fmtCache = new Map<string, Intl.NumberFormat>();
function fmt(decimals: number, style: 'decimal' | 'percent' = 'decimal'): Intl.NumberFormat {
  const locale = getLocale();
  const id = `${locale}|${style}|${decimals}`;
  let f = fmtCache.get(id);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style, maximumFractionDigits: decimals, minimumFractionDigits: 0 });
    fmtCache.set(id, f);
  }
  return f;
}

/** 0…1 als Prozent in der aktuellen Sprache („80 %“ bzw. „80%“). */
export function formatPercent(fraction: number): string {
  return fmt(0, 'percent').format(fraction);
}

/** Dezimaltrennzeichen der aktuellen Sprache (für Eingabefelder). */
export function decimalSeparator(): string {
  return fmt(1).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
}

/** Zahlwert mit (übersetzter) Einheit, z. B. „1,2 kHz“, „4 Takte“ / „4 bars“, „2×“. */
export function formatNumber(type: BlockType, def: NumberParamDef, v: number): string {
  if (isPercentParam(def)) return formatPercent(v);
  if (def.unit === 'Hz' && v >= 1000) return `${fmt(1).format(v / 1000)} kHz`;
  const text = fmt(decimalsOf(def.step)).format(v);
  const unit = paramUnit(type, def.key, v);
  if (!unit) return text;
  return unit === '×' ? `${text}×` : `${text} ${unit}`;
}

/** Kurzes Label einer Select-Option (Teil vor „ – “ bzw. „ (“), in der aktuellen Sprache. */
export function shortOptionLabel(type: BlockType, key: string, value: string): string {
  return optionLabel(type, key, value).split(' – ')[0]!.split(' (')[0]!;
}

/* ------------------------------------------------------------------ */
/* Zusammenfassung für Chips                                           */
/* ------------------------------------------------------------------ */

/** Wichtigster Wert eines Blocks als kurzer Text (für Chips & Karten). */
export function blockSummary(block: BlockNode): string {
  const def = getBlockDef(block.type);
  const main = def.params.find((p) => !p.advanced && (p.type === 'number' || p.type === 'select' || p.type === 'text'));
  if (!main) return '';
  return paramSummary(block.type, main, block.params[main.key]);
}

export function paramSummary(type: BlockType, def: ParamDef, v: ParamValue | undefined): string {
  switch (def.type) {
    case 'number':
      return formatNumber(type, def, numberValue(def, v));
    case 'select':
      return shortOptionLabel(type, def.key, stringValue(def, v));
    case 'text': {
      const s = stringValue(def, v).trim();
      return s.length > 22 ? `${s.slice(0, 21)}…` : s;
    }
    case 'toggle':
      return boolValue(def, v) ? t('common.on') : t('common.off');
    default:
      return '';
  }
}

/** Ist der aktuelle Wert gleich dem Default? (für Reset-Buttons) */
export function isDefaultValue(def: ParamDef, v: ParamValue | undefined): boolean {
  if (v === undefined) return true;
  return JSON.stringify(v) === JSON.stringify(def.default);
}
