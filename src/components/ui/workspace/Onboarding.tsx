import { useT } from '../../../i18n/react';
import { rich } from '../lib/rich';
import { LogoMark } from '../Logo';
import { Kbd } from '../primitives/Controls';
import { StartOptions } from '../shared/StartOptions';

/** Startbildschirm für leere Projekte: kurze Einladung + Vorlagen + Schnellstart. */
export function Onboarding() {
  const { t } = useT();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14 motion-safe:animate-fade-in">
      <div className="flex flex-col items-start gap-4">
        <LogoMark size={44} />
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t('ui.onboarding.title')}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          {rich(t('ui.onboarding.intro'), {
            strudel: (
              <a href="https://strudel.cc" target="_blank" rel="noreferrer" className="text-fg underline decoration-accent/60 underline-offset-4 hover:decoration-accent">
                Strudel
              </a>
            ),
          })}
        </p>
      </div>

      <StartOptions />

      <p className="flex flex-wrap items-center gap-2 text-sm text-faint">
        {rich(t('ui.onboarding.tip'), { key: <Kbd>{t('common.keys.space')}</Kbd> })}
      </p>
    </div>
  );
}
