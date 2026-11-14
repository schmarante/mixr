import { atom } from 'nanostores';

import deAbout from './de/about.json';
import deAudio from './de/audio.json';
import deBlocks from './de/blocks.json';
import deCommon from './de/common.json';
import deCompiler from './de/compiler.json';
import deImporter from './de/importer.json';
import deMidi from './de/midi.json';
import deTemplates from './de/templates.json';
import deUi from './de/ui.json';
import enAbout from './en/about.json';
import enAudio from './en/audio.json';
import enBlocks from './en/blocks.json';
import enCommon from './en/common.json';
import enCompiler from './en/compiler.json';
import enImporter from './en/importer.json';
import enMidi from './en/midi.json';
import enTemplates from './en/templates.json';
import enUi from './en/ui.json';

/**
 * Internationalisierung: Alle sichtbaren Texte stehen in Sprachdateien unter
 * src/i18n/<sprache>/<namespace>.json und werden per Punkt-Pfad adressiert:
 * t('ui.topbar.play').
 *
 * - Englisch ist Referenzsprache: `Dictionary` wird aus den englischen Dateien
 *   abgeleitet, die deutschen müssen exakt dieselbe Struktur haben (Typfehler sonst).
 *   Keys sind dadurch typgeprüft.
 * - Platzhalter: "{count} tracks" + t(key, { count: 3 }).
 * - Mehrzahl: Ein Wert darf { one, other } (optional zero) sein; die Form wählt
 *   Intl.PluralRules anhand von params.count.
 * - Fallback: aktuelle Sprache → Englisch → der Key selbst.
 * - Sprachwahl: ?lang=… > gespeicherte Wahl (Cookie, damit auch der Server sie kennt)
 *   > Browsersprache > Englisch.
 * - SSR: Der Server übersetzt mit `translate(lang, …)` explizit – der Store ist auf
 *   dem Server modulweit geteilt und wird dort nie beschrieben.
 */

const en = {
  common: enCommon,
  ui: enUi,
  blocks: enBlocks,
  templates: enTemplates,
  compiler: enCompiler,
  audio: enAudio,
  about: enAbout,
  importer: enImporter,
  midi: enMidi,
};

export type Dictionary = typeof en;

const de: Dictionary = {
  common: deCommon,
  ui: deUi,
  blocks: deBlocks,
  templates: deTemplates,
  compiler: deCompiler,
  audio: deAudio,
  about: deAbout,
  importer: deImporter,
  midi: deMidi,
};

export const LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

/** Sprachnamen in der jeweils eigenen Sprache (für die Auswahl, nicht übersetzt). */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'Deutsch' };

const DICTIONARIES: Record<Language, Dictionary> = { en, de };
const LOCALES: Record<Language, string> = { en: 'en-US', de: 'de-DE' };

/** Cookie mit der gewählten Sprache (auch vom Server beim SSR gelesen). */
export const LANGUAGE_COOKIE = 'smx-lang';

/* ------------------------------------------------------------------ */
/* Typisierte Keys                                                     */
/* ------------------------------------------------------------------ */

interface PluralForms {
  one: string;
  other: string;
  zero?: string;
}

type Leaf = string | PluralForms;

/** Alle Punkt-Pfade zu Texten (Strings oder Mehrzahl-Objekten). */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = Paths<Dictionary>;
export type TParams = Record<string, string | number>;

/* ------------------------------------------------------------------ */
/* Übersetzen                                                          */
/* ------------------------------------------------------------------ */

function lookup(dict: Dictionary, key: string): unknown {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function isPlural(v: unknown): v is PluralForms {
  return typeof v === 'object' && v !== null && typeof (v as PluralForms).other === 'string';
}

const pluralRules: Partial<Record<Language, Intl.PluralRules>> = {};

function resolve(lang: Language, value: unknown, params?: TParams): string | undefined {
  let text: string | undefined;
  if (typeof value === 'string') text = value;
  else if (isPlural(value)) {
    const count = Number(params?.count ?? 0);
    if (count === 0 && value.zero !== undefined) text = value.zero;
    else {
      const rules = (pluralRules[lang] ??= new Intl.PluralRules(LOCALES[lang]));
      text = rules.select(count) === 'one' ? value.one : value.other;
    }
  }
  if (text === undefined) return undefined;
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

/** Übersetzt für eine explizite Sprache (SSR, Tests). */
export function translate(lang: Language, key: TKey, params?: TParams): string {
  return (
    resolve(lang, lookup(DICTIONARIES[lang], key), params) ??
    resolve(DEFAULT_LANGUAGE, lookup(DICTIONARIES[DEFAULT_LANGUAGE], key), params) ??
    key
  );
}

/**
 * Wie `translate`, aber für Keys, die erst zur Laufzeit zusammengesetzt werden
 * (z. B. `blocks.types.${type}.label`). Liefert `undefined`, wenn es den Key nicht gibt.
 */
export function translateDynamic(lang: Language, key: string, params?: TParams): string | undefined {
  return (
    resolve(lang, lookup(DICTIONARIES[lang], key), params) ??
    resolve(DEFAULT_LANGUAGE, lookup(DICTIONARIES[DEFAULT_LANGUAGE], key), params)
  );
}

/* ------------------------------------------------------------------ */
/* Aktuelle Sprache (Browser)                                          */
/* ------------------------------------------------------------------ */

/** Aktuelle Sprache. Auf dem Server immer DEFAULT_LANGUAGE – dort `translate()` nutzen. */
export const languageStore = atom<Language>(DEFAULT_LANGUAGE);

/** Übersetzt in die aktuelle Sprache. */
export function t(key: TKey, params?: TParams): string {
  return translate(languageStore.get(), key, params);
}

/** Wie `t`, für zur Laufzeit zusammengesetzte Keys. */
export function tDynamic(key: string, params?: TParams): string | undefined {
  return translateDynamic(languageStore.get(), key, params);
}

export function getLanguage(): Language {
  return languageStore.get();
}

/** BCP-47-Locale der aktuellen Sprache (für toLocaleString & Co.). */
export function getLocale(lang: Language = languageStore.get()): string {
  return LOCALES[lang];
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

/** Normalisiert „de-DE“, „de_at“, „EN“ … auf eine unterstützte Sprache. */
export function matchLanguage(candidate: string | null | undefined): Language | undefined {
  if (!candidate) return undefined;
  const base = candidate.trim().toLowerCase().split(/[-_;]/)[0];
  return isLanguage(base) ? base : undefined;
}

/**
 * Wählt die Sprache: ?lang=… > gespeicherte Wahl > Browsersprachen (in Reihenfolge)
 * > Englisch. Reine Funktion – vom Server (Accept-Language) und Browser genutzt.
 */
export function detectLanguage(input: { query?: string | null; stored?: string | null; preferred?: readonly string[] }): Language {
  return (
    matchLanguage(input.query) ??
    matchLanguage(input.stored) ??
    input.preferred?.map((p) => matchLanguage(p)).find((l) => l !== undefined) ??
    DEFAULT_LANGUAGE
  );
}

/** Zerlegt einen Accept-Language-Header in Sprachen, nach Gewichtung sortiert. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())?.[1]).find((v) => v !== undefined);
      return { tag, q: q === undefined ? 1 : Number(q), i };
    })
    .filter((e) => e.tag !== '' && e.tag !== '*' && e.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((e) => e.tag);
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let initialized = false;

/**
 * Setzt die Sprache im Browser beim Start. Übernimmt die vom Server gerenderte
 * Sprache (<html lang> mit data-lang-source="request"), damit SSR-Gerüst und Inseln
 * übereinstimmen; statisch ausgeliefert (GitHub Pages) entscheidet der Browser. Idempotent.
 */
export function initLanguage(): Language {
  if (typeof document === 'undefined') return DEFAULT_LANGUAGE;
  if (!initialized) {
    initialized = true;
    // Nur übernehmen, wenn der Server die Sprache aus der Anfrage bestimmt hat (SSR) –
    // bei statischen Seiten (GitHub Pages) steht dort immer der Default.
    const root = document.documentElement;
    const fromServer = root.dataset.langSource === 'request' ? matchLanguage(root.lang) : undefined;
    const lang =
      fromServer ??
      detectLanguage({
        query: new URLSearchParams(window.location.search).get('lang'),
        stored: readCookie(LANGUAGE_COOKIE),
        preferred: navigator.languages,
      });
    languageStore.set(lang);
    if (!fromServer) {
      root.lang = lang;
      document.title = translate(lang, 'common.meta.title');
    }
  }
  return languageStore.get();
}

/** Wechselt die Sprache sofort und merkt sie sich (Cookie, 1 Jahr). Nur im Browser. */
export function setLanguage(lang: Language) {
  languageStore.set(lang);
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.cookie = `${LANGUAGE_COOKIE}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
  document.title = translate(lang, 'common.meta.title');
}
