# Samples in mixr

Every sound in this folder is under a free license with a clearly documented source, and is served
by mixr itself (no external CDN). Each folder registers its sounds through its `strudel.json` map.

| Folder | Source | Author | License | Proof |
|---|---|---|---|---|
| `drums/modern/` | [uzu-drumkit](https://github.com/tidalcycles/uzu-drumkit) – only the Switch Angel files | Switch Angel | Unlicense | `drums/modern/LICENSE` |
| `drums/analog/` | [FreePats Synthesizer Percussion](https://freepats.zenvoid.org/Percussion/electric-percussion.html), version 2022-07-18 | Roberto (zenvoid.org) | CC0-1.0 | `drums/analog/LICENSE`, `readme.txt` |
| `drums/emu808/` | [Hydrogen TR808EmulationKit](https://github.com/hydrogen-music/hydrogen/tree/master/data/drumkits/TR808EmulationKit) (synthesized, no recordings of real machines) | ArtemioLabs | GPL-3.0-or-later | `drums/emu808/drumkit.xml`, `COPYING` |
| `piano/` | Salamander Grand Piano V2 – 30 notes in minor thirds as MP3 from [Tone.js audio](https://github.com/Tonejs/audio/tree/master/salamander) (original: [archive.org](https://archive.org/details/SalamanderGrandPianoV3)) | Alexander Holm | CC-BY-3.0 | `piano/README.tonejs.txt` |
| `sonicpi/` | [Sonic Pi](https://github.com/sonic-pi-net/sonic-pi/tree/stable/etc/samples) – a selection | Sonic Pi project / Freesound authors | CC0-1.0 | `sonicpi/LICENSE.sonic-pi.md`, `README.sources.md` |

**Attribution (CC-BY-3.0):** "Salamander Grand Piano" by Alexander Holm, licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). mixr uses a selection of 30 notes (MP3).

**GPL:** the FLAC files in `drums/emu808/` are taken unchanged from the Hydrogen project
(GPL-3.0-or-later, see `COPYING`).

Deliberately **not** used: Dirt-Samples, tidal-drum-machines and the Strudel CDN (unclear license),
the `*_mot4i` files and the Amen break from uzu-drumkit, `loop_amen*` from Sonic Pi.
