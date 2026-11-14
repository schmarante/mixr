import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { blocksOfKind } from '../../../blocks/catalog';
import { blockDescription, blockLabel, kindDescription, kindLabel } from '../../../blocks/text';
import { useT } from '../../../i18n/react';
import type { BlockDef, BlockKind, BlockType } from '../../../types/ast';
import { cx } from '../lib/cx';
import { InfoIcon, SearchIcon } from '../primitives/Icons';
import { Popover } from '../primitives/Popover';

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

interface BlockPickerProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  kinds: BlockKind[];
  onPick: (type: BlockType) => void;
  title: string;
  /** Hinweis, dass eine vorhandene Quelle ersetzt wird. */
  replacesSource?: boolean;
}

/** Baustein-Auswahl als Popover: gruppiert nach Kategorie, mit Suche und Pfeiltasten-Navigation. */
export function BlockPicker({ open, onClose, anchorRef, kinds, onPick, title, replacesSource = false }: BlockPickerProps) {
  const { t, lang } = useT();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const q = normalize(query.trim());
    return kinds
      .map((kind) => ({
        kind,
        blocks: blocksOfKind(kind).filter(
          (d: BlockDef) =>
            !q || normalize(`${blockLabel(d.type)} ${blockDescription(d.type)} ${d.type} ${kindLabel(kind)}`).includes(q),
        ),
      }))
      .filter((g) => g.blocks.length > 0);
  }, [kinds, query, lang]); // lang: Texte (und damit Suchtreffer) hängen von der Sprache ab

  const close = () => {
    setQuery('');
    onClose();
  };

  const pick = (type: BlockType) => {
    onPick(type);
    close();
  };

  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-picker-item]') ?? []);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[Math.min(all.length - 1, i + 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i <= 0) searchRef.current?.focus();
      else all[i - 1]?.focus();
    }
  };

  const showSearch = kinds.length > 1 || blocksOfKind(kinds[0] ?? 'effect').length > 6;

  return (
    <Popover
      open={open}
      onClose={close}
      anchorRef={anchorRef}
      label={title}
      className="w-[min(24rem,calc(100vw-1.5rem))]"
      initialFocusRef={showSearch ? searchRef : undefined}
    >
      <div className="flex min-h-0 flex-col" data-keep-space onKeyDown={onListKey}>
        <div className="border-b border-line p-3">
          <p className="mb-2 px-1 text-sm font-semibold text-fg">{title}</p>
          {showSearch && (
            <label className="flex h-9 items-center gap-2 rounded-xl bg-canvas px-3 ring-1 ring-line focus-within:ring-accent">
              <SearchIcon size={15} className="text-faint" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const first = groups[0]?.blocks[0];
                    if (first) pick(first.type);
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    items()[0]?.focus();
                    e.stopPropagation();
                  }
                }}
                placeholder={t('ui.picker.searchPlaceholder')}
                aria-label={t('ui.picker.searchLabel')}
                className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none"
              />
            </label>
          )}
          {replacesSource && (
            <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted">
              <InfoIcon size={13} className="shrink-0" /> {t('ui.picker.replacesSource')}
            </p>
          )}
        </div>
        <div ref={listRef} className="min-h-0 overflow-y-auto overscroll-contain p-2">
          {groups.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">{t('ui.picker.noResults')}</p>}
          {groups.map((g) => (
            <section key={g.kind} aria-label={kindLabel(g.kind)} className="mb-1 last:mb-0">
              {kinds.length > 1 && (
                <h3 className="flex items-baseline gap-2 px-2.5 pt-2 pb-1">
                  <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {kindLabel(g.kind)}
                  </span>
                  <span className="text-[11px] text-faint">{kindDescription(g.kind)}</span>
                </h3>
              )}
              {g.blocks.map((d) => (
                <button
                  key={d.type}
                  type="button"
                  data-picker-item
                  onClick={() => pick(d.type)}
                  className={cx(
                    'flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                    'hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-0',
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-lg" aria-hidden="true">
                    {d.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{blockLabel(d.type)}</span>
                    <span className="block text-xs leading-snug text-muted">{blockDescription(d.type)}</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>
    </Popover>
  );
}
