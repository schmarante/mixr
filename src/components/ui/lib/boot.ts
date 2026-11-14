import { initLanguage } from '../../../i18n';
import { initPersistence } from '../../../store/persistence';

/**
 * Sorgt dafür, dass Sprache und gespeicherter Projektstand feststehen, BEVOR eine
 * Insel zum ersten Mal rendert (verhindert ein Aufblitzen des Startbildschirms bzw.
 * der falschen Sprache). Beides ist idempotent – index.astro ruft initPersistence()
 * ebenfalls auf. Auf dem Server passiert nichts (Stores dort nie beschreiben).
 */
export function ensureClientBoot(): void {
  if (typeof window === 'undefined') return;
  initLanguage();
  initPersistence();
}
