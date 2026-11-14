import { t } from '../../../i18n';

/** Anzeige-Name der Modifier-Taste (⌘ auf Apple-Geräten, sonst Strg/Ctrl). Nur im Browser aufrufen. */
export function modKey(): string {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) return '⌘';
  return t('common.keys.ctrl');
}
