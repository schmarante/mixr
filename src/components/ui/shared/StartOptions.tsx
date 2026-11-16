import { useStore } from '@nanostores/react';
import { atom } from 'nanostores';
import { TRACK_COLORS, blocksOfKind, defaultParams } from '../../../blocks/catalog';
import { blockDescription, blockLabel, templateDescription, templateName } from '../../../blocks/text';
import { TEMPLATES, templateProject, type ProjectTemplate } from '../../../data/templates';
import type { TKey } from '../../../i18n';
import { useT } from '../../../i18n/react';
import { playbackState } from '../../../store/agentBus';
import { loadProject, newId, selectNode } from '../../../store/actions';
import type { BlockType } from '../../../types/ast';
import { isTrackNode } from '../../../types/ast';
import { cx } from '../lib/cx';
import { openImport } from '../lib/importFlow';
import { modKey } from '../lib/platform';
import { rich } from '../lib/rich';
import { requestPlay } from '../lib/transport';
import { Kbd, Switch } from '../primitives/Controls';
import { ChevronRightIcon, ImportIcon, PlayIcon } from '../primitives/Icons';

/** „Direkt abspielen“ beim Laden einer Vorlage – geteilt zwischen Start-Seite und Dialog. */
export const autoplayPref = atom(true);

/** Ersetzt das Projekt durch eine einzelne Spur mit der gewählten Klangquelle (ein Undo-Schritt). */
export function startWithSource(type: BlockType): void {
  const trackId = newId('track');
  const blockId = newId('block');
  loadProject({
    nodes: [
      {
        id: trackId,
        type: 'track',
        params: { name: `${blockLabel(type)} 1`, color: TRACK_COLORS[0]!, volume: 0.8, muted: false, solo: false },
      },
      { id: blockId, type, params: defaultParams(type) },
    ],
    edges: [{ id: `e-${trackId}-${blockId}`, source: trackId, target: blockId }],
  });
  selectNode(blockId);
}

/** Lädt eine Vorlage (Texte wie Spurnamen in der aktuellen Sprache). */
export function loadTemplate(id: string, autoplay: boolean): void {
  const project = templateProject(id);
  if (!project) return;
  loadProject(project.ast, project.settings);
  // synchron im Klick-Handler → gültige User-Geste für den AudioContext
  if (autoplay && !playbackState.get().isPlaying) requestPlay();
}

function TemplateCard({ tpl, onPick }: { tpl: ProjectTemplate; onPick: (id: string) => void }) {
  const { t } = useT();
  const tracks = tpl.ast.nodes.filter(isTrackNode).length;
  return (
    <button
      type="button"
      onClick={() => onPick(tpl.id)}
      className={cx(
        'group relative flex h-full flex-col gap-2 rounded-2xl border border-line bg-card p-4 text-left transition-all duration-150',
        'hover:-translate-y-0.5 hover:border-line-strong hover:bg-raised hover:shadow-xl hover:shadow-black/30',
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-3xl leading-none" aria-hidden="true">
          {tpl.icon}
        </span>
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <PlayIcon size={14} />
        </span>
      </span>
      <span className="font-semibold text-fg">{templateName(tpl.id)}</span>
      <span className="text-sm leading-snug text-muted">{templateDescription(tpl.id)}</span>
      <span className="mt-auto pt-1 text-xs text-faint">
        {t('ui.start.trackCount', { count: tracks })} · {tpl.settings.bpm} BPM
      </span>
    </button>
  );
}

const SOURCE_HINTS: Partial<Record<BlockType, TKey>> = {
  drums: 'ui.start.sourceHints.drums',
  melody: 'ui.start.sourceHints.melody',
  chords: 'ui.start.sourceHints.chords',
  sample: 'ui.start.sourceHints.sample',
  code: 'ui.start.sourceHints.code',
};

/**
 * Startoptionen: Vorlagen (falls vorhanden) + „Leer starten“ mit Quellen-Schnellwahl
 * + „Code importieren“ (fremder Strudel-Code → editierbares Projekt).
 * Wird auf dem Startbildschirm und im „Neu/Vorlagen“-Dialog verwendet.
 */
export function StartOptions({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { t } = useT();
  const autoplay = useStore(autoplayPref);
  const sources = blocksOfKind('source');
  const hasTemplates = TEMPLATES.length > 0;

  return (
    <div className="flex flex-col gap-8">
      {hasTemplates && (
        <section aria-labelledby="start-templates" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="start-templates" className="text-base font-semibold text-fg">
                {t('ui.start.templatesHeading')}
              </h2>
              <p className="text-sm text-muted">{t('ui.start.templatesText')}</p>
            </div>
            <Switch checked={autoplay} onChange={(v) => autoplayPref.set(v)} label={t('ui.start.autoplay')}>
              <span className="text-muted">{t('ui.start.autoplay')}</span>
            </Switch>
          </div>
          <div className={cx('grid gap-3', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')}>
            {TEMPLATES.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                tpl={tpl}
                onPick={(id) => {
                  loadTemplate(id, autoplay);
                  onDone?.();
                }}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="start-empty" className="flex flex-col gap-3">
        <div>
          <h2 id="start-empty" className="text-base font-semibold text-fg">
            {hasTemplates ? t('ui.start.emptyHeadingOr') : t('ui.start.emptyHeading')}
          </h2>
          <p className="text-sm text-muted">{t('ui.start.emptyText')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {sources.map((def) => {
            const hintKey = SOURCE_HINTS[def.type];
            return (
              <button
                key={def.type}
                type="button"
                onClick={() => {
                  startWithSource(def.type);
                  onDone?.();
                }}
                title={blockDescription(def.type)}
                className="glass relative group flex flex-col items-start gap-1.5 rounded-2xl border border-dashed border-line-strong bg-panel p-3.5 text-left transition-colors hover:border-accent/60 hover:bg-card"
              >
                <span className="text-2xl leading-none transition-transform group-hover:scale-110" aria-hidden="true">
                  {def.icon}
                </span>
                <span className="text-sm font-semibold text-fg">{blockLabel(def.type)}</span>
                <span className="text-xs text-muted">{hintKey ? t(hintKey) : blockDescription(def.type)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="start-import" className="flex flex-col gap-3">
        <div>
          <h2 id="start-import" className="text-base font-semibold text-fg">
            {t('ui.import.start.heading')}
          </h2>
          <p className="text-sm text-muted">{t('ui.import.start.text')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              onDone?.();
              openImport();
            }}
            className="group flex items-center gap-3 rounded-2xl border border-line bg-card py-3 pr-4 pl-3.5 text-left transition-colors hover:border-line-strong hover:bg-raised"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <ImportIcon size={18} />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-fg">{t('ui.import.start.button')}</span>
              <span className="text-xs text-muted">{t('ui.import.start.buttonHint')}</span>
            </span>
            <ChevronRightIcon size={16} className="ml-2 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
          </button>
          {!compact && (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-faint">
              {rich(t('ui.import.start.pasteTip'), { key: <Kbd>{`${modKey()}+V`}</Kbd> })}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
