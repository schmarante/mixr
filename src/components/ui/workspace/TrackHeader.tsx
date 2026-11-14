import { useEffect, useRef, useState } from 'react';
import { t } from '../../../i18n';
import { useT } from '../../../i18n/react';
import { duplicateTrack, moveTrack, removeTrack, selectNode, updateTrack } from '../../../store/actions';
import type { TrackNode } from '../../../types/ast';
import { cx } from '../lib/cx';
import { formatPercent } from '../lib/params';
import type { TrackColorClasses } from '../lib/trackColors';
import { OverflowMenu } from '../primitives/Menu';
import { ArrowDownIcon, ArrowUpIcon, DuplicateIcon, PencilIcon, TrashIcon } from '../primitives/Icons';
import { Slider } from '../primitives/Slider';

interface TrackHeaderProps {
  track: TrackNode;
  index: number;
  count: number;
  selected: boolean;
  color: TrackColorClasses;
}

/** Inline umbenennbarer Spurname (Doppelklick oder Menü „Umbenennen“). */
function TrackName({ track, editing, setEditing }: { track: TrackNode; editing: boolean; setEditing: (v: boolean) => void }) {
  useT();
  const [draft, setDraft] = useState(track.params.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(track.params.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, track.params.name]);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== track.params.name) updateTrack(track.id, { name });
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        maxLength={40}
        aria-label={t('ui.track.nameInput')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className="h-7 w-full min-w-0 rounded-md bg-canvas px-1.5 text-sm font-semibold text-fg ring-1 ring-accent outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => selectNode(track.id)}
      onDoubleClick={() => setEditing(true)}
      title={t('ui.track.nameTooltip')}
      className="h-7 min-w-0 flex-1 truncate rounded-md px-1.5 text-left text-sm font-semibold text-fg hover:bg-hover"
    >
      {track.params.name}
    </button>
  );
}

function ToggleChip({
  label,
  short,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  short: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold transition-colors',
        active ? activeClass : 'bg-raised text-faint hover:bg-hover hover:text-fg',
      )}
    >
      {short}
    </button>
  );
}

/** Kopf eines Kanalzugs: Farbe, Name, Stumm/Solo, Lautstärke, Menü. */
export function TrackHeader({ track, index, count, selected, color }: TrackHeaderProps) {
  useT();
  const [editing, setEditing] = useState(false);
  const p = track.params;
  const alt = t('common.keys.alt');

  return (
    <div
      data-node-id={track.id}
      onClick={(e) => {
        if (e.target === e.currentTarget) selectNode(track.id);
      }}
      className={cx(
        'relative flex shrink-0 flex-col justify-center gap-1 py-2.5 pr-2.5 pl-4 @3xl:w-60',
        selected ? color.soft : '',
      )}
    >
      <div className="flex items-center gap-1">
        <TrackName track={track} editing={editing} setEditing={setEditing} />
        <OverflowMenu
          label={t('ui.track.menu', { name: p.name })}
          items={[
            { id: 'rename', label: t('ui.track.rename'), icon: <PencilIcon size={15} />, onSelect: () => setEditing(true) },
            { id: 'duplicate', label: t('ui.track.duplicate'), icon: <DuplicateIcon size={15} />, onSelect: () => duplicateTrack(track.id) },
            {
              id: 'up',
              label: t('ui.track.moveUp'),
              icon: <ArrowUpIcon size={15} />,
              onSelect: () => moveTrack(track.id, index - 1),
              disabled: index === 0,
              hint: `${alt}+↑`,
            },
            {
              id: 'down',
              label: t('ui.track.moveDown'),
              icon: <ArrowDownIcon size={15} />,
              onSelect: () => moveTrack(track.id, index + 1),
              disabled: index >= count - 1,
              hint: `${alt}+↓`,
            },
            { id: 'delete', label: t('ui.track.delete'), icon: <TrashIcon size={15} />, onSelect: () => removeTrack(track.id), danger: true },
          ]}
        />
      </div>
      <div className="flex items-center gap-1.5 pl-1">
        <ToggleChip
          label={p.muted ? t('ui.track.unmute') : t('ui.track.mute')}
          short={t('ui.track.muteShort')}
          active={p.muted}
          activeClass="bg-warn text-canvas"
          onClick={() => updateTrack(track.id, { muted: !p.muted })}
        />
        <ToggleChip
          label={p.solo ? t('ui.track.unsolo') : t('ui.track.solo')}
          short={t('ui.track.soloShort')}
          active={p.solo}
          activeClass="bg-ok text-canvas"
          onClick={() => updateTrack(track.id, { solo: !p.solo })}
        />
        <Slider
          className="ml-1 min-w-0 flex-1"
          size="sm"
          label={t('ui.track.volumeOf', { name: p.name })}
          value={p.volume}
          min={0}
          max={1}
          step={0.01}
          valueText={formatPercent(p.volume)}
          fillClass={color.solid}
          onChange={(v, c) => updateTrack(track.id, { volume: v }, c)}
          onReset={() => updateTrack(track.id, { volume: 0.8 })}
        />
        <span className="w-9 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums" aria-hidden="true">
          {formatPercent(p.volume)}
        </span>
      </div>
    </div>
  );
}
