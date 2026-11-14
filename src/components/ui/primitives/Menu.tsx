import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { IconButton } from './IconButton';
import { MoreIcon } from './Icons';
import { Popover } from './Popover';

export interface MenuItem {
  /** Stabiler Schlüssel (Label ändert sich beim Sprachwechsel). */
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** „⋯“-Menü mit Tastaturnavigation (Pfeiltasten, Esc). */
export function OverflowMenu({ label, items, size = 'sm' }: { label: string; items: MenuItem[]; size?: 'xs' | 'sm' }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      btns[(i + 1) % btns.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i - 1 + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <IconButton
        label={label}
        size={size}
        buttonRef={anchorRef}
        expanded={open}
        hasPopup="menu"
        tooltip={open ? false : 'left'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreIcon size={size === 'xs' ? 14 : 18} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} label={label} role="menu" align="end">
        <div ref={listRef} onKeyDown={onKeyDown} className="flex min-w-52 flex-col p-1.5" data-keep-space>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-35',
                item.danger ? 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft' : 'text-fg hover:bg-hover focus-visible:bg-hover',
              )}
            >
              <span className="flex size-4 items-center justify-center text-muted">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-xs text-faint">{item.hint}</span>}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
