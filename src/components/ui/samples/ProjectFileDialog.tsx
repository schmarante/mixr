import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';
import { useT } from '../../../i18n/react';
import { resolvedTracks } from '../../../store/agentBus';
import { resolveTracks } from '../../../store/selectors';
import { cx } from '../lib/cx';
import { modKey } from '../lib/platform';
import { trackColor } from '../lib/trackColors';
import { applyPendingProject, pendingProject } from '../lib/projectFiles';
import { Switch } from '../primitives/Controls';
import { IconButton } from '../primitives/IconButton';
import { CloseIcon, ImportIcon, InfoIcon, PlusIcon, WarningIcon } from '../primitives/Icons';
import { autoplayPref } from '../shared/StartOptions';

/** Dialog „Projekt öffnen“ für mixr.json / Projekt-ZIP: ersetzen oder hinzufügen. */
export function ProjectFileDialog() {
  const { t } = useT();
  const pending = useStore(pendingProject);
  const autoplay = useStore(autoplayPref);
  const hasProject = useStore(resolvedTracks).length > 0;
  const ref = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const open = pending !== null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      primaryRef.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => pendingProject.set(null);
  const tracks = pending ? resolveTracks(pending.project.ast) : [];
  const slots = pending?.project.settings.samples ?? [];
  const sections = pending?.project.ast.arrangement?.sections.length ?? 0;

  return (
    <dialog
      ref={ref}
      aria-labelledby="project-file-title"
      onClose={close}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto max-h-[min(88dvh,44rem)] w-[min(34rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-line-strong bg-panel p-0 text-fg shadow-2xl shadow-black/70 backdrop:bg-black/60 open:motion-safe:animate-slide-up"
    >
      {pending && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div className="min-w-0">
              <h2 id="project-file-title" className="text-lg font-semibold">
                {t('ui.projectFile.openTitle')}
              </h2>
              <p className="mt-0.5 truncate text-sm text-muted">{pending.name}</p>
            </div>
            <IconButton label={t('common.close')} onClick={close} tooltip="left" kbd={t('common.keys.esc')}>
              <CloseIcon />
            </IconButton>
          </header>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
            <p className="text-sm text-muted">
              {[
                t('ui.import.preview.trackCount', { count: tracks.length }),
                `${pending.project.settings.bpm} BPM`,
                slots.length > 0 ? t('ui.projectFile.toast.samples', { count: slots.length }) : null,
                sections > 0 ? t('ui.song.sectionCount', { count: sections }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <ul className="flex flex-col gap-1.5">
              {tracks.slice(0, 8).map((rt) => (
                <li key={rt.track.id} className="flex items-center gap-2 text-sm text-fg">
                  <span className={cx('h-4 w-1.5 rounded-full', trackColor(rt.track.params.color).solid)} aria-hidden="true" />
                  {rt.track.params.name}
                </li>
              ))}
              {tracks.length > 8 && <li className="text-xs text-faint">{t('ui.projectFile.more', { count: tracks.length - 8 })}</li>}
            </ul>
            {slots.length > 0 && (
              <p className="flex flex-wrap gap-1">
                {slots.map((s) => (
                  <span key={s.id} className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[11px] text-code-fn ring-1 ring-line">
                    {s.name}
                  </span>
                ))}
              </p>
            )}
            {pending.missing > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-fg">
                <WarningIcon size={15} className="mt-0.5 shrink-0 text-warn" />
                {t('ui.projectFile.missingHint', { count: pending.missing })}
              </p>
            )}
          </div>
          <footer className="flex flex-col gap-3 border-t border-line px-6 py-4">
            <div className="flex flex-col gap-1.5">
              <Switch checked={autoplay} onChange={(v) => autoplayPref.set(v)} label={t('ui.start.autoplay')}>
                <span className="text-muted">{t('ui.start.autoplay')}</span>
              </Switch>
              {hasProject && (
                <p className="flex items-start gap-1.5 text-xs text-faint">
                  <InfoIcon size={13} className="mt-px shrink-0" />
                  {t('ui.import.replaceNotice', { shortcut: `${modKey()}+Z` })}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {hasProject && (
                <button
                  type="button"
                  onClick={() => applyPendingProject('append', autoplay)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-card px-4 text-sm font-medium text-fg ring-1 ring-line-strong transition-colors hover:bg-raised"
                >
                  <PlusIcon size={16} />
                  {t('ui.import.addToProject')}
                </button>
              )}
              <button
                ref={primaryRef}
                type="button"
                onClick={() => applyPendingProject('replace', autoplay)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
              >
                <ImportIcon size={16} />
                {t('ui.import.openAsNew')}
              </button>
            </div>
          </footer>
        </div>
      )}
    </dialog>
  );
}
