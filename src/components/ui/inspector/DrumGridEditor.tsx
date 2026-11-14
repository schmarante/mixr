import { useMemo, useRef } from 'react';
import { instrumentLabel, paramHint, paramLabel } from '../../../blocks/text';
import { useT } from '../../../i18n/react';
import type { BlockType, DrumGridParamDef, DrumGridValue } from '../../../types/ast';
import { useSourcePlayhead } from '../hooks/usePlayhead';
import type { TrackColorClasses } from '../lib/trackColors';
import type { ParamChange } from './fields';
import { GridToolbar } from './GridToolbar';
import { StepGrid, type StepGridRow } from './StepGrid';

/** Step-Sequencer: eine Zeile pro Instrument, 16 Steps. */
export function DrumGridEditor({
  def,
  blockType,
  blockId,
  value,
  onChange,
  color,
}: {
  def: DrumGridParamDef;
  blockType: BlockType;
  /** Für das Lauflicht (fast/slow/rev-Bausteine dahinter). */
  blockId?: string;
  value: DrumGridValue;
  onChange: ParamChange;
  color: TrackColorClasses;
}) {
  const { t, lang } = useT();
  const label = paramLabel(blockType, def.key);
  const steps = Math.max(1, value.steps);
  const playhead = useSourcePlayhead(blockId, steps);
  // Aktuellster Wert auch zwischen zwei Renders (beim schnellen Malen)
  const latest = useRef(value);
  latest.current = value;

  const rows: StepGridRow[] = useMemo(() => {
    const known = def.instruments.map((i) => ({ key: i.value, label: instrumentLabel(i.value) }));
    const extra = Object.keys(value.rows)
      .filter((k) => !def.instruments.some((i) => i.value === k))
      .map((k) => ({ key: k, label: k }));
    return [...known, ...extra];
  }, [def.instruments, value.rows, lang]); // lang: Instrument-Namen sind übersetzt

  const hits = Object.values(value.rows).reduce((n, r) => n + r.filter(Boolean).length, 0);

  const onSet = (r: number, s: number, on: boolean) => {
    const key = rows[r]?.key;
    if (!key) return;
    const cur = latest.current;
    const row = Array.from({ length: steps }, (_, i) => cur.rows[key]?.[i] === true);
    if (row[s] === on) return;
    row[s] = on;
    const next: DrumGridValue = { ...cur, rows: { ...cur.rows, [key]: row } };
    latest.current = next;
    onChange(next, true);
  };

  const clear = () => {
    const rowsCleared = Object.fromEntries(Object.keys(value.rows).map((k) => [k, Array<boolean>(steps).fill(false)]));
    onChange({ ...value, rows: rowsCleared }, false);
  };

  return (
    <div className="flex flex-col gap-2">
      <GridToolbar
        title={label}
        hint={paramHint(blockType, def.key) ?? t('ui.grid.drumHint')}
        onClear={hits > 0 ? clear : undefined}
      />
      <StepGrid
        rows={rows}
        steps={steps}
        isOn={(r, s) => value.rows[rows[r]?.key ?? '']?.[s] === true}
        onSet={onSet}
        playhead={playhead}
        activeClass={color.solid}
        label={t('ui.grid.drumLabel', { label })}
        cellLabel={(r, s) => t('ui.grid.cell', { row: rows[r]?.label ?? '', step: s + 1 })}
      />
    </div>
  );
}
