/**
 * Pfade relativ zur Basis der Seite. Lokal (ddev, SSR) liegt die App unter „/“,
 * auf GitHub Pages unter „/strudelmixr/“ (BASE_PATH beim Build, astro.config.mjs).
 * Alle eigenen absoluten URLs (Samples, Favicon, Links) laufen hierüber.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** withBase('samples/drums/') → '/samples/drums/' bzw. '/strudelmixr/samples/drums/' */
export function withBase(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}
