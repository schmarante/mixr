import { useStore } from '@nanostores/react';
import { languageStore, t, tDynamic, type Language } from './index';

/**
 * React-Anbindung: Komponenten, die Text rendern, rufen `useT()` auf. Der Hook
 * abonniert die aktuelle Sprache – ein Sprachwechsel rendert sie sofort neu,
 * ohne Remount (offene Dialoge bleiben offen).
 */
export function useT(): { t: typeof t; tDynamic: typeof tDynamic; lang: Language } {
  const lang = useStore(languageStore);
  return { t, tDynamic, lang };
}

export function useLanguage(): Language {
  return useStore(languageStore);
}
