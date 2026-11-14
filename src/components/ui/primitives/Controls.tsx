import { useId, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { ChevronDownIcon } from './Icons';

/** Auswahl-Option mit bereits übersetztem Anzeigetext. */
export interface ChoiceOption {
  value: string;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Segmented Control (Radiogruppe)                                     */
/* ------------------------------------------------------------------ */

export function Segmented({
  label,
  value,
  options,
  onChange,
  hideLabel = true,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (v: string) => void;
  hideLabel?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className={hideLabel ? 'sr-only' : 'mb-1.5 text-sm text-muted'}>{label}</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(4.75rem,1fr))] gap-1 rounded-xl bg-canvas p-1 ring-1 ring-line">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'relative flex min-h-8 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm leading-tight transition-colors',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
              o.value === value ? 'bg-raised font-medium text-fg shadow-sm shadow-black/30' : 'text-muted hover:text-fg',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Select (Dropdown)                                                   */
/* ------------------------------------------------------------------ */

export function SelectBox({
  id,
  value,
  options,
  onChange,
  label,
}: {
  id?: string;
  value: string;
  options: ChoiceOption[];
  onChange: (v: string) => void;
  label?: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <div className="relative">
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer appearance-none rounded-xl border border-line-strong bg-card pr-9 pl-3 text-sm text-fg transition-colors hover:border-faint"
      >
        {!known && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Switch                                                              */
/* ------------------------------------------------------------------ */

export function Switch({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={children ? undefined : label}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2.5 rounded-full text-sm text-fg"
    >
      <span
        className={cx(
          'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full ring-1 transition-colors duration-150',
          checked ? 'bg-accent ring-accent' : 'bg-raised ring-line-strong',
        )}
      >
        <span
          className={cx(
            'absolute size-4.5 rounded-full bg-fg shadow transition-transform duration-150',
            checked ? 'translate-x-[1.1rem] bg-on-accent' : 'translate-x-[0.2rem]',
          )}
        />
      </span>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Tastenkürzel-Darstellung                                           */
/* ------------------------------------------------------------------ */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-line-strong bg-card px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted shadow-[0_1px_0_rgb(255_255_255/0.06)]">
      {children}
    </kbd>
  );
}
