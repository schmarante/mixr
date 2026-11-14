import { ARP_PATTERNS, DRUM_INSTRUMENTS } from '../../blocks/catalog';
import { findControl, isControlName, suggestControl } from '../../blocks/controls';
import type { BlockNode, BlockType, ModifierBlockType, EffectBlockType, SourceBlockType } from '../../types/ast';
import { bracketsBalanced, fmtNum, quote, sanitizeMini, trimCode } from './format';
import { t } from '../../i18n';
import { ParamError, paramError, type ParamReader } from './params';
import { compressSequence, drumRow, heldNoteSequence, noteToken } from './sequence';

/**
 * Übersetzung einzelner Blöcke in Strudel-Code.
 *
 * Alle Funktionsnamen sind gegen die installierte Strudel-Version (1.2.6,
 * superdough 1.3.0) geprüft – siehe src/agents/__tests__/strudel-api.test.ts und
 * compiler-coverage.test.ts (`covers` im Katalog).
 */

/** Freie Sample-/Synth-Namen (für lockere Auswahlfelder). */
const SOUND_NAME = /^[A-Za-z0-9_.-]+(:\d+)?$/;
const BANK_NAME = /^[A-Za-z0-9_-]+$/;
const DRUM_NAME = /^[A-Za-z0-9_]+(:\d+)?$/;

/** Was der Compiler über die Klangquelle wissen muss, um Modifier anzupassen. */
export interface SourceInfo {
  type: SourceBlockType;
  /** Tonhöhenfaktor der Sample-Quelle (für „Oktave höher“). */
  speed: number;
}

export interface BlockContext {
  source: SourceInfo;
  /** Drum-Raster darf ausgedünnt werden (keine Hüllkurve / kein freier Code in der Spur). */
  stretchDrums: boolean;
}

/** Validiert Mini-Notation aus Nutzereingaben. */
function mini(p: ParamReader, key: string, text: string): string {
  const clean = sanitizeMini(text);
  if (clean === '') throw paramError('empty', p.label(key));
  if (!bracketsBalanced(clean)) throw paramError('brackets', p.label(key));
  return clean;
}

/* ------------------------------------------------------------------ */
/* Klangquellen                                                        */
/* ------------------------------------------------------------------ */

type SourceEmitter = (p: ParamReader, ctx: BlockContext) => string;

const SOURCES: Record<SourceBlockType, SourceEmitter> = {
  drums(p, ctx) {
    const grid = p.drumGrid('grid');
    const bank = p.select('bank', BANK_NAME);
    const known = DRUM_INSTRUMENTS.map((i) => i.value);
    const names = [...known.filter((n) => n in grid.rows), ...Object.keys(grid.rows).filter((n) => !known.includes(n))];
    const layers = names
      .filter((name) => DRUM_NAME.test(name) && grid.rows[name]!.some(Boolean))
      .map((name) => drumRow(name, grid.rows[name]!, { stretch: ctx.stretchDrums }));
    if (layers.length === 0) throw new ParamError(t('compiler.block.emptyDrumGrid'));
    const bankCall = bank === 'default' ? '' : `.bank(${quote(bank)})`;
    return `s(${quote(layers.join(', '))})${bankCall}`;
  },

  melody(p) {
    const grid = p.noteGrid('grid');
    const sound = p.select('sound', SOUND_NAME);
    const root = p.select('root');
    const scale = p.select('scale');
    const octave = p.select('octave');
    if (grid.cells.every((c) => c.length === 0)) throw new ParamError(t('compiler.block.emptyNoteGrid'));
    const bars = grid.bars ?? 1;
    const held = grid.lengths?.some((row) => row.some((l) => l > 1)) ?? false;
    // Ohne Haltetöne und mehrere Takte: kompakte Schreibweise wie bisher
    const seq =
      held || bars > 1
        ? heldNoteSequence(grid.cells, grid.lengths ?? [], grid.steps * bars)
        : compressSequence(grid.cells.map(noteToken), { stretch: false });
    const span = bars > 1 ? `.slow(${bars})` : '';
    return `n(${quote(seq)})${span}.scale(${quote(`${root}${octave}:${scale}`)}).s(${quote(sound)})`;
  },

  chords(p) {
    const custom = sanitizeMini(p.text('custom'));
    let progression: string;
    if (custom !== '') {
      progression = mini(p, 'custom', custom);
      // „Jeder Akkord dauert einen Takt“: ohne eigene Klammerung als <…> lesen.
      if (!/[<[{]/.test(progression)) progression = `<${progression}>`;
    } else {
      progression = mini(p, 'progression', p.select('progression', /^.+$/));
    }
    const sound = p.select('sound', SOUND_NAME);
    const rhythm = p.select('rhythm');
    const struct = rhythm === 'quarter' ? '.struct("x*4")' : rhythm === 'offbeat' ? '.struct("[~ x]*4")' : '';
    return `chord(${quote(progression)}).voicing()${struct}.s(${quote(sound)})`;
  },

  sample(p) {
    const pattern = mini(p, 'pattern', p.text('pattern'));
    const speed = p.number('speed');
    return `s(${quote(pattern)})${speed === 1 ? '' : `.speed(${fmtNum(speed)})`}`;
  },

  code(p) {
    const code = trimCode(p.text('code'));
    if (code === '') throw new ParamError(t('compiler.block.emptyCode'));
    return code;
  },
};

/** Liest die Infos der Quelle, die Modifier später brauchen (ohne Fehler zu werfen). */
export function sourceInfo(block: BlockNode, p: ParamReader): SourceInfo {
  let speed = 1;
  if (block.type === 'sample') {
    try {
      speed = p.number('speed');
    } catch {
      /* Quelle wird ohnehin übersprungen */
    }
  }
  return { type: block.type as SourceBlockType, speed };
}

/* ------------------------------------------------------------------ */
/* Modifier & Effekte                                                  */
/* ------------------------------------------------------------------ */

type ChainEmitter = (p: ParamReader, ctx: BlockContext) => string;

/** Regler 0…1 → Strudel-`distort` 0…4 (sinnvoller Bereich dort: ca. 0…10). */
export const DISTORT_SCALE = 4;

/**
 * Tonhöhe um `semitones` verschieben – als Funktion für off/superimpose/firstOf …
 * Melodie/Akkorde/Code liefern Notennamen (→ transpose; Nicht-Noten ignoriert
 * transpose gefahrlos), Drums/Samples werden über die Abspielgeschwindigkeit
 * verschoben (speed relativ zur Tonhöhe der Sample-Quelle).
 */
function pitchFn(source: SourceInfo, semitones: number): string {
  return semitones === 0 ? 'x => x' : `x => x${pitchCall(source, semitones)}`;
}

function pitchCall(source: SourceInfo, semitones: number): string {
  switch (source.type) {
    case 'drums':
      return `.speed(${fmtNum(2 ** (semitones / 12))})`;
    case 'sample':
      return `.speed(${fmtNum(source.speed * 2 ** (semitones / 12))})`;
    default:
      return `.transpose(${fmtNum(semitones)})`;
  }
}

/** „Eine Oktave höher“ – abhängig davon, ob die Quelle Noten oder Samples liefert. */
function octaveUp(source: SourceInfo): string {
  return pitchFn(source, 12);
}

/** Abwandlung für „Variation“ und „Abschnittsweise“. */
function variationFn(action: string, ctx: BlockContext): string {
  switch (action) {
    case 'rev':
      return 'x => x.rev()';
    case 'fast':
      return 'x => x.fast(2)';
    case 'up':
      return octaveUp(ctx.source);
    default:
      return 'x => x.degradeBy(0.5)';
  }
}

function dotted(code: string): string {
  return code.startsWith('.') ? code : `.${code}`;
}

const int = (p: ParamReader, key: string) => Math.round(p.number(key));

/** Zahl in freier Eingabe: „0.5“, „-3“, „.25“, „1e3“ (sonst Mini-Notation). */
const PLAIN_NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Kurzfassung eines Nutzertexts für Diagnosen. */
function short(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 30 ? `${oneLine.slice(0, 29)}…` : oneLine;
}

const MODIFIERS: Record<ModifierBlockType, ChainEmitter> = {
  fast: (p) => `.fast(${fmtNum(p.number('factor'))})`,
  slow: (p) => `.slow(${fmtNum(p.number('factor'))})`,
  rev: () => '.rev()',
  firstOf: (p, ctx) => `.firstOf(${int(p, 'every')}, ${variationFn(p.select('action'), ctx)})`,
  degrade: (p) => `.degradeBy(${fmtNum(p.number('amount'))})`,
  ply: (p) => `.ply(${int(p, 'times')})`,
  jux(p) {
    const width = p.number('width');
    return width === 1 ? '.jux(rev)' : `.juxBy(${fmtNum(width)}, rev)`;
  },
  sometimes(p, ctx) {
    const chance = fmtNum(p.number('chance'));
    const action = p.select('action');
    const fn = action === 'ply' ? 'x => x.ply(2)' : action === 'up' ? octaveUp(ctx.source) : 'x => x.crush(4)';
    return `.sometimesBy(${chance}, ${fn})`;
  },
  euclid(p) {
    const steps = int(p, 'steps');
    const pulses = Math.min(int(p, 'pulses'), steps);
    const rotation = int(p, 'rotation') % steps;
    return rotation === 0 ? `.euclid(${pulses}, ${steps})` : `.euclidRot(${pulses}, ${steps}, ${rotation})`;
  },
  off: (p, ctx) => `.off(${fmtNum(Number(p.select('time')))}, ${pitchFn(ctx.source, Number(p.select('interval')))})`,
  echo(p) {
    // echo() setzt `gain` und würde von der Spur-Lautstärke (.gain am Ende)
    // überschrieben – daher leiser werdende Wiederholungen über `velocity`.
    const times = int(p, 'times');
    const time = fmtNum(Number(p.select('time')));
    return `.echoWith(${times}, ${time}, (x, i) => x.velocity(${fmtNum(p.number('feedback'))} ** i))`;
  },
  chunk: (p, ctx) => `.fastChunk(${int(p, 'parts')}, ${variationFn(p.select('action'), ctx)})`,
  iter: (p) => `.${p.toggle('backwards') ? 'iterBack' : 'iter'}(${int(p, 'parts')})`,
  palindrome: () => '.palindrome()',
  swing: (p) => `.swingBy(${fmtNum(p.number('amount'))}, ${Number(p.select('grid'))})`,
  linger: (p) => `.linger(${fmtNum(Number(p.select('part')))})`,
  segment: (p) => `.segment(${int(p, 'steps')})`,
  shuffle: (p) => `.${p.select('mode')}(${int(p, 'parts')})`,
  mask: (p) => `.mask(${quote(mini(p, 'pattern', p.text('pattern')))})`,
  transpose: (p, ctx) => pitchCall(ctx.source, int(p, 'semitones')),
  scaleTranspose(p, ctx) {
    // braucht Skalen-Kontext (.scale) – den liefern Melodie (und evtl. freier Code)
    if (ctx.source.type !== 'melody' && ctx.source.type !== 'code') {
      throw new ParamError(t('compiler.block.needsScale'));
    }
    return `.scaleTranspose(${int(p, 'steps')})`;
  },
  arp(p) {
    const custom = sanitizeMini(p.text('custom'));
    const pattern = custom !== '' ? mini(p, 'custom', custom) : ARP_PATTERNS[p.select('mode')]!;
    const speed = int(p, 'speed');
    return `.arp(${quote(speed === 1 ? pattern : `[${pattern}]*${speed}`)})`;
  },
  superimpose: (p, ctx) => `.superimpose(${pitchFn(ctx.source, Number(p.select('interval')))})`,
  vib: (p) => `.vib(${fmtNum(p.number('rate'))}).vibmod(${fmtNum(p.number('depth'))})`,
  chop: (p) => `.chop(${int(p, 'parts')})`,
  striate: (p) => `.striate(${int(p, 'parts')})`,
  slice: (p) => `.slice(${int(p, 'parts')}, ${quote(mini(p, 'order', p.text('order')))})`,
  loopAt: (p) => `.loopAt(${int(p, 'bars')})`,
  'code-mod'(p) {
    const code = trimCode(p.text('code'));
    if (code === '' || code === '.') throw new ParamError(t('compiler.block.emptyCode'));
    return dotted(code);
  },
};

/** Waveshaping-Standard von superdough – wird nicht ausgeschrieben. */
const DEFAULT_DISTORT_TYPE = 'scurve';

const EFFECTS: Record<EffectBlockType, ChainEmitter> = {
  lpf(p) {
    const q = p.number('resonance');
    return `.lpf(${fmtNum(p.number('cutoff'), 0)})${q === 1 ? '' : `.lpq(${fmtNum(q)})`}`;
  },
  hpf(p) {
    const q = p.number('resonance');
    return `.hpf(${fmtNum(p.number('cutoff'), 0)})${q === 1 ? '' : `.hpq(${fmtNum(q)})`}`;
  },
  sweep(p) {
    const min = fmtNum(p.number('min'), 0);
    const max = fmtNum(p.number('max'), 0);
    const cycles = int(p, 'cycles');
    const shape = p.select('shape');
    const filter = p.select('filter');
    const slow = cycles === 1 ? '' : `.slow(${cycles})`;
    return `.${filter}(${shape}.range(${min}, ${max})${slow})`;
  },
  filterEnv(p) {
    const q = p.number('resonance');
    return (
      `.lpf(${fmtNum(p.number('cutoff'), 0)})${q === 1 ? '' : `.lpq(${fmtNum(q)})`}` +
      `.lpenv(${fmtNum(p.number('amount'))}).lpa(${fmtNum(p.number('attack'))}).lpd(${fmtNum(p.number('decay'))})` +
      `.lps(${fmtNum(p.number('sustain'))}).lpr(${fmtNum(p.number('release'))})`
    );
  },
  room: (p) => `.room(${fmtNum(p.number('amount'))}).roomsize(${fmtNum(p.number('size'))})`,
  delay(p) {
    // delaysync = Echo-Abstand in Zyklen (Takten) → automatisch tempo-synchron.
    const time = Number(p.select('time'));
    return `.delay(${fmtNum(p.number('amount'))}).delaysync(${fmtNum(time)}).delayfeedback(${fmtNum(p.number('feedback'))})`;
  },
  crush: (p) => `.crush(${int(p, 'bits')})`,
  coarse: (p) => `.coarse(${int(p, 'amount')})`,
  // distort ist in Strudel ab ~0 bis 10 sinnvoll; der Regler (0…1) wird auf 0…4 abgebildet.
  distort(p) {
    const type = p.select('type');
    const typeCall = type === DEFAULT_DISTORT_TYPE ? '' : `.distorttype(${quote(type)})`;
    return `.distort(${fmtNum(p.number('amount') * DISTORT_SCALE, 2)})${typeCall}`;
  },
  phaser(p) {
    const depth = p.number('depth');
    return `.phaser(${fmtNum(p.number('rate'))})${depth === 0.75 ? '' : `.phaserdepth(${fmtNum(depth)})`}`;
  },
  vowel: (p) => `.vowel(${quote(p.select('vowel'))})`,
  tremolo: (p) => `.tremolosync(${Number(p.select('rate'))}).tremolodepth(${fmtNum(p.number('depth'))})`,
  compressor(p) {
    // knee/attack/release nur, wenn sie vom superdough-Standard abweichen
    const knee = p.number('knee');
    const attack = p.number('attack');
    const release = p.number('release');
    return (
      `.compressor(${fmtNum(p.number('threshold'))}).compressorRatio(${fmtNum(p.number('ratio'))})` +
      (knee === 10 ? '' : `.compressorKnee(${fmtNum(knee)})`) +
      (attack === 0.005 ? '' : `.compressorAttack(${fmtNum(attack)})`) +
      (release === 0.05 ? '' : `.compressorRelease(${fmtNum(release)})`)
    );
  },
  postgain: (p) => `.postgain(${fmtNum(p.number('level'))})`,
  pan: (p) => `.pan(${fmtNum(p.number('position'))})`,
  adsr: (p) =>
    `.attack(${fmtNum(p.number('attack'))}).decay(${fmtNum(p.number('decay'))})` +
    `.sustain(${fmtNum(p.number('sustain'))}).release(${fmtNum(p.number('release'))})`,
  fm(p) {
    const wave = p.select('wave');
    const decay = p.number('decay');
    return (
      `.fm(${fmtNum(p.number('amount'))}).fmh(${fmtNum(p.number('ratio'))})` +
      (wave === 'sine' ? '' : `.fmwave(${quote(wave)})`) +
      (decay === 0 ? '' : `.fmdecay(${fmtNum(decay)}).fmsustain(${fmtNum(p.number('sustain'))})`)
    );
  },
  sampleRange(p) {
    const begin = p.number('begin');
    const end = p.number('end');
    if (end <= begin) throw new ParamError(t('compiler.block.rangeOrder'));
    return `.begin(${fmtNum(begin)}).end(${fmtNum(end)})`;
  },
  cut: (p) => `.cut(${int(p, 'group')})`,
  param(p) {
    const name = p.text('name').trim();
    if (name === '') throw paramError('empty', p.label('name'));
    if (!isControlName(name)) {
      const suggestion = suggestControl(name);
      throw new ParamError(
        suggestion
          ? t('compiler.block.unknownControlSuggest', { name: short(name), suggestion })
          : t('compiler.block.unknownControl', { name: short(name) }),
      );
    }
    const value = p.text('value').trim();
    if (PLAIN_NUMBER.test(value)) return `.${name}(${String(Number(value))})`;
    return `.${name}(${quote(mini(p, 'value', value))})`;
  },
  'code-fx'(p) {
    const code = trimCode(p.text('code'));
    if (code === '' || code === '.') throw new ParamError(t('compiler.block.emptyCode'));
    return dotted(code);
  },
};

export function isSourceType(type: BlockType): type is SourceBlockType {
  return type in SOURCES;
}

export function emitSource(type: SourceBlockType, p: ParamReader, ctx: BlockContext): string {
  return SOURCES[type](p, ctx);
}

export function emitChainBlock(type: ModifierBlockType | EffectBlockType, p: ParamReader, ctx: BlockContext): string {
  return type in MODIFIERS
    ? MODIFIERS[type as ModifierBlockType](p, ctx)
    : EFFECTS[type as EffectBlockType](p, ctx);
}

/**
 * Blöcke, die Hap-Dauern hörbar machen oder die Struktur neu rastern
 * (→ Drum-Raster nicht ausdünnen, sonst ändern sich Töne/Onsets).
 */
export const DURATION_SENSITIVE: ReadonlySet<BlockType> = new Set<BlockType>([
  'adsr',
  'filterEnv',
  'fm',
  'euclid',
  'segment',
  'chop',
  'striate',
  'slice',
  'loopAt',
  'param',
  'code-mod',
  'code-fx',
]);

/** Blöcke mit orbit-globalen Effekten (Hall/Echo teilen sich pro Orbit einen Effektbus). */
export const ORBIT_EFFECTS: ReadonlySet<BlockType> = new Set<BlockType>(['room', 'delay']);

const ROOM_CONTROLS = new Set(['room', 'roomsize', 'roomlp', 'roomdim', 'roomfade', 'ir', 'irspeed', 'irbegin']);
const DELAY_CONTROLS = new Set(['delay', 'delayfeedback', 'delaytime', 'delaysync']);

/** Welchen orbit-globalen Effekt nutzt der Block (Hall, Echo oder keinen)? */
export function orbitEffect(block: BlockNode): 'room' | 'delay' | null {
  if (block.type === 'room') return 'room';
  if (block.type === 'delay') return 'delay';
  if (block.type === 'param' && typeof block.params.name === 'string') {
    const main = findControl(block.params.name.trim())?.name;
    if (main && ROOM_CONTROLS.has(main)) return 'room';
    if (main && DELAY_CONTROLS.has(main)) return 'delay';
  }
  return null;
}
