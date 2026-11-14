import { tDynamic } from '../i18n';
import { WORD_UNITS, type BlockKind, type BlockType } from '../types/ast';
import { BLOCK_CATALOG } from './catalog';
import type { ControlGroup } from './controls';

/**
 * Text-Zugriff für Katalog & Vorlagen – die EINZIGE Stelle, über die die UI
 * Block-, Parameter-, Options- und Vorlagentexte bezieht (aktuelle Sprache).
 *
 * Keys (src/i18n/<sprache>/blocks.json bzw. templates.json):
 *   blocks.kinds.<kind>.label|description
 *   blocks.types.<type>.label|description
 *   blocks.types.<type>.params.<key>.label|hint|placeholder
 *   blocks.options.<optionSet>.<wert>      (Punkte im Wert als „_“, siehe optionTextKey)
 *   blocks.instruments.<sample>
 *   blocks.units.<unit>                    (nur Wort-Einheiten, mit Mehrzahl)
 *   blocks.controlGroups.<gruppe>          (Gruppen der Strudel-Controls, controls.ts)
 *   templates.<id>.name|description|tracks.<spur>
 *
 * Fehlende Texte fallen auf Englisch, dann auf den Key/Wert zurück.
 */

export function blockLabel(type: BlockType): string {
  return tDynamic(`blocks.types.${type}.label`) ?? type;
}

export function blockDescription(type: BlockType): string {
  return tDynamic(`blocks.types.${type}.description`) ?? '';
}

export function kindLabel(kind: BlockKind): string {
  return tDynamic(`blocks.kinds.${kind}.label`) ?? kind;
}

export function kindDescription(kind: BlockKind): string {
  return tDynamic(`blocks.kinds.${kind}.description`) ?? '';
}

function param(type: BlockType, key: string) {
  return BLOCK_CATALOG[type].params.find((p) => p.key === key);
}

function paramText(type: BlockType, key: string, field: 'label' | 'hint' | 'placeholder'): string | undefined {
  return tDynamic(`blocks.types.${type}.params.${key}.${field}`);
}

export function paramLabel(type: BlockType, key: string): string {
  return paramText(type, key, 'label') ?? key;
}

export function paramHint(type: BlockType, key: string): string | undefined {
  return paramText(type, key, 'hint');
}

export function paramPlaceholder(type: BlockType, key: string): string | undefined {
  return param(type, key)?.type === 'text' ? paramText(type, key, 'placeholder') : undefined;
}

/**
 * Anzeige-Einheit eines Zahl-Parameters. Symbole (×, Hz, s, dB) bleiben, Wörter
 * werden übersetzt – mit `value` in passender Mehrzahl („1 bar“ / „4 bars“).
 */
export function paramUnit(type: BlockType, key: string, value?: number): string | undefined {
  const p = param(type, key);
  if (p?.type !== 'number' || p.unit === undefined) return undefined;
  if (WORD_UNITS.includes(p.unit)) {
    // Mehrzahl nach Betrag: „-1 Halbton“, „-2 Halbtöne“
    return tDynamic(`blocks.units.${p.unit}`, { count: Math.abs(value ?? p.max) }) ?? p.unit;
  }
  return p.unit;
}

/** Text-Key eines Optionswerts: Punkte trennen Pfade, deshalb „0.25“ → „0_25“. */
export function optionTextKey(value: string): string {
  return value.replaceAll('.', '_');
}

/** Label einer Select-Option. Konvention: „Kurz – Detail“ oder „Kurz (Detail)“. */
export function optionLabel(type: BlockType, key: string, value: string): string {
  const p = param(type, key);
  if (p?.type !== 'select') return value;
  return tDynamic(`blocks.options.${p.optionSet}.${optionTextKey(value)}`) ?? value;
}

/** Anzeigename einer Gruppe von Strudel-Controls (Filter, FM, Wavetable …). */
export function controlGroupLabel(group: ControlGroup): string {
  return tDynamic(`blocks.controlGroups.${group}`) ?? group;
}

/** Anzeigename eines Drum-Instruments (bd → „Kick“). */
export function instrumentLabel(value: string): string {
  return tDynamic(`blocks.instruments.${value}`) ?? value;
}

export function templateName(id: string): string {
  return tDynamic(`templates.${id}.name`) ?? id;
}

export function templateDescription(id: string): string {
  return tDynamic(`templates.${id}.description`) ?? '';
}

/** Spurname einer Vorlage (Key aus src/data/templates.ts). */
export function templateTrackName(id: string, track: string): string {
  return tDynamic(`templates.${id}.tracks.${track}`) ?? track;
}

/** Abschnittsname im Song-Ablauf einer Vorlage. */
export function templateSectionName(id: string, section: string): string {
  return tDynamic(`templates.${id}.sections.${section}`) ?? section;
}
