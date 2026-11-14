import { afterEach, describe, expect, it } from 'vitest';
import { BLOCK_CATALOG, BLOCK_KINDS, DRUM_INSTRUMENTS, OPTION_SETS } from '../../blocks/catalog';
import {
  blockDescription,
  blockLabel,
  instrumentLabel,
  kindLabel,
  optionLabel,
  optionTextKey,
  paramLabel,
  paramPlaceholder,
  paramUnit,
  templateDescription,
  templateName,
} from '../../blocks/text';
import { CREDITS } from '../../data/credits';
import { TEMPLATES, templateProject } from '../../data/templates';
import deAbout from '../../i18n/de/about.json';
import deAudio from '../../i18n/de/audio.json';
import deBlocks from '../../i18n/de/blocks.json';
import deCommon from '../../i18n/de/common.json';
import deCompiler from '../../i18n/de/compiler.json';
import deTemplates from '../../i18n/de/templates.json';
import deUi from '../../i18n/de/ui.json';
import enAbout from '../../i18n/en/about.json';
import enAudio from '../../i18n/en/audio.json';
import enBlocks from '../../i18n/en/blocks.json';
import enCommon from '../../i18n/en/common.json';
import enCompiler from '../../i18n/en/compiler.json';
import enTemplates from '../../i18n/en/templates.json';
import enUi from '../../i18n/en/ui.json';
import {
  LANGUAGES,
  detectLanguage,
  languageStore,
  matchLanguage,
  parseAcceptLanguage,
  translate,
  translateDynamic,
  type Language,
} from '../../i18n';
import { addTrack, duplicateTrack } from '../../store/actions';
import { visualAstStore } from '../../store/agentBus';
import { isTrackNode, type BlockType, type TrackNode } from '../../types/ast';

/** Rohdaten je Sprache – um „vorhanden in GENAU dieser Sprache“ zu prüfen (ohne Englisch-Fallback). */
const RAW: Record<Language, Record<string, unknown>> = {
  en: { common: enCommon, ui: enUi, blocks: enBlocks, templates: enTemplates, compiler: enCompiler, audio: enAudio, about: enAbout },
  de: { common: deCommon, ui: deUi, blocks: deBlocks, templates: deTemplates, compiler: deCompiler, audio: deAudio, about: deAbout },
};

function raw(lang: Language, key: string): unknown {
  let node: unknown = RAW[lang];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function isText(v: unknown): boolean {
  if (typeof v === 'string') return v.trim() !== '';
  return typeof v === 'object' && v !== null && typeof (v as { other?: unknown }).other === 'string';
}

/** Erwartet einen nicht-leeren Text unter `key` in jeder Sprache. */
function expectText(key: string) {
  for (const lang of LANGUAGES) expect(isText(raw(lang, key)), `${lang}: ${key}`).toBe(true);
}

/** Alle Blatt-Pfade eines Objekts (Mehrzahl-Objekte zählen als Blatt). */
function leaves(node: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof node === 'string' || (typeof node === 'object' && node !== null && 'other' in node)) {
    out.set(prefix, node);
    return out;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node)) for (const [p, l] of leaves(v, prefix ? `${prefix}.${k}` : k)) out.set(p, l);
  }
  return out;
}

const placeholders = (v: unknown) =>
  [...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => languageStore.set('en'));

/* ------------------------------------------------------------------ */
/* Kern                                                                */
/* ------------------------------------------------------------------ */

describe('parseAcceptLanguage', () => {
  it('sortiert nach Gewichtung, bei Gleichstand nach Reihenfolge', () => {
    expect(parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5')).toEqual(['fr-CH', 'fr', 'en', 'de']);
    expect(parseAcceptLanguage('de;q=0.5, en-GB;q=0.9,en')).toEqual(['en', 'en-GB', 'de']);
  });

  it('ignoriert *, q=0 und Leeres', () => {
    expect(parseAcceptLanguage('*, de;q=0, en')).toEqual(['en']);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});

describe('detectLanguage', () => {
  it('Reihenfolge: ?lang > gespeichert > Browser > Englisch', () => {
    expect(detectLanguage({ query: 'de', stored: 'en', preferred: ['en'] })).toBe('de');
    expect(detectLanguage({ query: null, stored: 'de', preferred: ['en'] })).toBe('de');
    expect(detectLanguage({ stored: null, preferred: ['de-AT', 'en'] })).toBe('de');
    expect(detectLanguage({})).toBe('en');
  });

  it('überspringt nicht unterstützte Sprachen und normalisiert Varianten', () => {
    expect(detectLanguage({ query: 'fr', stored: 'xx', preferred: ['fr-FR', 'it', 'DE_ch'] })).toBe('de');
    expect(detectLanguage({ preferred: ['fr', 'es'] })).toBe('en');
    expect(detectLanguage({ preferred: parseAcceptLanguage('fr;q=1, de;q=0.8, en;q=0.9') })).toBe('en');
    expect(matchLanguage(' EN-us ')).toBe('en');
    expect(matchLanguage('')).toBeUndefined();
  });
});

describe('translate', () => {
  it('setzt Platzhalter ein und lässt unbekannte stehen', () => {
    expect(translate('de', 'compiler.invalidTempo', { bpm: 120 })).toBe('Das Tempo ist ungültig – ich verwende 120 BPM.');
    expect(translate('en', 'compiler.invalidTempo', { bpm: 90 })).toBe("The tempo isn't valid – using 90 BPM instead.");
    expect(translate('en', 'compiler.invalidTempo')).toContain('{bpm}');
    expect(translate('en', 'compiler.extraSource', { track: 'A' })).toBe('“A” has more than one sound source – “{block}” is ignored.');
  });

  it('Mehrzahl über params.count', () => {
    expect(translate('en', 'blocks.units.bars', { count: 1 })).toBe('bar');
    expect(translate('en', 'blocks.units.bars', { count: 4 })).toBe('bars');
    expect(translate('en', 'blocks.units.bars', { count: 0 })).toBe('bars');
    expect(translate('de', 'blocks.units.bars', { count: 1 })).toBe('Takt');
    expect(translate('de', 'blocks.units.bars', { count: 2 })).toBe('Takte');
    expect(translate('de', 'blocks.units.bars')).toBe('Takte');
  });

  it('Fallback: Sprache → Englisch → Key', () => {
    const forms = deCompiler as Record<string, unknown>;
    const saved = forms.unknownBlock;
    delete forms.unknownBlock;
    try {
      expect(translate('de', 'compiler.unknownBlock', { type: 'x' })).toBe('Unknown block “x” – it will be skipped.');
    } finally {
      forms.unknownBlock = saved;
    }
    expect(translate('de', 'compiler.unknownBlock', { type: 'x' })).toBe('Unbekannter Block „x“ – wird übersprungen.');
    expect(translate('de', 'gibt.es.nicht' as never)).toBe('gibt.es.nicht');
    expect(translateDynamic('de', 'gibt.es.nicht')).toBeUndefined();
    // Zwischenknoten sind keine Texte
    expect(translateDynamic('de', 'blocks.types')).toBeUndefined();
  });
});

describe('Sprachdateien', () => {
  it('Englisch und Deutsch haben exakt dieselben Keys und Platzhalter', () => {
    for (const ns of Object.keys(RAW.en)) {
      const en = leaves(RAW.en[ns]);
      const de = leaves(RAW.de[ns]);
      expect([...de.keys()].sort(), ns).toEqual([...en.keys()].sort());
      for (const [key, value] of en) {
        expect(isText(de.get(key)), `de: ${ns}.${key}`).toBe(true);
        expect(placeholders(de.get(key)), `${ns}.${key}`).toEqual(placeholders(value));
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Abdeckung: jeder Text existiert in jeder Sprache                    */
/* ------------------------------------------------------------------ */

describe('Katalog-Texte', () => {
  const types = Object.keys(BLOCK_CATALOG) as BlockType[];

  it('jeder Blocktyp und jeder Parameter', () => {
    for (const type of types) {
      expectText(`blocks.types.${type}.label`);
      expectText(`blocks.types.${type}.description`);
      const keys = BLOCK_CATALOG[type].params.map((p) => p.key);
      // keine verwaisten Texte für Parameter, die es nicht (mehr) gibt
      expect(Object.keys(raw('en', `blocks.types.${type}.params`) as object).sort(), type).toEqual([...keys].sort());
      for (const key of keys) expectText(`blocks.types.${type}.params.${key}.label`);
    }
  });

  it('jede Option, jedes Instrument, jede Kategorie, jede Wort-Einheit', () => {
    for (const [set, options] of Object.entries(OPTION_SETS)) {
      expect(Object.keys(raw('en', `blocks.options.${set}`) as object).sort(), set).toEqual(
        options.map((o) => optionTextKey(o.value)).sort(),
      );
      for (const o of options) expectText(`blocks.options.${set}.${optionTextKey(o.value)}`);
    }
    for (const i of DRUM_INSTRUMENTS) expectText(`blocks.instruments.${i.value}`);
    for (const kind of BLOCK_KINDS) {
      expectText(`blocks.kinds.${kind}.label`);
      expectText(`blocks.kinds.${kind}.description`);
    }
    for (const def of Object.values(BLOCK_CATALOG)) {
      for (const p of def.params) {
        if (p.type === 'number' && (p.unit === 'bars' || p.unit === 'bit')) expectText(`blocks.units.${p.unit}`);
      }
    }
  });

  it.each(LANGUAGES)('text.ts liefert in %s echte Texte (kein Key-Fallback)', (lang) => {
    languageStore.set(lang);
    for (const type of types) {
      expect(blockLabel(type)).not.toBe(type);
      expect(blockDescription(type)).not.toBe('');
      for (const p of BLOCK_CATALOG[type].params) {
        expect(paramLabel(type, p.key)).not.toBe(p.key);
        if (p.type === 'select') {
          for (const o of p.options) expect(optionLabel(type, p.key, o.value), `${type}.${p.key}=${o.value}`).toBeTruthy();
        }
      }
    }
    for (const kind of BLOCK_KINDS) expect(kindLabel(kind)).not.toBe(kind);
  });

  it('Texte wechseln mit der Sprache', () => {
    languageStore.set('en');
    expect([blockLabel('melody'), kindLabel('effect'), paramLabel('lpf', 'cutoff')]).toEqual(['Melody', 'Effects', 'Brightness']);
    expect(optionLabel('delay', 'time', '0.1875')).toBe('3/16 – dotted');
    expect(optionLabel('melody', 'scale', 'minor:pentatonic')).toBe('Minor pentatonic – always sounds good');
    expect(paramUnit('sweep', 'cycles', 1)).toBe('bar');
    expect(paramUnit('sweep', 'cycles', 8)).toBe('bars');
    expect(paramUnit('lpf', 'cutoff')).toBe('Hz');
    expect(paramUnit('room', 'amount')).toBeUndefined();
    expect(paramPlaceholder('chords', 'custom')).toBe('<Am F C G>');
    expect(paramPlaceholder('chords', 'progression')).toBeUndefined();

    languageStore.set('de');
    expect([blockLabel('melody'), kindLabel('effect'), paramLabel('lpf', 'cutoff')]).toEqual(['Melodie', 'Effekte', 'Helligkeit']);
    expect(optionLabel('delay', 'time', '0.1875')).toBe('3/16 – punktiert');
    expect(paramUnit('sweep', 'cycles', 4)).toBe('Takte');
    expect(instrumentLabel('hh')).toBe('Hi-Hat');
    // Unbekanntes fällt auf Wert/Key zurück
    expect(optionLabel('delay', 'time', '0.5')).toBe('0.5');
    expect(instrumentLabel('cowbell')).toBe('cowbell');
    expect(paramLabel('lpf', 'gibtsnicht')).toBe('gibtsnicht');
  });
});

describe('Vorlagen-Texte', () => {
  it('jede Vorlage hat Name, Beschreibung und Spurnamen in jeder Sprache', () => {
    for (const tpl of TEMPLATES) {
      expectText(`templates.${tpl.id}.name`);
      expectText(`templates.${tpl.id}.description`);
      expect(Object.keys(raw('en', `templates.${tpl.id}.tracks`) as object).sort()).toEqual([...new Set(tpl.trackKeys)].sort());
      for (const key of tpl.trackKeys) expectText(`templates.${tpl.id}.tracks.${key}`);
      if (tpl.sectionKeys) {
        expect(Object.keys(raw('en', `templates.${tpl.id}.sections`) as object).sort()).toEqual([...new Set(tpl.sectionKeys)].sort());
        for (const key of tpl.sectionKeys) expectText(`templates.${tpl.id}.sections.${key}`);
      }
    }
    expect(Object.keys(enTemplates).sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
  });

  it('templateName/-Description folgen der Sprache', () => {
    languageStore.set('de');
    expect(templateDescription('lofi')).toMatch(/Musik zum Lernen/);
    languageStore.set('en');
    expect(templateName('lofi')).toBe('Lo-Fi Hip-Hop');
    expect(templateDescription('lofi')).toMatch(/music to study to/);
    expect(templateName('gibtsnicht')).toBe('gibtsnicht');
  });

  it('templateProject setzt Spurnamen der aktuellen Sprache ein, der Vorlagen-AST bleibt unverändert', () => {
    const tpl = TEMPLATES.find((t) => t.id === 'lofi')!;
    const before = structuredClone(tpl.ast);
    const names = (ast: { nodes: { type: string }[] }) =>
      ast.nodes.filter((n): n is TrackNode => n.type === 'track').map((n) => n.params.name);

    expect(names(tpl.ast)).toEqual(['Beat', 'Chords', 'Melody']);
    languageStore.set('de');
    const de = templateProject('lofi')!;
    expect(names(de.ast)).toEqual(['Beat', 'Akkorde', 'Melodie']);
    expect(de.settings).toEqual(tpl.settings);
    // gleiche Struktur, nur andere Namen
    expect(de.ast.nodes.map((n) => n.id)).toEqual(tpl.ast.nodes.map((n) => n.id));
    expect(de.ast.edges).toEqual(tpl.ast.edges);
    languageStore.set('en');
    expect(names(templateProject('lofi')!.ast)).toEqual(['Beat', 'Chords', 'Melody']);
    expect(tpl.ast).toEqual(before);
    expect(templateProject('gibtsnicht')).toBeUndefined();
  });
});

describe('Über-Dialog-Texte', () => {
  it('jede Credit-Gruppe und jeder Eintrag hat Texte in jeder Sprache', () => {
    for (const group of CREDITS) {
      expectText(`about.groups.${group.id}`);
      for (const item of group.items) expectText(`about.purposes.${item.id}`);
    }
    const ids = CREDITS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(enAbout.purposes).sort()).toEqual([...ids].sort());
  });
});

describe('Standard-Spurnamen', () => {
  it('neue Spuren und Kopien heißen je nach Sprache', () => {
    visualAstStore.set({ nodes: [], edges: [] });
    const trackName = (id: string) => {
      const n = visualAstStore.get().nodes.find((x) => x.id === id);
      return n && isTrackNode(n) ? n.params.name : undefined;
    };
    languageStore.set('de');
    const a = addTrack('melody');
    const b = addTrack();
    expect(trackName(a)).toBe('Melodie 1');
    expect(trackName(b)).toBe('Spur 2');
    expect(trackName(duplicateTrack(a)!)).toBe('Melodie 1 (Kopie)');

    languageStore.set('en');
    expect(trackName(addTrack('melody'))).toBe('Melody 4');
    expect(trackName(addTrack())).toBe('Track 5');
    expect(trackName(duplicateTrack(b)!)).toBe('Spur 2 (copy)');
  });
});
