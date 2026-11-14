import type { AstroGlobal } from 'astro';
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, detectLanguage, parseAcceptLanguage, type Language } from './index';

/**
 * Sprache für das Server-Rendering: ?lang=… > Cookie > Accept-Language > Englisch.
 * Bei statisch vorgerenderten Seiten (GitHub Pages) gibt es keine Anfrage – dann
 * Englisch; die eigentliche Wahl trifft der Browser (initLanguage).
 */
export function requestLanguage(astro: Pick<AstroGlobal, 'url' | 'cookies' | 'request' | 'isPrerendered'>): Language {
  if (astro.isPrerendered) return DEFAULT_LANGUAGE;
  return detectLanguage({
    query: astro.url.searchParams.get('lang'),
    stored: astro.cookies.get(LANGUAGE_COOKIE)?.value ?? null,
    preferred: parseAcceptLanguage(astro.request.headers.get('accept-language')),
  });
}
