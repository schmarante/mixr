import type { ReactNode } from 'react';
import type { ImportNote, ImportNoteKind, ImportResult } from '../../../agents/importer';
import { getBlockDef } from '../../../blocks/catalog';
import { blockLabel } from '../../../blocks/text';
import type { TKey } from '../../../i18n';
import { useT } from '../../../i18n/react';
import { resolveTracks } from '../../../store/selectors';
import { isTrackNode, type TrackColor } from '../../../types/ast';
import { cx } from '../lib/cx';
import type { ImportAnalysis } from '../lib/importFlow';
import { preludeNames, preludePreview } from '../lib/prelude';
import { trackColor } from '../lib/trackColors';
import { ChevronRightIcon, CodeIcon, InfoIcon, MinusIcon, SwapIcon, CheckIcon } from '../primitives/Icons';

/* ------------------------------------------------------------------ */
/* Hinweise                                                            */
/* ------------------------------------------------------------------ */

interface GroupDef {
  kind: ImportNoteKind;
  title: TKey;
  hint: TKey;
  icon: ReactNode;
  /** Standardmäßig aufgeklappt? */
  open: boolean;
}

/** Reihenfolge = Wichtigkeit für den Nutzer. */
const GROUPS: GroupDef[] = [
  { kind: 'substituted', title: 'ui.import.notes.substituted', hint: 'ui.import.notes.substitutedHint', icon: <SwapIcon size={15} />, open: true },
  { kind: 'keptAsCode', title: 'ui.import.notes.keptAsCode', hint: 'ui.import.notes.keptAsCodeHint', icon: <CodeIcon size={15} />, open: true },
  { kind: 'dropped', title: 'ui.import.notes.dropped', hint: 'ui.import.notes.droppedHint', icon: <MinusIcon size={15} />, open: true },
  { kind: 'converted', title: 'ui.import.notes.converted', hint: 'ui.import.notes.convertedHint', icon: <CheckIcon size={15} />, open: false },
  { kind: 'info', title: 'ui.import.notes.info', hint: 'ui.import.notes.infoHint', icon: <InfoIcon size={15} />, open: false },
];

function NoteGroups({ notes, colorOf }: { notes: ImportNote[]; colorOf: (name: string) => TrackColor | undefined }) {
  const { t } = useT();
  const groups = GROUPS.map((g) => ({ ...g, items: notes.filter((n) => n.kind === g.kind) })).filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;

  return (
    <section aria-labelledby="import-notes-heading" className="flex flex-col gap-2">
      <h3 id="import-notes-heading" className="text-xs font-semibold tracking-wide text-faint uppercase">
        {t('ui.import.notes.heading')}
      </h3>
      <div className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card/60">
        {groups.map((g) => (
          <details key={g.kind} open={g.open} className="group/notes">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm select-none hover:bg-hover/40 [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon size={14} className="shrink-0 text-faint transition-transform group-open/notes:rotate-90" />
              <span className="shrink-0 text-muted">{g.icon}</span>
              <span className="min-w-0 flex-1 font-medium text-fg">{t(g.title)}</span>
              <span className="rounded-full bg-raised px-2 py-0.5 text-xs text-muted tabular-nums">{g.items.length}</span>
            </summary>
            <div className="px-3.5 pb-3 pl-10">
              <p className="mb-2 text-xs text-faint">{t(g.hint)}</p>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((n, i) => {
                  const color = n.trackName !== undefined ? colorOf(n.trackName) : undefined;
                  return (
                    <li key={i} className="text-sm leading-snug text-muted">
                      {n.trackName !== undefined && (
                        <span className="mr-1.5 inline-flex items-center gap-1 align-[1px] text-xs text-faint">
                          <span className={cx('size-1.5 rounded-full', color ? trackColor(color).solid : 'bg-faint')} aria-hidden="true" />
                          {n.trackName}:
                        </span>
                      )}
                      {t(n.message.key, n.message.params)}
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Spuren                                                              */
/* ------------------------------------------------------------------ */

/** Setup-Code als eigener Eintrag über den Spuren („Setup code: fade, ratchet“). */
function PreludeItem({ code }: { code: string }) {
  const { t } = useT();
  const names = preludeNames(code);
  const first = preludePreview(code, 1)[0] ?? '';
  return (
    <li className="flex items-start gap-2.5 rounded-2xl border border-line bg-card/60 px-3.5 py-3">
      <span className="text-base leading-5" aria-hidden="true">
        ⌨️
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-fg">
          {names.length > 0 ? t('ui.import.preview.preludeNamed', { names: names.join(', ') }) : t('ui.prelude.title')}
        </span>
        {names.length === 0 && <span className="truncate font-mono text-xs text-muted">{first}</span>}
        <span className="text-xs text-faint">{t('ui.import.preview.preludeHint')}</span>
      </span>
    </li>
  );
}

function TrackList({ result }: { result: ImportResult }) {
  const { t } = useT();
  const tracks = resolveTracks(result.ast);
  const prelude = result.settings.prelude?.trim();
  return (
    <section aria-labelledby="import-tracks-heading" className="flex flex-col gap-2">
      <h3 id="import-tracks-heading" className="text-xs font-semibold tracking-wide text-faint uppercase">
        {t('ui.import.preview.tracksHeading')}
      </h3>
      <ul className="flex flex-col gap-2">
        {prelude && <PreludeItem code={prelude} />}
        {tracks.map((rt) => {
          const c = trackColor(rt.track.params.color);
          return (
            <li key={rt.track.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-card/60 px-3.5 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                <span className={cx('h-4 w-1.5 shrink-0 rounded-full', c.solid)} aria-hidden="true" />
                <span className="min-w-0 truncate">{rt.track.params.name}</span>
                {rt.track.params.muted && <span className="text-xs font-normal text-faint">· {t('ui.import.preview.muted')}</span>}
              </span>
              {rt.chain.length === 0 ? (
                <span className="text-xs text-faint">{t('ui.import.preview.emptyTrack')}</span>
              ) : (
                <ol className="flex flex-wrap gap-1.5" aria-label={t('ui.import.preview.chainOf', { name: rt.track.params.name })}>
                  {rt.chain.map((b) => {
                    const def = getBlockDef(b.type);
                    const isCode = b.type === 'code' || b.type === 'code-mod' || b.type === 'code-fx';
                    return (
                      <li
                        key={b.id}
                        className={cx(
                          'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs ring-1',
                          def.kind === 'source' ? cx(c.soft, 'text-fg ring-line-strong') : 'bg-raised/70 text-muted ring-line',
                          isCode && 'font-mono',
                        )}
                      >
                        <span aria-hidden="true">{def.icon}</span>
                        {blockLabel(b.type)}
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Vorschau                                                            */
/* ------------------------------------------------------------------ */

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-card/60 px-3 py-2 ring-1 ring-line">
      <span className="text-lg font-semibold text-fg tabular-nums">{value}</span>
      <span className="truncate text-xs text-muted">{label}</span>
    </div>
  );
}

/** Live-Vorschau: was beim Import entsteht – Tempo, Spuren mit Bausteinen, Hinweise. */
export function ImportPreview({
  analysis,
  code,
  onJumpTo,
}: {
  analysis: ImportAnalysis;
  code: string;
  onJumpTo: (line: number, column: number | null) => void;
}) {
  const { t } = useT();

  if (analysis.status === 'empty') {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong px-6 py-8 text-center">
        <p className="text-sm font-medium text-fg">{t('ui.import.preview.emptyTitle')}</p>
        <p className="max-w-sm text-sm text-muted">{t('ui.import.preview.emptyText')}</p>
      </div>
    );
  }

  if (analysis.status === 'error') {
    const { line, column } = analysis;
    const lineText = line !== null ? (code.split('\n')[line - 1] ?? null) : null;
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-warn/25 bg-warn-soft px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <InfoIcon size={17} className="mt-0.5 shrink-0 text-warn" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{t('ui.import.error.title')}</p>
            <p className="mt-0.5 text-sm text-muted">
              {analysis.message ? t(analysis.message.key, analysis.message.params) : t('ui.import.error.unknown')}
            </p>
          </div>
        </div>
        {line !== null && (
          <div className="flex flex-col gap-2 pl-7">
            {lineText !== null && lineText.trim() !== '' && (
              <pre className="overflow-x-auto rounded-lg bg-canvas/70 px-3 py-2 font-mono text-xs leading-5 text-muted ring-1 ring-line">
                <span className="mr-3 text-faint select-none">{line}</span>
                {lineText}
                {column !== null && (
                  <>
                    {'\n'}
                    <span className="mr-3 text-transparent select-none">{line}</span>
                    <span className="text-warn">{' '.repeat(Math.max(0, column - 1))}^</span>
                  </>
                )}
              </pre>
            )}
            <button
              type="button"
              onClick={() => onJumpTo(line, column)}
              className="self-start rounded-md text-sm text-fg underline decoration-warn/60 underline-offset-4 hover:decoration-warn"
            >
              {column !== null ? t('ui.import.error.jumpToLineColumn', { line, column }) : t('ui.import.error.jumpToLine', { line })}
            </button>
          </div>
        )}
        <p className="pl-7 text-xs text-faint">{t('ui.import.error.help')}</p>
      </div>
    );
  }

  const { result } = analysis;
  const colorOf = (name: string): TrackColor | undefined => result.ast.nodes.filter(isTrackNode).find((n) => n.params.name === name)?.params.color;

  if (result.stats.tracks === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-card/60 px-4 py-3.5">
          <InfoIcon size={17} className="mt-0.5 shrink-0 text-faint" />
          <div>
            <p className="text-sm font-medium text-fg">{t('ui.import.preview.noTracksTitle')}</p>
            <p className="mt-0.5 text-sm text-muted">{t('ui.import.preview.noTracksText')}</p>
          </div>
        </div>
        <NoteGroups notes={result.notes} colorOf={colorOf} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat value={result.settings.bpm} label={t('ui.import.preview.bpm')} />
        <Stat value={result.stats.tracks} label={t('ui.import.preview.tracks', { count: result.stats.tracks })} />
        <Stat value={result.stats.blocks} label={t('ui.import.preview.blocks', { count: result.stats.blocks })} />
      </div>
      <TrackList result={result} />
      <NoteGroups notes={result.notes} colorOf={colorOf} />
    </div>
  );
}
