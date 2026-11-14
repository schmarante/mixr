<h1>
  <img width="38" align="top" src="public/favicon.svg" alt="">
  <b>strudelmixr</b>
</h1>

Music from building blocks – a visual, beginner-friendly studio for [Strudel](https://strudel.cc) live coding.

**Drums · Melody · Chords · Samples · Effects · free Strudel code · import from strudel.cc**

<a href="https://schmarante.github.io/strudelmixr/"><img src="https://img.shields.io/badge/%E2%96%B6%20Live%20demo-schmarante.github.io%2Fstrudelmixr-2ea44f?style=for-the-badge" alt="Live demo"></a>

Stack sounds, rhythms and effects like on a mixing desk – strudelmixr writes the Strudel code live. You hear every change instantly and pick up the code along the way. Everything runs in your browser – **no install, no account, no third-party servers.**

## Highlights

- **A mixer, not a patch cable mess** – every track is a channel strip: `sound → rhythm → effects`. Add blocks with a click, reorder them by drag & drop (even across tracks), bypass or delete them; mute, solo and duplicate tracks.
- **Start in seconds** – five templates (Techno, Lo-Fi Hip-Hop, House, Ambient, Synthwave): one click and it plays. Or start empty with drums, melody, chords, a sample or code.
- **Step sequencer** for drums (kick, snare, clap, hi-hats, rimshot) with three synthesized kits (Modern, Analog, 808) – click or paint the steps. While playing, a playhead runs through the editors and the little previews on every track.
- **Piano roll in the scale** – notes are scale degrees, so nothing can sound off. Pick root, scale (major, minor, pentatonic, modes …) and octave; two octaves, chords, **held notes** (drag a note longer) and melodies of **1–16 bars**.
- **Chord progressions** with automatic voicings and rhythm (held, quarters, offbeat).
- **55 building blocks** – rhythm (euclid, off, echo, chunk, iter, swing, shuffle, mask …), pitch (transpose, scale steps, arpeggio, vibrato), samples (chop, slice, striate, loopAt, sample range, cut groups) and sound (filters, filter envelope and sweep, reverb, echo, phaser, vowel, tremolo, compressor, FM, bitcrusher, distortion …), each explained in plain words; expert controls under "More options". **Any parameter** reaches all 411 Strudel sound controls with typo suggestions.
- **Song arrangement** – turn loops into a song: sections (intro, drop, breakdown …) as a timeline, switch tracks per section with a click or drag, per-section variations like `.lpf(800)`, loop a single section while working on it.
- **Your own samples** – drag audio files (wav, mp3, ogg, flac …) or whole folders into sample slots like on Shadertoy – folders work like strudel.cc's "import sounds". Use them as `s("name:2")`. Samples stay in your browser.
- **Project files** – download everything as a ZIP (`strudelmixr.json` + samples) and drag it back in later – as ZIP, as JSON or file by file.
- **Never limiting** – code blocks for sound, rhythm and effects take any Strudel code: whatever Strudel can do, works here too.
- **MIDI in and out** – drop a `.mid` file (or use **⋯ → Import MIDI…**): channel 10 becomes drum grids, other channels melody blocks with held notes (or exact `note("…")` code), tempo and velocities come along, longer pieces become a song arrangement. **Export as MIDI…** writes what Strudel actually plays (code blocks and arrangement included) as a Standard MIDI File – own small SMF reader/writer, no dependency ([`src/lib/midi/smf.ts`](src/lib/midi/smf.ts), [`src/agents/midi/`](src/agents/midi/)).
- **Import Strudel code** – paste code from strudel.cc (or a share link, or drop a file) and get an editable project: tracks, drum grids, chords and effects become blocks, everything else stays as code ([Importing code](#importing-strudel-code)).
- **Code editor, in sync with the blocks** – the generated Strudel code in a real editor (CodeMirror: syntax and mini-notation highlighting, search, autocompletion for all Strudel functions, sound controls and sound names). Edit it and it plays after a short pause (Ctrl/⌘+Enter right away, Ctrl/⌘+. stops) – no restart; the blocks follow your code, and changing a block updates the code. Code that can't become blocks keeps playing as written ("code mode"). Errors are marked in the code while the last working pattern keeps playing; copy and "Open in Strudel" (strudel.cc) included.
- **See what's playing** – like on strudel.cc, the notes and sounds that are sounding right now light up in the code while it plays.
- **Live without glitches** – changes apply while playing, no restart.
- **Undo/redo** for every change, **autosave** in the browser.
- **Keyboard** – Space (play/stop), Ctrl/⌘+Z and ⇧+Ctrl/⌘+Z, Del (delete block), Esc (deselect), Alt+←/→ (move block), Alt+↑/↓ (move track), Ctrl/⌘+V anywhere to import code.
- **Strudel coverage** – 473 of the 544 functions in the strudel.cc reference run as they are (incl. microtonal tunings, MIDI, device sensors and Csound, loaded only when used); editor widgets like `pianoroll` are ignored, functions that only exist in newer Strudel versions or need an OSC server get a clear message ([`src/data/strudelFunctions.ts`](src/data/strudelFunctions.ts)).
- **AI agents in the browser** – tools for [WebMCP](#webmcp): agents can read the project, add tracks and blocks, set drum patterns and melodies, arrange songs, import code, change the tempo and play.
- **English and German** – picked from the browser language, switchable under **About** (instantly, remembered; `?lang=en|de` also works).
- **Free sounds only** – every sample has a clearly documented free license and is served by strudelmixr itself ([credits](public/samples/CREDITS.md)).
- Dark design, comfortable down to tablet size.

**Browser:** current Chrome, Edge, Firefox or Safari. Audio starts after the first click (browser rule).

## Importing Strudel code

Paste Strudel code anywhere on the page (Ctrl/⌘+V), drop a `.js`/`.txt`/`.strudel` file, or use **Import** in the top bar, the code panel or on the start screen. A strudel.cc share link (`https://strudel.cc/#…`) works too. The dialog shows a live preview of what you'll get before anything changes – open it as a new project or add it to the current one (both undoable).

- `setcpm(…)` / `setcps(…)` → tempo; every `$:` block → a track (named after its label or the comment above it); `_$:` → muted track.
- `let`/`const` instruments combined with `arrange([4, stack(kick, hat)], [8, …])` → one track per instrument plus a song arrangement (variations like `hat.lpf(2000)` become per-section variations); `register(…)` functions and constants → setup code above the tracks.
- Drum patterns that fit a 16-step grid → drum blocks; a `stack(…)` of drum rows with their own volume or effects → one track per instrument; `n(…).scale(…)` → melody blocks; `chord(…).voicing()` → chord blocks; other `s(…)` patterns → sample blocks.
- `lpf`, `hpf`, `room`, `crush`, `distort`, `pan`, ADSR, `fast`, `slow`, `ply`, `jux(rev)`, `degradeBy`, `sometimesBy`, filter sweeps … with plain values → effect and rhythm blocks; `delay` only with an explicit time; `gain` → track volume; `slider(3000, …)` → a real control set to 3000.
- Everything else stays as a code block, in its original place in the chain – it sounds exactly like the original. Every conversion is checked to produce the same events in Strudel as the original code.
- Visual-only editor functions (`_pianoroll`, `punchcard`, `color` …) are left out – they make no sound and also don't break code blocks.
- Sounds strudelmixr doesn't ship (General MIDI soundfonts, drum machine samples with unclear licenses) are swapped for free ones; instruments get a matching shape (e.g. a distorted guitar becomes a sawtooth with distortion, filter and a plucked envelope). The preview lists every swap.

## WebMCP

[WebMCP](https://webmachinelearning.github.io/webmcp/) lets a page offer tools to AI agents in the browser. strudelmixr registers them on start when `document.modelContext` is available (secure context; Chrome: origin trial from 149 or `chrome://flags/#enable-webmcp-testing`):

| Tool | |
|---|---|
| `get_project` | tempo, playback state, tracks with block chains and parameters, generated code |
| `list_block_types`, `list_templates` | available blocks with parameter ranges and values, starter templates |
| `load_template` | load a template (optionally play) |
| `import_strudel_code` | turn Strudel code into a project (replace or add) |
| `add_track`, `update_track`, `remove_track` | tracks with a sound source; name, volume, mute, solo |
| `add_block`, `update_block`, `move_block`, `remove_block` | rhythm and effect blocks, parameters, bypass |
| `set_drum_pattern` | drum steps as strings, e.g. `{"bd": "x---x---x---x---"}` |
| `set_notes` | melody as scale degrees per step, chords as arrays, `null` = rest |
| `create_arrangement`, `add_section`, `update_section`, `remove_section`, `set_section_cell`, `loop_section` | song arrangement: sections, tracks on/off and variations per section |
| `export_midi`, `import_midi` | project ↔ Standard MIDI File (base64), import replaces or adds |
| `set_tempo`, `play`, `stop`, `undo`, `redo` | transport and history |

Every tool goes through the same write API as the UI: changes are visible, audible and undoable right away. Inputs are checked against the block catalog; invalid values return a readable error for the agent. Browsers only allow audio after a user interaction – if `play` cannot start, the user presses play once.

## Development

Everything runs in the [DDEV](https://ddev.com) container (Node 24) – no Node needed on the host.

```bash
ddev start                 # starts the container + Astro dev server (daemon, HMR)
ddev launch                # opens https://strudelmixr.dev.dasachtegebot.local
ddev npm test              # tests (Vitest) – generated code is checked against real Strudel
ddev npm run check         # type check (astro check, TypeScript strictest)
ddev npm run build         # production build (SSR, @astrojs/node standalone) into dist/
ddev exec node dist/server/entry.mjs   # start the production server
ddev logs -s web           # dev server logs
```

The dev server runs as a `web_extra_daemon` (see `.ddev/config.yaml`) and is served through the DDEV router on ports 80/443.

### Deployment

- **Own server (SSR):** `npm run build` + `node dist/server/entry.mjs` – the server renders the page directly in the visitor's language (cookie / `Accept-Language`).
- **Static hosting / GitHub Pages:** `BUILD_TARGET=static BASE_PATH=/strudelmixr/ npm run build` writes a static site to `dist/` (the browser picks the language). Every push to `master` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml): tests, type check, static build, deploy to https://schmarante.github.io/strudelmixr/ (Settings → Pages → Source: **GitHub Actions**).

## Architecture

Astro with **SSR** and **islands**: the server renders the page shell, the interactive parts are isolated React islands. Instead of one monolithic app, "agents" each take care of one job and talk to each other only through **Nano Stores** (details: [`strudel_architecture_specification.md`](strudel_architecture_specification.md)).

```
 UI islands ──actions──▶ visualAstStore ──▶ CompilerAgent ──▶ compiledStrudelCode ──▶ AudioAgent ──▶ 🔊
 (React)       ▲         (nodes + edges)    (pure TS)                               (@strudel/web)
               │                                                                          │
 WebMcpAgent ──┤  (AI agents)        UI ◀──────────── playbackState ◀─────────────────────┘
 ImporterAgent ┘  (Strudel code → blocks)
```

| Part | File | Job |
|---|---|---|
| Data model | `src/types/ast.ts` | Visual AST: tracks head a chain of blocks, linked by edges |
| Block catalog | `src/blocks/catalog.ts` | All blocks with parameters and defaults – single source of truth (texts via `src/blocks/text.ts`) |
| Event bus | `src/store/agentBus.ts` | Nano Stores: AST, settings, code, playback, transport, UI state |
| Write API | `src/store/actions.ts` | The only place that changes the AST – incl. undo/redo |
| Compiler agent | `src/agents/CompilerAgent.ts`, `src/agents/compiler/` | AST → readable Strudel code (`setcpm`, `$:` blocks, compressed drum patterns) |
| Audio agent | `src/agents/AudioAgent.ts`, `src/components/audio/AudioEngine.astro` | Loads Strudel on first play, samples, live updates, errors, playhead |
| Importer agent | `src/agents/importer/` | Strudel code → editable project (the compiler's reverse), with a report of swaps and kept code |
| Code editor | `src/components/ui/editor/`, `src/store/codeSync.ts` | CodeMirror editor; live sync code ↔ blocks (`liveCode.ts`: editor text plays as `codeOverride`, import + ID-preserving `syncProjectFromCode`), highlighter (`activeLocations` from the audio agent) |
| WebMCP agent | `src/agents/WebMcpAgent.ts` | Tools for AI agents in the browser (`document.modelContext`) |
| UI islands | `src/components/ui/` | `TopBar`, `NodeWorkspace`, `ParameterSidebar`, `CodeMonitor` |
| Languages | `src/i18n/` | `en`/`de` language files per area, typed keys (`t('ui.topbar.play')`), SSR language detection |
| Sample slots | `src/store/userSamples.ts`, `src/agents/UserSamplesAgent.ts` | Own samples in IndexedDB, registered with the engine |
| Project files | `src/store/projectFile.ts`, `src/lib/zip.ts` | `strudelmixr.json` + samples as ZIP (own small ZIP reader/writer, no dependency) |
| MIDI | `src/lib/midi/smf.ts`, `src/agents/midi/` | Standard MIDI File reader/writer; MIDI → project (drum grids, melodies, arrangement), project → MIDI (notes from the real Strudel evaluation) |
| Strudel extensions | `src/agents/strudelExtensions.ts`, `src/data/strudelFunctions.ts` | Loads xen/MIDI/motion/Csound on demand; classification of the whole Strudel API |
| Templates | `src/data/templates.ts` | Starter projects |
| Credits | `src/data/credits.ts` | Everything strudelmixr is built on – for **About** and this README |

### Languages

All user-facing texts live in `src/i18n/<lang>/<area>.json` (`common`, `ui`, `blocks`, `templates`, `compiler`, `audio`, `about`, `importer`, `midi`). English is the reference: the German files must have exactly the same keys, otherwise the type check fails – and so do misspelled keys. Placeholders use `{name}`, plurals `{ "one": …, "other": … }`. Language choice: `?lang=` › stored choice (cookie `smx-lang`) › browser language › English.

## License

strudelmixr is free software under the [**GNU AGPL-3.0-or-later**](LICENSE) – like [Strudel](https://codeberg.org/uzu/strudel), on which it is built. Anyone running strudelmixr publicly or passing it on must meet the AGPL obligations (among others, offer the source code to its users). Only samples with a clearly documented free license are used (CC0, Unlicense, CC-BY-3.0, GPL-3.0-or-later) – origin, authors and license texts are listed in [`public/samples/CREDITS.md`](public/samples/CREDITS.md). Required attribution: "Salamander Grand Piano" by Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). All other libraries keep their own licenses (see below and in the app under **About**).

## Built with

<!-- credits:start – generated by scripts/sync-readme.mjs from src/data/credits.ts and src/i18n/en/about.json, do not edit by hand -->
strudelmixr is built on great open-source projects. Thanks to everyone who contributes to them!

### Music engine

| Project | Used for | License |
|---|---|---|
| [Strudel](https://strudel.cc) | Live-coding music in the browser – the heart of strudelmixr | AGPL-3.0-or-later |
| [@strudel/core, mini, transpiler](https://codeberg.org/uzu/strudel) | Patterns, mini-notation and running the generated code | AGPL-3.0-or-later |
| [@strudel/tonal](https://codeberg.org/uzu/strudel) | Scales, chords and voicings | AGPL-3.0-or-later |
| [@strudel/webaudio, superdough, supradough](https://codeberg.org/uzu/strudel) | Sound generation, effects and sample playback (Web Audio) | AGPL-3.0-or-later |
| [@strudel/web, @strudel/draw](https://codeberg.org/uzu/strudel) | Embedding Strudel in your own pages | AGPL-3.0-or-later |
| [Kabelsalat](https://github.com/felixroos/kabelsalat) | Modular audio graphs (used by Strudel) | AGPL-3.0-or-later |
| [TidalCycles](https://tidalcycles.org) | The model for Strudel's pattern language and mini-notation | GPL-3.0 |
| [Tonal](https://github.com/tonaljs/tonal) | Music theory: notes, intervals, scales | MIT |
| [chord-voicings](https://github.com/felixroos/chord-voicings) | Automatic chord voicings | ISC |
| [fraction.js](https://github.com/rawify/Fraction.js) | Exact fractions for timing | MIT |
| [acorn, escodegen, estree-walker](https://github.com/acornjs/acorn) | Parsing and rewriting the Strudel code | MIT / BSD-2-Clause |
| [WEBMIDI.js](https://webmidijs.org) | MIDI support (bundled with Strudel) | Apache-2.0 |
| [@strudel/xen, midi, motion, csound](https://codeberg.org/uzu/strudel) | Microtonal tunings, MIDI in/out, device sensors and Csound – loaded only when code uses them | AGPL-3.0-or-later |
| [Csound (@csound/browser)](https://csound.com) | Csound sound engine for csound() code – loaded only on first use | LGPL-2.1 |

### In the interface

| Project | Used for | License |
|---|---|---|
| [React](https://react.dev) | Interactive islands: mixer, inspector, code view | MIT |
| [Nano Stores](https://github.com/nanostores/nanostores) | State and event bus between the islands | MIT |
| [CodeMirror 6](https://codemirror.net) | Code editor with highlighting, search and autocompletion | MIT |

### Sounds & samples

| Project | Used for | License |
|---|---|---|
| [uzu-drumkit (Switch Angel)](https://github.com/tidalcycles/uzu-drumkit) | Drum kit “Modern” and the default drums – only the files by Switch Angel | Unlicense |
| [FreePats Synthesizer Percussion](https://freepats.zenvoid.org/Percussion/electric-percussion.html) | Drum kit “Analog” (Roberto, zenvoid.org – synthesized with Yoshimi and Geonkick) | CC0-1.0 |
| [Hydrogen TR808EmulationKit](https://github.com/hydrogen-music/hydrogen/tree/master/data/drumkits/TR808EmulationKit) | Drum kit “808” (ArtemioLabs – synthesized from sine waves and noise) | GPL-3.0-or-later |
| [Salamander Grand Piano V2](https://github.com/Tonejs/audio/tree/master/salamander) | Piano sound – Alexander Holm, a selection as MP3 via Tone.js | CC-BY-3.0 |
| [Sonic Pi Samples](https://github.com/sonic-pi-net/sonic-pi/tree/stable/etc/samples) | Sample library: tabla, electro, percussion, glitch, bass, ambient, vinyl | CC0-1.0 |

### For building

| Project | Used for | License |
|---|---|---|
| [Astro](https://astro.build) | Web framework with SSR and islands (@astrojs/node, @astrojs/react) | MIT |
| [Vite](https://vite.dev) | Build tool and dev server | MIT |
| [Tailwind CSS](https://tailwindcss.com) | CSS framework | MIT |
| [TypeScript](https://www.typescriptlang.org) | Type safety (strictest) | Apache-2.0 |
| [Vitest](https://vitest.dev) | Tests – the generated code is checked by real Strudel | MIT |
| [DDEV](https://ddev.com) | Local development environment (Docker) | Apache-2.0 |
| [Claude Code](https://claude.com/claude-code) | AI pair programming during development | proprietary |

---

<p align="center">Designed with ❤️. Powered by Claude.</p>
<!-- credits:end -->
