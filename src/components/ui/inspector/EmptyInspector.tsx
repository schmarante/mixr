import { useEffect } from 'react';
import type { TKey } from '../../../i18n';
import { useT } from '../../../i18n/react';
import { markGuideSeen } from '../lib/guide';
import { modKey } from '../lib/platform';
import { Kbd } from '../primitives/Controls';

const STEPS: { n: number; title: TKey; text: TKey }[] = [
  { n: 1, title: 'ui.emptyInspector.step1Title', text: 'ui.emptyInspector.step1Text' },
  { n: 2, title: 'ui.emptyInspector.step2Title', text: 'ui.emptyInspector.step2Text' },
  { n: 3, title: 'ui.emptyInspector.step3Title', text: 'ui.emptyInspector.step3Text' },
];

/** Hinweis ohne Auswahl: Kurzanleitung + wichtigste Tastenkürzel. */
export function EmptyInspector() {
  const { t } = useT();
  const mod = modKey();
  useEffect(markGuideSeen, []);
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
      <ol className="grid flex-1 gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="flex items-start gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
              {s.n}
            </span>
            <span className="text-sm">
              <span className="block font-medium text-fg">{t(s.title)}</span>
              <span className="text-muted">{t(s.text)}</span>
            </span>
          </li>
        ))}
      </ol>
      <dl className="hidden shrink-0 grid-cols-[auto_auto] items-center gap-x-3 gap-y-1.5 text-xs text-muted md:grid">
        <dt><Kbd>{t('common.keys.space')}</Kbd></dt>
        <dd>{t('ui.emptyInspector.shortcutPlay')}</dd>
        <dt><Kbd>{mod}+Z</Kbd></dt>
        <dd>{t('ui.emptyInspector.shortcutUndo')}</dd>
        <dt><Kbd>{t('common.keys.delete')}</Kbd></dt>
        <dd>{t('ui.emptyInspector.shortcutDelete')}</dd>
        <dt><Kbd>{t('common.keys.alt')}+←→</Kbd></dt>
        <dd>{t('ui.emptyInspector.shortcutMove')}</dd>
      </dl>
    </div>
  );
}
