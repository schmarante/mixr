import { useStore } from '@nanostores/react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '../../../i18n/react';
import { projectSettings } from '../../../store/agentBus';
import { setBpm } from '../../../store/actions';
import { cx } from '../lib/cx';
import { IconButton } from '../primitives/IconButton';
import { MinusIcon, PlusIcon } from '../primitives/Icons';

const MIN = 40;
const MAX = 220;

/**
 * Tempo-Regler: Zahl mit −/+; Zahl lässt sich hoch/runter ziehen,
 * per Klick direkt eintippen und per Pfeiltasten verändern.
 */
export function BpmControl() {
  const { t } = useT();
  const bpm = useStore(projectSettings).bpm;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const drag = useRef<{ y: number; start: number; moved: boolean } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, start: bpm, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setBpm(d.start + Math.round(dy / 3), true);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      setDraft(String(bpm));
      setEditing(true);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey ? 10 : 1;
    const map: Record<string, number> = { ArrowUp: big, ArrowRight: big, ArrowDown: -big, ArrowLeft: -big, PageUp: 10, PageDown: -10 };
    const delta = map[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      setBpm(bpm + delta, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setDraft(String(bpm));
      setEditing(true);
    }
  };

  const commitDraft = () => {
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n) && n !== bpm) setBpm(n, false);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-card p-1 ring-1 ring-line">
      <IconButton label={t('ui.bpm.slower')} size="xs" onClick={() => setBpm(bpm - 1, true)} disabled={bpm <= MIN}>
        <MinusIcon size={14} />
      </IconButton>
      {editing ? (
        <input
          autoFocus
          aria-label={t('ui.bpm.input')}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          className="h-8 w-14 rounded-lg bg-canvas text-center font-mono text-base font-semibold text-fg tabular-nums ring-1 ring-accent outline-none"
        />
      ) : (
        <div
          role="spinbutton"
          tabIndex={0}
          aria-label={t('ui.bpm.label')}
          aria-valuenow={bpm}
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuetext={`${bpm} BPM`}
          title={t('ui.bpm.dragTitle')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
          className={cx(
            'flex h-8 w-14 cursor-ns-resize touch-none select-none flex-col items-center justify-center rounded-lg leading-none hover:bg-hover',
          )}
        >
          <span className="font-mono text-base font-semibold text-fg tabular-nums">{bpm}</span>
          <span className="text-[9px] font-medium tracking-wider text-faint">BPM</span>
        </div>
      )}
      <IconButton label={t('ui.bpm.faster')} size="xs" onClick={() => setBpm(bpm + 1, true)} disabled={bpm >= MAX}>
        <PlusIcon size={14} />
      </IconButton>
    </div>
  );
}
