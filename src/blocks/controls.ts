/**
 * Alle Strudel-Controls (Klang-Parameter wie `lpf`, `fmh`, `wtdepth`) der
 * installierten Version (@strudel/core 1.2.6) – als Daten, ohne Strudel zu laden.
 *
 * Grundlage für
 *  - den Baustein „Beliebiger Parameter“ (nur bekannte Namen werden erzeugt),
 *  - die Autovervollständigung in der UI (Name, Aliase, Gruppe),
 *  - den Abdeckungs-Test (src/agents/__tests__/compiler-coverage.test.ts prüft
 *    diese Liste exakt gegen die Controls, die Strudel zur Laufzeit registriert).
 *
 * Gruppen-Anzeigenamen: blocks.controlGroups.<gruppe> in src/i18n/<sprache>/blocks.json.
 */

export type ControlGroup =
  | 'sound'
  | 'envelope'
  | 'pitch'
  | 'filter'
  | 'filterEnvelope'
  | 'filterLfo'
  | 'fm'
  | 'wavetable'
  | 'sample'
  | 'distortion'
  | 'modulation'
  | 'space'
  | 'dynamics'
  | 'synth'
  | 'voicing'
  | 'routing'
  | 'external'
  | 'superdirt'
  | 'meta';

export interface ControlInfo {
  /** Hauptname (so steht er im Hap-Wert, z. B. `cutoff`). */
  name: string;
  /** Weitere Schreibweisen, die dasselbe setzen (z. B. `lpf`, `lp`, `ctf`). */
  aliases: readonly string[];
  group: ControlGroup;
}

/** Gruppen in Anzeige-Reihenfolge (häufig gebraucht → selten). */
export const CONTROL_GROUPS: readonly ControlGroup[] = [
  'sound',
  'envelope',
  'filter',
  'filterEnvelope',
  'filterLfo',
  'pitch',
  'fm',
  'wavetable',
  'synth',
  'sample',
  'distortion',
  'modulation',
  'space',
  'dynamics',
  'voicing',
  'routing',
  'external',
  'superdirt',
  'meta',
];

/**
 * Gruppen, die im Browser (superdough) hörbar sind. `external` = MIDI/OSC,
 * `superdirt` = nur mit SuperCollider/SuperDirt, `meta` = Anzeige/Steuerung.
 */
export const WEBAUDIO_GROUPS: ReadonlySet<ControlGroup> = new Set(
  CONTROL_GROUPS.filter((g) => g !== 'external' && g !== 'superdirt' && g !== 'meta'),
);

/* Kompakte Schreibweise: „hauptname alias1 alias2 …“ */
const TABLE: Record<ControlGroup, readonly string[]> = {
  sound: [
    's sound',
    'n',
    'note',
    'bank',
    'source src',
    'freq',
    'octave oct',
    'velocity vel',
    'gain',
    'postgain',
    'amp',
    'clip legato',
    'duration dur',
  ],
  envelope: ['attack att', 'decay dec', 'sustain sus', 'release rel'],
  pitch: ['pattack patt', 'pdecay pdec', 'psustain psus', 'prelease prel', 'penv', 'pcurve', 'panchor', 'vib vibrato v', 'vibmod vmod'],
  filter: [
    'cutoff lpf lp ctf',
    'resonance lpq',
    'hcutoff hpf hp',
    'hresonance hpq',
    'bandf bpf bp',
    'bandq bpq',
    'ftype',
    'fanchor',
    'drive',
    'djf',
    'vowel',
  ],
  filterEnvelope: ['lp', 'hp', 'bp'].flatMap((f) => [
    `${f}env ${f}e`,
    `${f}attack ${f}a`,
    `${f}decay ${f}d`,
    `${f}sustain ${f}s`,
    `${f}release ${f}r`,
  ]),
  filterLfo: ['lp', 'hp', 'bp'].flatMap((f) => [
    `${f}rate`,
    `${f}sync`,
    `${f}depth`,
    `${f}depthfrequency ${f}depthfreq`,
    `${f}shape`,
    `${f}dc`,
    `${f}skew`,
  ]),
  fm: [
    // FM 1 – in Strudel 1.2.6 zeigt der Alias `fmh1` (eigentlich) auf `fmi`.
    'fmi fm fm1 fmi1 fmh1',
    'fmh',
    'fmenv fmenv1',
    'fmattack fmatt fmatt1 fmattack1',
    'fmdecay fmdec fmdec1 fmdecay1',
    'fmsustain fmsus fmsus1 fmsustain1',
    'fmrelease fmrel fmrel1 fmrelease1',
    'fmwave fmwave1',
    // FM 2 … 8
    ...[2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
      `fmi${i} fm${i}`,
      `fmh${i}`,
      `fmenv${i}`,
      `fmattack${i} fmatt${i}`,
      `fmdecay${i} fmdec${i}`,
      `fmsustain${i} fmsus${i}`,
      `fmrelease${i} fmrel${i}`,
      `fmwave${i}`,
    ]),
    // FM-Matrix: fmi<von><nach>, z. B. fm13 schickt FM 1 in FM 3
    ...Array.from({ length: 81 }, (_, k) => `fmi${Math.floor(k / 9)}${k % 9} fm${Math.floor(k / 9)}${k % 9}`),
  ],
  wavetable: [
    'wt wavetablePosition',
    'wtenv',
    'wtattack wtatt',
    'wtdecay wtdec',
    'wtsustain wtsus',
    'wtrelease wtrel',
    'wtrate',
    'wtsync',
    'wtdepth',
    'wtshape',
    'wtdc',
    'wtskew',
    'wtphaserand wavetablePhaseRand',
    'warp wavetableWarp',
    'warpmode wavetableWarpMode',
    'warpenv',
    'warpattack warpatt',
    'warpdecay warpdec',
    'warpsustain warpsus',
    'warprelease warprel',
    'warprate',
    'warpsync',
    'warpdepth',
    'warpshape',
    'warpdc',
    'warpskew',
  ],
  synth: [
    'unison',
    'spread',
    'detune det',
    'noise',
    'density',
    'pw',
    'pwrate',
    'pwsweep',
    'byteBeatExpression bbexpr',
    'byteBeatStartTime bbst',
    'zzfx',
    'zrand',
    'curve',
    'slide',
    'deltaSlide',
    'pitchJump',
    'pitchJumpTime',
    'znoise',
    'zmod',
    'zcrush',
    'zdelay',
  ],
  sample: ['begin', 'end', 'speed', 'unit', 'cut', 'loop', 'loopBegin loopb', 'loopEnd loope', 'stretch', 'nudge'],
  distortion: ['distort dist', 'distortvol distvol', 'distorttype disttype', 'shape', 'crush', 'coarse'],
  modulation: [
    'tremolo trem',
    'tremolosync tremsync',
    'tremolodepth tremdepth',
    'tremoloskew tremskew',
    'tremolophase tremphase',
    'tremoloshape tremshape',
    'phaserrate phaser ph',
    'phaserdepth phd phasdp',
    'phasercenter phc',
    'phasersweep phs',
  ],
  space: [
    'pan',
    'room',
    'roomsize size sz rsize',
    'roomlp rlp',
    'roomdim rdim',
    'roomfade rfade',
    'ir iresponse',
    'irspeed',
    'irbegin',
    'delay',
    'delayfeedback delayfb dfb',
    'delaytime delayt dt',
    'delaysync',
    'dry',
  ],
  dynamics: [
    'compressor',
    'compressorRatio',
    'compressorKnee',
    'compressorAttack',
    'compressorRelease',
    'duckorbit duck',
    'duckdepth',
    'duckonset duckons',
    'duckattack duckatt',
    'transient',
  ],
  voicing: ['chord', 'dictionary dict', 'anchor', 'offset', 'octaves', 'mode'],
  routing: ['orbit o', 'bus', 'busgain bgain', 'channels ch', 'channel', 'FXrelease FXrel FXr fxr', 'analyze', 'fft'],
  external: [
    'midichan',
    'midimap',
    'midiport',
    'midicmd',
    'ccn',
    'ccv',
    'ctlNum',
    'nrpnn',
    'nrpv',
    'progNum',
    'sysexid',
    'sysexdata',
    'midibend',
    'miditouch',
    'polyTouch',
    'expression',
    'sustainpedal',
    'oschost',
    'oscport',
  ],
  superdirt: [
    'hold',
    'accelerate',
    'chorus',
    'delayspeed',
    'lock',
    'fadeTime fadeOutTime',
    'fadeInTime',
    'gate gat',
    'leslie',
    'lrate',
    'lsize',
    'degree',
    'mtranspose',
    'ctranspose',
    'harmonic',
    'stepsPerOctave',
    'octaveR',
    'semitone',
    'voice',
    'overgain',
    'overshape',
    'panspan',
    'pansplay',
    'panwidth',
    'panorient',
    'squiz',
    'waveloss',
    'fshift',
    'fshiftnote',
    'fshiftphase',
    'triode',
    'krush',
    'kcutoff',
    'octer',
    'octersub',
    'octersubsub',
    'ring',
    'ringf',
    'ringdf',
    'freeze',
    'xsdelay',
    'tsdelay',
    'real',
    'imag',
    'enhance',
    'comb',
    'smear',
    'scram',
    'binshift',
    'hbrick',
    'lbrick',
  ],
  meta: [
    'label',
    'activeLabel',
    'color',
    'uid',
    'val',
    'cps',
    'frameRate',
    'frames',
    'hours',
    'minutes',
    'seconds',
    'songPtr',
  ],
};

/** Alle Controls (Hauptnamen), gruppiert in Anzeige-Reihenfolge. */
export const CONTROLS: readonly ControlInfo[] = CONTROL_GROUPS.flatMap((group) =>
  TABLE[group].map((entry) => {
    const [name, ...aliases] = entry.split(' ') as [string, ...string[]];
    return { name, aliases, group };
  }),
);

const BY_NAME: ReadonlyMap<string, ControlInfo> = new Map(
  CONTROLS.flatMap((c) => [c.name, ...c.aliases].map((n) => [n, c] as const)),
);

/** Alle gültigen Schreibweisen (Hauptnamen + Aliase). */
export const CONTROL_NAMES: ReadonlySet<string> = new Set(BY_NAME.keys());

/** Control zu einem Namen oder Alias (z. B. „lpf“ → cutoff). */
export function findControl(name: string): ControlInfo | undefined {
  return BY_NAME.get(name);
}

export function isControlName(name: string): boolean {
  return BY_NAME.has(name);
}

/** Ist der Control im Browser hörbar (nicht nur MIDI/OSC/SuperDirt)? */
export function isWebAudioControl(name: string): boolean {
  const c = BY_NAME.get(name);
  return c !== undefined && WEBAUDIO_GROUPS.has(c.group);
}

/** Tippfehler-Distanz (Levenshtein + vertauschte Nachbarbuchstaben, „lfp“ ↔ „lpf“ = 1). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Ähnlichster bekannter Name für einen Tippfehler („lfp“ → „lpf“), oder
 * undefined, wenn nichts nahe genug ist. Bevorzugt im Browser hörbare Controls.
 */
export function suggestControl(input: string): string | undefined {
  const needle = input.trim();
  if (needle === '') return undefined;
  const lower = needle.toLowerCase();
  const exactCase = [...CONTROL_NAMES].find((n) => n.toLowerCase() === lower);
  if (exactCase) return exactCase;
  const max = needle.length <= 3 ? 1 : 2;
  let best: { name: string; d: number; web: boolean } | undefined;
  for (const name of CONTROL_NAMES) {
    if (Math.abs(name.length - needle.length) > max) continue;
    const d = distance(lower, name.toLowerCase());
    if (d > max) continue;
    const web = isWebAudioControl(name);
    if (!best || d < best.d || (d === best.d && web && !best.web)) best = { name, d, web };
  }
  return best?.name;
}
