/**
 * Projekt-Infos und alles, worauf strudelmixr aufbaut – Single Source für den
 * „Über“-Dialog (src/components/ui/topbar/AboutDialog.tsx) und den Credits-Abschnitt
 * der README.md (scripts/sync-readme.mjs, läuft vor jedem Build).
 *
 * Nur Namen, URLs und Lizenzen – alle Texte (Beschreibung, Gruppentitel, „Wofür“)
 * stehen in src/i18n/<sprache>/about.json.
 *
 * Reine Daten ohne Imports: wird auch direkt von Node (Type-Stripping) geladen.
 */

export const ABOUT = {
  name: 'strudelmixr',
  author: 'Marco Schrenk',
  email: 'mail@marco-schrenk.de',
};

export interface Credit {
  /** Text-Key für „Wofür“: about.purposes.<id>. */
  id: string;
  name: string;
  url: string;
  /** SPDX-Kennung (nur Quellen mit eindeutig nachgewiesener freier Lizenz) oder „proprietary“ (übersetzt: about.licenses.*). */
  license: string;
}

export interface CreditGroup {
  /** Auch Text-Key des Gruppentitels: about.groups.<id>. */
  id: 'engine' | 'app' | 'sounds' | 'build';
  items: Credit[];
}

const STRUDEL_REPO = 'https://codeberg.org/uzu/strudel';

export const CREDITS: CreditGroup[] = [
  {
    id: 'engine',
    items: [
      { id: 'strudel', name: 'Strudel', url: 'https://strudel.cc', license: 'AGPL-3.0-or-later' },
      { id: 'strudelCore', name: '@strudel/core, mini, transpiler', url: STRUDEL_REPO, license: 'AGPL-3.0-or-later' },
      { id: 'strudelTonal', name: '@strudel/tonal', url: STRUDEL_REPO, license: 'AGPL-3.0-or-later' },
      { id: 'strudelWebaudio', name: '@strudel/webaudio, superdough, supradough', url: STRUDEL_REPO, license: 'AGPL-3.0-or-later' },
      { id: 'strudelWeb', name: '@strudel/web, @strudel/draw', url: STRUDEL_REPO, license: 'AGPL-3.0-or-later' },
      { id: 'kabelsalat', name: 'Kabelsalat', url: 'https://github.com/felixroos/kabelsalat', license: 'AGPL-3.0-or-later' },
      { id: 'tidalCycles', name: 'TidalCycles', url: 'https://tidalcycles.org', license: 'GPL-3.0' },
      { id: 'tonal', name: 'Tonal', url: 'https://github.com/tonaljs/tonal', license: 'MIT' },
      { id: 'chordVoicings', name: 'chord-voicings', url: 'https://github.com/felixroos/chord-voicings', license: 'ISC' },
      { id: 'fractionJs', name: 'fraction.js', url: 'https://github.com/rawify/Fraction.js', license: 'MIT' },
      { id: 'acorn', name: 'acorn, escodegen, estree-walker', url: 'https://github.com/acornjs/acorn', license: 'MIT / BSD-2-Clause' },
      { id: 'webmidi', name: 'WEBMIDI.js', url: 'https://webmidijs.org', license: 'Apache-2.0' },
      { id: 'strudelExtras', name: '@strudel/xen, midi, motion, csound', url: STRUDEL_REPO, license: 'AGPL-3.0-or-later' },
      { id: 'csound', name: 'Csound (@csound/browser)', url: 'https://csound.com', license: 'LGPL-2.1' },
    ],
  },
  {
    id: 'app',
    items: [
      { id: 'react', name: 'React', url: 'https://react.dev', license: 'MIT' },
      { id: 'nanostores', name: 'Nano Stores', url: 'https://github.com/nanostores/nanostores', license: 'MIT' },
      { id: 'codemirror', name: 'CodeMirror 6', url: 'https://codemirror.net', license: 'MIT' },
    ],
  },
  {
    id: 'sounds',
    items: [
      { id: 'uzuDrumkit', name: 'uzu-drumkit (Switch Angel)', url: 'https://github.com/tidalcycles/uzu-drumkit', license: 'Unlicense' },
      { id: 'freepats', name: 'FreePats Synthesizer Percussion', url: 'https://freepats.zenvoid.org/Percussion/electric-percussion.html', license: 'CC0-1.0' },
      { id: 'hydrogen808', name: 'Hydrogen TR808EmulationKit', url: 'https://github.com/hydrogen-music/hydrogen/tree/master/data/drumkits/TR808EmulationKit', license: 'GPL-3.0-or-later' },
      { id: 'salamander', name: 'Salamander Grand Piano V2', url: 'https://github.com/Tonejs/audio/tree/master/salamander', license: 'CC-BY-3.0' },
      { id: 'sonicPi', name: 'Sonic Pi Samples', url: 'https://github.com/sonic-pi-net/sonic-pi/tree/stable/etc/samples', license: 'CC0-1.0' },
    ],
  },
  {
    id: 'build',
    items: [
      { id: 'astro', name: 'Astro', url: 'https://astro.build', license: 'MIT' },
      { id: 'vite', name: 'Vite', url: 'https://vite.dev', license: 'MIT' },
      { id: 'tailwind', name: 'Tailwind CSS', url: 'https://tailwindcss.com', license: 'MIT' },
      { id: 'typescript', name: 'TypeScript', url: 'https://www.typescriptlang.org', license: 'Apache-2.0' },
      { id: 'vitest', name: 'Vitest', url: 'https://vitest.dev', license: 'MIT' },
      { id: 'ddev', name: 'DDEV', url: 'https://ddev.com', license: 'Apache-2.0' },
      { id: 'claudeCode', name: 'Claude Code', url: 'https://claude.com/claude-code', license: 'proprietary' },
    ],
  },
];
