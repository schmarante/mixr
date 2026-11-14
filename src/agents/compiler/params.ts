import type { Dictionary } from '../../i18n';
import { NOTE_GRID_BARS } from '../../types/ast';
import type {
  BlockDef,
  BlockNode,
  DrumGridParamDef,
  DrumGridValue,
  NoteGridParamDef,
  NoteGridValue,
  NumberParamDef,
  ParamDef,
  SelectParamDef,
  TextParamDef,
  ToggleParamDef,
} from '../../types/ast';
import { paramLabel } from '../../blocks/text';
import { t } from '../../i18n';

type ParamProblem = keyof Dictionary['compiler']['param'];

/**
 * Validierender Parameter-Zugriff auf Basis des Block-Katalogs.
 *
 *  - Fehlender Parameter (undefined) → Katalog-Default (z. B. ältere Projekte).
 *  - Vorhandener, aber ungültiger Wert → ParamError (Block wird übersprungen).
 *  - Zahlen außerhalb des Bereichs werden auf min/max begrenzt.
 */

export class ParamError extends Error {}

/** Fehler zu einem Parameter, Text in der aktuellen Sprache (compiler.param.*). */
export function paramError(problem: ParamProblem, param: string, value?: string): ParamError {
  return new ParamError(t(`compiler.param.${problem}`, value === undefined ? { param } : { param, value }));
}

const MAX_STEPS = 128;

export class ParamReader {
  constructor(
    private readonly block: BlockNode,
    private readonly def: BlockDef,
  ) {}

  private paramDef<T extends ParamDef['type']>(key: string, type: T): Extract<ParamDef, { type: T }> {
    const d = this.def.params.find((p) => p.key === key);
    if (!d || d.type !== type) throw new Error(`Catalog error: ${this.def.type}.${key} is not a ${type}`);
    return d as Extract<ParamDef, { type: T }>;
  }

  private fail(d: ParamDef, problem: ParamProblem, value?: string): never {
    throw paramError(problem, this.label(d.key), value);
  }

  number(key: string): number {
    const d: NumberParamDef = this.paramDef(key, 'number');
    const raw = this.block.params[key];
    if (raw === undefined) return d.default;
    const v = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(v)) this.fail(d, 'notANumber');
    return Math.min(d.max, Math.max(d.min, v));
  }

  /**
   * Auswahlwert. Muss eine der Katalog-Optionen sein – außer `lenient` erlaubt
   * zusätzlich freie Werte (z. B. eigene Sample-Namen), die dem Muster genügen.
   */
  select(key: string, lenient?: RegExp): string {
    const d: SelectParamDef = this.paramDef(key, 'select');
    const raw = this.block.params[key];
    if (raw === undefined) return d.default;
    if (typeof raw !== 'string' || raw.trim() === '') this.fail(d, 'empty');
    if (d.options.some((o) => o.value === raw)) return raw;
    if (lenient?.test(raw)) return raw;
    this.fail(d, 'unknownValue', raw);
  }

  text(key: string): string {
    const d: TextParamDef = this.paramDef(key, 'text');
    const raw = this.block.params[key];
    if (raw === undefined) return d.default;
    if (typeof raw !== 'string') this.fail(d, 'notText');
    return raw;
  }

  /** Schalter. Akzeptiert auch "true"/"false" (z. B. aus Agenten-Eingaben). */
  toggle(key: string): boolean {
    const d: ToggleParamDef = this.paramDef(key, 'toggle');
    const raw = this.block.params[key];
    if (raw === undefined) return d.default;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 'false') return raw === 'true';
    this.fail(d, 'notAToggle');
  }

  /** Anzeigename eines Parameters (aktuelle Sprache). */
  label(key: string): string {
    return paramLabel(this.def.type, key);
  }

  drumGrid(key: string): DrumGridValue {
    const d: DrumGridParamDef = this.paramDef(key, 'drumGrid');
    const raw = this.block.params[key];
    if (raw === undefined) return structuredClone(d.default);
    if (typeof raw !== 'object' || raw === null || !('rows' in raw) || typeof raw.rows !== 'object' || raw.rows === null)
      this.fail(d, 'damaged');
    const rows: Record<string, boolean[]> = {};
    let longest = 0;
    for (const [name, steps] of Object.entries(raw.rows)) {
      if (!Array.isArray(steps)) this.fail(d, 'damaged');
      rows[name] = steps.map((s) => s === true);
      longest = Math.max(longest, steps.length);
    }
    const steps = validSteps(raw.steps) ?? longest;
    if (steps < 1) this.fail(d, 'noSteps');
    for (const name of Object.keys(rows)) rows[name] = fit(rows[name]!, steps, false);
    return { steps, rows };
  }

  noteGrid(key: string): NoteGridValue {
    const d: NoteGridParamDef = this.paramDef(key, 'noteGrid');
    const raw = this.block.params[key];
    if (raw === undefined) return structuredClone(d.default);
    if (typeof raw !== 'object' || raw === null || !('cells' in raw) || !Array.isArray(raw.cells))
      this.fail(d, 'damaged');
    const rawLengths: unknown = 'lengths' in raw ? raw.lengths : undefined;
    const lengthRows = Array.isArray(rawLengths) ? (rawLengths as unknown[]) : [];
    // Pro Spalte: Stufe → Dauer (doppelte Stufen: längste gewinnt)
    const columns: Map<number, number>[] = raw.cells.map((cell, i) => {
      if (!Array.isArray(cell)) this.fail(d, 'damaged');
      const lens = lengthRows[i];
      const map = new Map<number, number>();
      cell.forEach((v: unknown, k: number) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return;
        const len = Array.isArray(lens) && typeof lens[k] === 'number' && Number.isFinite(lens[k]) ? Math.max(1, Math.round(lens[k])) : 1;
        const degree = Math.round(v);
        map.set(degree, Math.max(map.get(degree) ?? 0, len));
      });
      return map;
    });
    const bars = 'bars' in raw && typeof raw.bars === 'number' && (NOTE_GRID_BARS as readonly number[]).includes(raw.bars) ? raw.bars : 1;
    const steps = validSteps(raw.steps) ?? Math.max(1, Math.round(columns.length / bars));
    if (steps < 1) this.fail(d, 'noSteps');
    const total = steps * bars;
    const fitted = fit(columns, total, new Map<number, number>());
    const cells = fitted.map((m) => [...m.keys()].sort((a, b) => a - b));
    // Dauer auf das Ende des Rasters begrenzen (kein Umlauf in den nächsten Durchgang)
    const lengths = fitted.map((m, i) => [...m.keys()].sort((a, b) => a - b).map((deg) => Math.min(m.get(deg)!, total - i)));
    const held = lengths.some((row) => row.some((l) => l > 1));
    return held || bars > 1 ? { steps, bars, cells, lengths } : { steps, cells };
  }
}

function validSteps(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_STEPS ? v : undefined;
}

function fit<T>(arr: T[], n: number, fill: T): T[] {
  return Array.from({ length: n }, (_, i) => (i < arr.length ? arr[i]! : fill));
}
