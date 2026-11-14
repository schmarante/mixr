import { useRef, useState, type ReactNode } from 'react';
import { getBlockDef } from '../../../blocks/catalog';
import { blockDescription, blockLabel, kindLabel } from '../../../blocks/text';
import { useT } from '../../../i18n/react';
import { addBlock, removeBlock, selectNode, setBlockBypassed, updateBlockParams } from '../../../store/actions';
import type { BlockNode, ParamDef, ParamValue, TrackNode } from '../../../types/ast';
import { cx } from '../lib/cx';
import { trackColor } from '../lib/trackColors';
import { Switch } from '../primitives/Controls';
import { ChevronDownIcon, SwapIcon, TrashIcon, WarningIcon } from '../primitives/Icons';
import { BlockPicker } from '../workspace/BlockPicker';
import { ParamField } from './fields';
import { SampleSuggestions } from '../samples/SampleSuggestions';

const isGrid = (p: ParamDef) => p.type === 'drumGrid' || p.type === 'noteGrid';

/** Einstellungen eines Bausteins: generisch aus den ParamDefs gerendert. */
export function BlockInspector({
  block,
  track,
  diagnostics,
}: {
  block: BlockNode;
  track: TrackNode | undefined;
  diagnostics: string[];
}) {
  const { t } = useT();
  const def = getBlockDef(block.type);
  const color = trackColor(track?.params.color);
  const bypassed = block.bypassed === true;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const swapRef = useRef<HTMLButtonElement>(null);

  const grids = def.params.filter((p) => !p.advanced && isGrid(p));
  const basic = def.params.filter((p) => !p.advanced && !isGrid(p));
  const advanced = def.params.filter((p) => p.advanced);

  const change = (key: string) => (value: ParamValue, coalesce: boolean) =>
    updateBlockParams(block.id, { [key]: value }, coalesce);

  const renderField = (p: ParamDef) =>
    p.type === 'text' ? (
      // Text/Code braucht Breite
      <div key={p.key} className="min-w-0 sm:col-span-2">
        <ParamField def={p} block={block} onChange={change(p.key)} color={color} />
      </div>
    ) : (
      <ParamField key={p.key} def={p} block={block} onChange={change(p.key)} color={color} />
    );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl', color.soft)} aria-hidden="true">
            {def.icon}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-lg font-semibold text-fg">{blockLabel(block.type)}</h2>
              <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-muted">
                {kindLabel(def.kind)}
              </span>
              {track && (
                <button
                  type="button"
                  onClick={() => selectNode(track.id)}
                  className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
                  title={t('ui.inspector.openTrack')}
                >
                  <span className={cx('size-2 rounded-full', color.solid)} aria-hidden="true" />
                  {track.params.name}
                </button>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted">{blockDescription(block.type)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={!bypassed} onChange={(on) => setBlockBypassed(block.id, !on)} label={t('ui.inspector.blockActive')}>
            <span className="text-muted">{bypassed ? t('common.off') : t('common.on')}</span>
          </Switch>
          {def.kind === 'source' && track && (
            <>
              <button
                ref={swapRef}
                type="button"
                onClick={() => setSwapOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={swapOpen}
                className="ml-1 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted ring-1 ring-line transition-colors hover:bg-hover hover:text-fg"
              >
                <SwapIcon size={15} />
                {t('ui.inspector.swapSound')}
              </button>
              <BlockPicker
                open={swapOpen}
                onClose={() => setSwapOpen(false)}
                anchorRef={swapRef}
                kinds={['source']}
                title={t('ui.inspector.swapSoundTitle')}
                replacesSource
                onPick={(type) => selectNode(addBlock(track.id, type))}
              />
            </>
          )}
          <button
            type="button"
            onClick={() => removeBlock(block.id)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger"
            title={t('ui.inspector.removeTooltip', { key: t('common.keys.delete') })}
          >
            <TrashIcon size={15} />
            <span className="hidden sm:inline">{t('ui.inspector.remove')}</span>
          </button>
        </div>
      </header>

      {diagnostics.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
          {diagnostics.map((d) => (
            <li key={d} className="flex items-start gap-2">
              <WarningIcon size={15} className="mt-0.5 shrink-0" />
              {d}
            </li>
          ))}
        </ul>
      )}

      {def.params.length === 0 && (
        <p className="text-sm text-muted">{t('ui.inspector.noParams')}</p>
      )}

      {block.type === 'sample' && <SampleSuggestions block={block} />}

      {grids.length > 0 ? (
        // Raster brauchen Breite: auf breiten Panels stehen die übrigen Regler daneben
        <div className={cx('@container', bypassed && 'opacity-60')}>
          <div className="flex flex-col gap-6 @5xl:flex-row @5xl:items-start @5xl:gap-10">
            <div className="flex min-w-0 flex-1 flex-col gap-6">{grids.map(renderField)}</div>
            {(basic.length > 0 || advanced.length > 0) && (
              <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 @5xl:w-80 @5xl:shrink-0 @5xl:grid-cols-1 @5xl:border-l @5xl:border-line @5xl:pl-8">
                {basic.map(renderField)}
                {advanced.length > 0 && (
                  <Advanced open={showAdvanced} onToggle={() => setShowAdvanced((v) => !v)} count={advanced.length} narrow>
                    {advanced.map(renderField)}
                  </Advanced>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={cx('flex flex-col gap-6', bypassed && 'opacity-60')}>
          {basic.length > 0 && (
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">{basic.map(renderField)}</div>
          )}
          {advanced.length > 0 && (
            <Advanced open={showAdvanced} onToggle={() => setShowAdvanced((v) => !v)} count={advanced.length}>
              {advanced.map(renderField)}
            </Advanced>
          )}
        </div>
      )}
    </div>
  );
}

/** „Mehr Optionen“ – eingeklappte Profi-Parameter. */
function Advanced({
  open,
  onToggle,
  count,
  narrow = false,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  count: number;
  narrow?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4 sm:col-span-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-fit items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-muted transition-colors hover:text-fg"
      >
        <ChevronDownIcon size={16} className={cx('transition-transform duration-150', !open && '-rotate-90')} />
        {t('ui.inspector.moreOptions')}
        <span className="text-xs font-normal text-faint">({count})</span>
      </button>
      {open && (
        <div
          className={cx(
            'grid gap-x-8 gap-y-5 border-l border-line pl-5 motion-safe:animate-fade-in',
            narrow ? 'sm:grid-cols-2 @5xl:grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-4',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
