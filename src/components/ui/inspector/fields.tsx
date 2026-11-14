import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { optionLabel, paramHint, paramLabel, paramPlaceholder, paramUnit } from '../../../blocks/text';
import type { TKey } from '../../../i18n';
import { useT } from '../../../i18n/react';
import type {
  BlockNode,
  BlockType,
  NumberParamDef,
  ParamDef,
  ParamValue,
  SelectParamDef,
  TextParamDef,
  ToggleParamDef,
} from '../../../types/ast';
import { cx } from '../lib/cx';
import {
  boolValue,
  decimalSeparator,
  formatNumber,
  isDefaultValue,
  isDrumGridValue,
  isNoteGridValue,
  isPercentParam,
  numberValue,
  roundToStep,
  stringValue,
} from '../lib/params';
import type { TrackColorClasses } from '../lib/trackColors';
import { Segmented, SelectBox, Switch } from '../primitives/Controls';
import { ExternalIcon, ResetIcon } from '../primitives/Icons';
import { Slider } from '../primitives/Slider';
import { requestStop } from '../lib/transport';
import { DrumGridEditor } from './DrumGridEditor';
import { NoteGridEditor } from './NoteGridEditor';

export type ParamChange = (value: ParamValue, coalesce: boolean) => void;

/** Code-Editor (CodeMirror) als eigener Chunk – bis er geladen ist, tut es das Textfeld. */
const StrudelEditor = lazy(() => import('../editor/StrudelEditor'));

function FieldShell({
  label,
  htmlFor,
  hint,
  aside,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string | undefined;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-xs leading-snug text-faint">{hint}</p>}
    </div>
  );
}

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('ui.fields.reset', { label })}
      title={t('ui.fields.resetTooltip')}
      className="flex size-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg"
    >
      <ResetIcon size={13} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Zahl                                                                */
/* ------------------------------------------------------------------ */

/** Gemeinsame Props der Felder: Definition (Struktur) + Blocktyp (für die Texte). */
interface FieldProps<D> {
  def: D;
  type: BlockType;
  value: ParamValue | undefined;
  onChange: ParamChange;
}

function NumberField({ def, type, value, onChange }: FieldProps<NumberParamDef>) {
  const { t } = useT();
  const label = paramLabel(type, def.key);
  const unit = paramUnit(type, def.key);
  const v = numberValue(def, value);
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const percent = isPercentParam(def);
  const isDefault = isDefaultValue(def, value);

  const startEdit = () => {
    setDraft(String(percent ? Math.round(v * 100) : v).replace('.', decimalSeparator()));
    setEditing(true);
  };
  const commit = () => {
    const n = Number.parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(n)) {
      const next = roundToStep(percent ? n / 100 : n, def);
      if (next !== v) onChange(next, false);
    }
    setEditing(false);
  };

  return (
    <FieldShell
      label={label}
      hint={paramHint(type, def.key)}
      aside={
        <span className="flex items-center gap-1">
          {!isDefault && <ResetButton label={label} onClick={() => onChange(def.default, false)} />}
          {editing ? (
            <input
              id={id}
              autoFocus
              inputMode="decimal"
              value={draft}
              aria-label={
                percent
                  ? t('ui.fields.enterPercent', { label })
                  : unit
                    ? t('ui.fields.enterUnit', { label, unit })
                    : t('ui.fields.enter', { label })
              }
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              className="h-7 w-20 rounded-md bg-canvas px-2 text-right font-mono text-xs text-fg ring-1 ring-accent outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              title={t('ui.fields.clickToType')}
              className="h-7 rounded-md px-2 font-mono text-xs text-muted tabular-nums transition-colors hover:bg-hover hover:text-fg"
            >
              {formatNumber(type, def, v)}
            </button>
          )}
        </span>
      }
    >
      <Slider
        label={label}
        value={v}
        min={def.min}
        max={def.max}
        step={def.step}
        log={def.log}
        valueText={formatNumber(type, def, v)}
        onChange={(n, c) => onChange(n, c)}
        onReset={() => onChange(def.default, false)}
      />
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */
/* Auswahl                                                             */
/* ------------------------------------------------------------------ */

/** Zerlegt „Modern (House, Techno)“ bzw. „Moll – melancholisch“ in Kurzlabel + Detail. */
function splitLabel(label: string): { short: string; detail: string } {
  const dash = label.indexOf(' – ');
  if (dash > 0) return { short: label.slice(0, dash), detail: label.slice(dash + 3) };
  const m = label.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) return { short: m[1]!, detail: m[2]! };
  return { short: label, detail: '' };
}

function SelectField({ def, type, value, onChange }: FieldProps<SelectParamDef>) {
  useT();
  const v = stringValue(def, value);
  const id = useId();
  const label = paramLabel(type, def.key);
  const hint = paramHint(type, def.key);
  const options = def.options.map((o) => ({ value: o.value, label: optionLabel(type, def.key, o.value) }));
  if (options.length <= 4) {
    const opts = options.map((o) => ({ value: o.value, label: splitLabel(o.label).short }));
    const detail = splitLabel(options.find((o) => o.value === v)?.label ?? '').detail;
    return (
      <FieldShell label={label} hint={hint}>
        <Segmented label={label} value={v} options={opts} onChange={(n) => onChange(n, false)} />
        {detail && <p className="text-xs text-faint">{detail}</p>}
      </FieldShell>
    );
  }
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <SelectBox id={id} value={v} options={options} onChange={(n) => onChange(n, false)} />
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */
/* Text / Code                                                         */
/* ------------------------------------------------------------------ */

const SYNTAX_INFO: Record<TextParamDef['syntax'], { label: TKey; href: string } | null> = {
  mini: { label: 'ui.fields.syntaxMini', href: 'https://strudel.cc/learn/mini-notation/' },
  code: { label: 'ui.fields.syntaxCode', href: 'https://strudel.cc/workshop/getting-started/' },
  plain: null,
};

function TextField({ def, type, value, onChange }: FieldProps<TextParamDef>) {
  const { t } = useT();
  const v = stringValue(def, value);
  const id = useId();
  const [draft, setDraft] = useState(v);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Externe Änderungen (Undo, anderer Block) übernehmen, solange nicht getippt wird
  useEffect(() => {
    if (!focused.current) setDraft(v);
  }, [v]);

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) {
      const text = pending.current;
      pending.current = null;
      onChangeRef.current(text, true);
    }
  };
  // Beim Verlassen ausstehende Eingabe noch speichern
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null) onChangeRef.current(pending.current, true);
    },
    [],
  );

  const info = SYNTAX_INFO[def.syntax];
  const mono = def.syntax !== 'plain';
  // Strudel-Code → Code-Editor; Name des „Beliebigen Parameters“ → einzeilig mit Control-Vorschlägen
  const editorKind = def.syntax === 'code' ? 'code' : type === 'param' && def.key === 'name' ? 'controls' : null;

  const change = (text: string) => {
    setDraft(text);
    pending.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 350);
  };

  const textarea = (
    <textarea
      id={id}
      value={draft}
      rows={def.syntax === 'code' ? 3 : editorKind === 'controls' ? 1 : 2}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      placeholder={paramPlaceholder(type, def.key)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        flush();
      }}
      onChange={(e) => change(e.target.value)}
      className={cx(
        'field-sizing-content max-h-48 min-h-10 w-full resize-y rounded-xl border border-line-strong bg-canvas px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-faint',
        'transition-colors hover:border-faint focus:border-accent focus:outline-none',
        mono && 'font-mono text-[13px]',
      )}
    />
  );

  return (
    <FieldShell
      label={paramLabel(type, def.key)}
      htmlFor={id}
      hint={paramHint(type, def.key)}
      aside={
        info && (
          <a
            href={info.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-faint transition-colors hover:bg-hover hover:text-fg"
            title={t('ui.fields.syntaxTooltip', { name: t(info.label) })}
          >
            {t(info.label)}
            <ExternalIcon size={11} />
          </a>
        )
      }
    >
      {editorKind ? (
        <Suspense fallback={textarea}>
          <StrudelEditor
            id={id}
            variant={editorKind === 'controls' ? 'line' : 'compact'}
            completion={editorKind}
            value={draft}
            ariaLabel={paramLabel(type, def.key)}
            placeholder={paramPlaceholder(type, def.key)}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false;
              flush();
            }}
            onCommit={flush}
            onStop={requestStop}
            onChange={change}
          />
        </Suspense>
      ) : (
        textarea
      )}
    </FieldShell>
  );
}

/* ------------------------------------------------------------------ */
/* Schalter                                                            */
/* ------------------------------------------------------------------ */

function ToggleField({ def, type, value, onChange }: FieldProps<ToggleParamDef>) {
  useT();
  const v = boolValue(def, value);
  const label = paramLabel(type, def.key);
  const hint = paramHint(type, def.key);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Switch checked={v} onChange={(n) => onChange(n, false)} label={label}>
        <span className="font-medium">{label}</span>
      </Switch>
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

export function ParamField({
  def,
  block,
  onChange,
  color,
}: {
  def: ParamDef;
  block: BlockNode;
  onChange: ParamChange;
  color: TrackColorClasses;
}) {
  const value = block.params[def.key];
  switch (def.type) {
    case 'number':
      return <NumberField def={def} type={block.type} value={value} onChange={onChange} />;
    case 'select':
      return <SelectField def={def} type={block.type} value={value} onChange={onChange} />;
    case 'text':
      return <TextField def={def} type={block.type} value={value} onChange={onChange} />;
    case 'toggle':
      return <ToggleField def={def} type={block.type} value={value} onChange={onChange} />;
    case 'drumGrid':
      return (
        <DrumGridEditor
          def={def}
          blockType={block.type}
          blockId={block.id}
          value={isDrumGridValue(value) ? value : def.default}
          onChange={onChange}
          color={color}
        />
      );
    case 'noteGrid':
      return (
        <NoteGridEditor
          def={def}
          value={isNoteGridValue(value) ? value : def.default}
          block={block}
          onChange={onChange}
          color={color}
        />
      );
  }
}
