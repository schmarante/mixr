import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { ABOUT, CREDITS } from '../../../data/credits';
import { LANGUAGES, LANGUAGE_NAMES, isLanguage, setLanguage } from '../../../i18n';
import { withBase } from '../../../lib/paths';
import { useT } from '../../../i18n/react';
import { LogoMark } from '../Logo';
import { SelectBox } from '../primitives/Controls';
import { IconButton } from '../primitives/IconButton';
import { CloseIcon, ExternalIcon } from '../primitives/Icons';

const VERSION = __APP_VERSION__;

const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }));

/** Setzt React-Knoten an die Stellen der Platzhalter `{name}` eines übersetzten Texts. */
function fill(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text.split(/\{(\w+)\}/).map((piece, i) => (
    <Fragment key={i}>{i % 2 === 1 ? (parts[piece] ?? `{${piece}}`) : piece}</Fragment>
  ));
}

/**
 * „Über“-Dialog: Name, Beschreibung, Autor, Version, Sprachwahl und alle Projekte,
 * Klänge und Werkzeuge, auf denen mixr aufbaut (Liste: src/data/credits.ts,
 * Texte: src/i18n/<sprache>/about.json – dieselben Quellen erzeugen den Credits-Abschnitt
 * der README). Ein Sprachwechsel wirkt sofort, der Dialog bleibt offen.
 */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t, tDynamic, lang } = useT();
  const languageId = useId();
  const linkClass = 'underline hover:text-accent';

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="about-title"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[min(88dvh,52rem)] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-line-strong bg-panel-solid p-0 text-fg shadow-2xl shadow-black/70 backdrop:bg-black/60 open:motion-safe:animate-slide-up"
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div className="flex items-start gap-3">
              <LogoMark size={40} className="shrink-0" />
              <div>
                <h2 id="about-title" className="text-lg font-semibold">
                  {fill(t('about.heading'), {
                    name: <span className="text-accent">mixr</span>,
                  })}
                </h2>
                <p className="mt-1 text-sm text-muted">{t('about.description')}</p>
              </div>
            </div>
            <IconButton label={t('about.close')} onClick={onClose} tooltip="left" kbd="Esc">
              <CloseIcon />
            </IconButton>
          </header>

          <div className="min-h-0 select-text overflow-y-auto px-6 py-5 text-sm">
            <dl className="grid grid-cols-[6rem_1fr] items-baseline gap-x-4 gap-y-1.5">
              <dt className="text-faint">{t('about.author')}</dt>
              <dd>{ABOUT.author}</dd>
              <dt className="text-faint">{t('about.email')}</dt>
              <dd>
                <a href={`mailto:${ABOUT.email}`} className="text-accent hover:underline">
                  {ABOUT.email}
                </a>
              </dd>
              <dt className="text-faint">{t('about.version')}</dt>
              <dd className="font-mono text-[13px]">{VERSION}</dd>
              <dt className="self-center text-faint">
                <label htmlFor={languageId}>{t('about.language')}</label>
              </dt>
              <dd className="max-w-48">
                <SelectBox
                  id={languageId}
                  value={lang}
                  options={LANGUAGE_OPTIONS}
                  onChange={(v) => {
                    if (isLanguage(v)) setLanguage(v);
                  }}
                />
              </dd>
            </dl>
            <p className="mt-4">{t('about.madeWith')}</p>

            <p className="mt-5 border-t border-line pt-4 text-muted">{t('about.openSource')}</p>

            {CREDITS.map((group) => (
              <section key={group.id} aria-labelledby={`credits-${group.id}`} className="mt-5">
                <h3 id={`credits-${group.id}`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
                  {t(`about.groups.${group.id}`)}
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <li key={item.id} className="flex items-baseline gap-3">
                      <div className="min-w-0 flex-1">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-fg hover:text-accent hover:underline"
                        >
                          {item.name}
                          <ExternalIcon size={12} className="text-faint" />
                        </a>
                        <div className="text-muted">{tDynamic(`about.purposes.${item.id}`) ?? ''}</div>
                      </div>
                      <span className="shrink-0 rounded-md bg-hover px-1.5 py-0.5 font-mono text-[10px] text-muted">
                        {tDynamic(`about.licenses.${item.license}`) ?? item.license}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <p className="mt-6 border-t border-line pt-4 text-xs text-faint">
              {fill(t('about.footnote'), {
                ccBy: (
                  <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer" className={linkClass}>
                    CC BY 3.0
                  </a>
                ),
                details: (
                  <a href={withBase('samples/CREDITS.md')} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    samples/CREDITS.md
                  </a>
                ),
              })}
            </p>
          </div>
        </div>
      )}
    </dialog>
  );
}
