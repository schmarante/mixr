/**
 * Visueller AST – die gemeinsame Sprache aller Agenten.
 *
 * Aufbau: Jede Spur (TrackNode) ist der Kopf einer linearen Kette von Blöcken,
 * verbunden über Edges:  track → source → modifier/effect → modifier/effect …
 * Die UI zeigt diese Kette als Kanalzug (Mixer-Metapher), der Compiler liest sie
 * als AST. Kanten werden ausschließlich über src/store/actions.ts gepflegt.
 */

/** Kategorie eines Blocks – bestimmt Position in der Kette und Darstellung. */
export type BlockKind = 'source' | 'modifier' | 'effect';

export type SourceBlockType = 'drums' | 'melody' | 'chords' | 'sample' | 'code';
export type ModifierBlockType =
  | 'fast'
  | 'slow'
  | 'rev'
  | 'firstOf'
  | 'degrade'
  | 'ply'
  | 'jux'
  | 'sometimes'
  | 'euclid'
  | 'off'
  | 'echo'
  | 'chunk'
  | 'iter'
  | 'palindrome'
  | 'swing'
  | 'linger'
  | 'segment'
  | 'shuffle'
  | 'mask'
  | 'transpose'
  | 'scaleTranspose'
  | 'arp'
  | 'superimpose'
  | 'vib'
  | 'chop'
  | 'striate'
  | 'slice'
  | 'loopAt'
  | 'code-mod';
export type EffectBlockType =
  | 'lpf'
  | 'hpf'
  | 'sweep'
  | 'room'
  | 'delay'
  | 'crush'
  | 'distort'
  | 'pan'
  | 'adsr'
  | 'filterEnv'
  | 'phaser'
  | 'vowel'
  | 'tremolo'
  | 'compressor'
  | 'coarse'
  | 'postgain'
  | 'fm'
  | 'sampleRange'
  | 'cut'
  | 'param'
  | 'code-fx';

export type BlockType = SourceBlockType | ModifierBlockType | EffectBlockType;

/* ------------------------------------------------------------------ */
/* Parameterwerte                                                      */
/* ------------------------------------------------------------------ */

/** Drum-Raster: pro Instrument (Sample-Name, z. B. "bd") ein Array von Steps. */
export interface DrumGridValue {
  steps: number;
  rows: Record<string, boolean[]>;
}

/**
 * Noten-Raster (Piano-Roll in Skalenstufen): pro Step eine Liste von
 * Skalenstufen (0 = Grundton). Leeres Array = Pause. Mehrere Werte = Akkord.
 */
export interface NoteGridValue {
  /** Steps pro Takt (Zyklus). */
  steps: number;
  /** Länge in Takten (1, 2, 4, 8 oder 16; Default 1). Spalten gesamt = steps × bars. */
  bars?: number;
  /** Pro Spalte die Stufen der Noten, die dort BEGINNEN (leer = nichts beginnt). */
  cells: number[][];
  /**
   * Haltetöne: parallel zu `cells` die Dauer jeder Note in Steps (Default 1).
   * `lengths[i][k]` gehört zu `cells[i][k]`. Fehlt das Feld, ist jede Note 1 Step lang.
   */
  lengths?: number[][];
}

/** Erlaubte Melodie-Längen in Takten. */
export const NOTE_GRID_BARS = [1, 2, 4, 8, 16] as const;

export type ParamValue = number | string | boolean | DrumGridValue | NoteGridValue;
export type ParamValues = Record<string, ParamValue>;

/* ------------------------------------------------------------------ */
/* Parameter-Definitionen (für UI und Compiler)                        */
/* ------------------------------------------------------------------ */

/*
 * Der Katalog enthält nur Struktur. Alle Anzeigetexte (Label, Kurzerklärung,
 * Platzhalter, Options- und Instrumentnamen, Einheiten) stehen in
 * src/i18n/<sprache>/blocks.json und werden über src/blocks/text.ts gelesen.
 */

interface ParamDefBase {
  key: string;
  /** Wird erst unter „Mehr Optionen“ angezeigt. */
  advanced?: boolean;
}

/**
 * Einheit einer Zahl. Symbole (×, Hz, s, dB) werden so angezeigt, Wörter
 * (bit, bars, semitones, steps) übersetzt – Anzeige immer über `paramUnit()`
 * aus src/blocks/text.ts.
 */
export type ParamUnit = '×' | 'Hz' | 's' | 'dB' | 'bit' | 'bars' | 'semitones' | 'steps';

/** Einheiten, die als Wort (mit Mehrzahl) übersetzt werden: blocks.units.<unit>. */
export const WORD_UNITS: readonly ParamUnit[] = ['bit', 'bars', 'semitones', 'steps'];

export interface NumberParamDef extends ParamDefBase {
  type: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: ParamUnit;
  /** Logarithmische Skala für Slider (z. B. Frequenzen). */
  log?: boolean;
}

/** Auswahlwert im Katalog (ohne Text – Label über `optionLabel()`). */
export interface CatalogOption {
  value: string;
}

/** Fertige Anzeige-Option (Wert + bereits übersetztes Label), z. B. für Auswahlfelder der UI. */
export interface SelectOption {
  value: string;
  label: string;
}

/** Benannte Options-Listen; Texte unter blocks.options.<set> in blocks.json. */
export type OptionSetId =
  | 'banks'
  | 'sounds'
  | 'notes'
  | 'scales'
  | 'octaves'
  | 'delayTimes'
  | 'lfoShapes'
  | 'progressions'
  | 'rhythms'
  | 'variationActions'
  | 'sometimesActions'
  | 'sweepFilters'
  | 'distortTypes'
  | 'offsets'
  | 'intervals'
  | 'swingGrids'
  | 'lingerParts'
  | 'shuffleModes'
  | 'arpModes'
  | 'vowels'
  | 'tremoloRates'
  | 'fmWaves';

export interface SelectParamDef extends ParamDefBase {
  type: 'select';
  /** Name der Options-Liste (Text-Keys); `options` ist immer OPTION_SETS[optionSet]. */
  optionSet: OptionSetId;
  options: readonly CatalogOption[];
  default: string;
}

export interface TextParamDef extends ParamDefBase {
  type: 'text';
  default: string;
  /** "mini" = Mini-Notation, "code" = Strudel/JS-Ausdruck. */
  syntax: 'mini' | 'code' | 'plain';
}

export interface ToggleParamDef extends ParamDefBase {
  type: 'toggle';
  default: boolean;
}

export interface DrumGridParamDef extends ParamDefBase {
  type: 'drumGrid';
  /** Instrument-Zeilen (Sample-Namen); Anzeigename über `instrumentLabel()`. */
  instruments: readonly CatalogOption[];
  default: DrumGridValue;
}

export interface NoteGridParamDef extends ParamDefBase {
  type: 'noteGrid';
  /** Anzahl sichtbarer Skalenstufen (Zeilen). */
  degrees: number;
  default: NoteGridValue;
}

export type ParamDef =
  | NumberParamDef
  | SelectParamDef
  | TextParamDef
  | ToggleParamDef
  | DrumGridParamDef
  | NoteGridParamDef;

/* ------------------------------------------------------------------ */
/* Block-Katalog                                                       */
/* ------------------------------------------------------------------ */

export interface BlockDef<T extends BlockType = BlockType> {
  type: T;
  kind: BlockKind;
  /** Emoji oder kurzes Symbol für Karten/Picker. */
  icon: string;
  params: ParamDef[];
  /**
   * Strudel-Funktionen und -Controls, die dieser Baustein erzeugen kann
   * (z. B. lpf → ['lpf', 'lpq']). Grundlage des Abdeckungs-Tests gegen die
   * Strudel-API. Leer bei freiem Code; `param` deckt alle Controls aus
   * src/blocks/controls.ts ab.
   */
  covers: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Knoten & Kanten                                                     */
/* ------------------------------------------------------------------ */

export interface TrackParams {
  name: string;
  /** Farbtoken-Name aus TRACK_COLORS. */
  color: TrackColor;
  /** 0 … 1 */
  volume: number;
  muted: boolean;
  solo: boolean;
}

export type TrackColor = 'violet' | 'sky' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'lime' | 'fuchsia';

export interface TrackNode {
  id: string;
  type: 'track';
  params: TrackParams;
}

export interface BlockNode {
  id: string;
  type: BlockType;
  params: ParamValues;
  /** Block temporär überbrücken (bypass), ohne ihn zu löschen. */
  bypassed?: boolean;
}

export type VisualNode = TrackNode | BlockNode;

export interface VisualEdge {
  id: string;
  source: string;
  target: string;
}

export interface VisualAst {
  nodes: VisualNode[];
  edges: VisualEdge[];
  /** Song-Ablauf (optional): ohne Arrangement spielen alle Spuren als Loop. */
  arrangement?: Arrangement;
}

/* ------------------------------------------------------------------ */
/* Arrangement (Song-Zeitleiste)                                       */
/* ------------------------------------------------------------------ */

export interface ArrangementSection {
  id: string;
  /** Länge in Takten (Zyklen), > 0. */
  cycles: number;
  /** Optionaler Name, z. B. „Intro“, „Drop“. */
  name?: string;
}

/** Zustand einer Spur in einem Abschnitt. */
export interface SectionCell {
  on: boolean;
  /**
   * Abwandlung nur in diesem Abschnitt: Strudel-Methodenkette, die an die Spur
   * angehängt wird, z. B. ".lpf(2000)" oder ".slow(2).gain(0.2)".
   */
  code?: string;
}

export interface Arrangement {
  sections: ArrangementSection[];
  /**
   * Spur-ID → Abschnitt-ID → Zustand. Spuren ohne Eintrag spielen in allen
   * Abschnitten (neu hinzugefügte Spuren sind so sofort hörbar); hat eine Spur
   * einen Eintrag, ist ein fehlender Abschnitt = aus.
   */
  cells: Record<string, Record<string, SectionCell>>;
  /** Arbeitsmodus: nur diesen Abschnitt in Schleife spielen (null = ganzer Song). */
  loopSection?: string | null;
  /**
   * Wiedergabe ab diesem Abschnitt (null = von vorn). Strudel startet immer bei
   * Zyklus 0 – der Compiler beginnt das Arrangement deshalb bei diesem Abschnitt
   * (danach geht es mit dem Anfang weiter).
   */
  startSection?: string | null;
}

export interface ProjectSettings {
  /** Tempo in BPM (4 Schläge pro Zyklus → setcpm(bpm / 4)). */
  bpm: number;
  /**
   * Setup-Code des Projekts (z. B. aus einem Import): eigene Funktionen per
   * `register(…)`, Konstanten, Hilfsfunktionen. Steht im erzeugten Code nach
   * `setcpm` und vor allen Spuren. Fehlt bei den meisten Projekten.
   */
  prelude?: string;
  /**
   * Eigene Samples (Slots): Strudel-Klangname → Audiodateien (Varianten :0, :1 …).
   * Nur das Manifest – die Audiodaten liegen lokal (IndexedDB) bzw. im Projekt-ZIP.
   */
  samples?: UserSampleSlot[];
}

/** Eine Audiodatei in einem Sample-Slot (Variante). */
export interface UserSampleFile {
  /** Schlüssel der Audiodaten (IndexedDB / ZIP). */
  id: string;
  fileName: string;
  mime: string;
  size: number;
  /** Dauer in Sekunden, falls bekannt. */
  duration?: number;
}

/** Sample-Slot: ein eigener Klang, im Code als s("name") bzw. s("name:1") nutzbar. */
export interface UserSampleSlot {
  id: string;
  /** Strudel-Klangname: [a-z0-9_], eindeutig, kollidiert nicht mit eingebauten Klängen. */
  name: string;
  files: UserSampleFile[];
}

/** Fertig aufgelöste Spur – bequemer Lesezugriff für Compiler und UI. */
export interface ResolvedTrack {
  track: TrackNode;
  /** Blöcke in Ketten-Reihenfolge (Source zuerst, falls vorhanden). */
  chain: BlockNode[];
}

export function isTrackNode(node: VisualNode): node is TrackNode {
  return node.type === 'track';
}
