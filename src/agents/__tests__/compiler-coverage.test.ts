import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCK_CATALOG, OPTION_SETS, defaultParams } from '../../blocks/catalog';
import { CONTROLS, CONTROL_GROUPS, CONTROL_NAMES, WEBAUDIO_GROUPS, findControl, isWebAudioControl, suggestControl } from '../../blocks/controls';
import type { BlockNode, BlockType, EffectBlockType, ModifierBlockType, ParamValues } from '../../types/ast';
import { emitChainBlock, type BlockContext } from '../compiler/blocks';
import { ParamReader } from '../compiler/params';
import { core, evaluateStrudel } from './strudelHarness';

/**
 * Abdeckung der Strudel-API durch die Bausteine.
 *
 *  - `covers` jedes Bausteins nennt nur Funktionen/Controls, die es in der
 *    installierten Strudel-Version gibt – und alles, was der Baustein erzeugt.
 *  - src/blocks/controls.ts entspricht exakt den Controls, die Strudel zur
 *    Laufzeit registriert (Hauptname + Aliase). Neue Strudel-Version mit neuen
 *    Controls → dieser Test schlägt fehl und nennt die Unterschiede.
 */

const g = globalThis as Record<string, unknown>;
const proto = () => core.Pattern.prototype as unknown as Record<string, unknown>;
const isControl = (name: string) => (core as unknown as { isControlName(n: string): boolean }).isControlName(name);
const controlName = (name: string) => (core as unknown as { getControlName(n: string): string }).getControlName(name);

beforeAll(async () => {
  await evaluateStrudel('$: s("bd")'); // registriert den Scope inkl. tonal
});

/** Existiert der Name als Pattern-Methode oder globale Funktion/Signal in Strudel? */
function existsInStrudel(name: string): boolean {
  return typeof proto()[name] === 'function' || g[name] !== undefined;
}

const types = Object.keys(BLOCK_CATALOG) as BlockType[];
const chainTypes = types.filter((t) => BLOCK_CATALOG[t].kind !== 'source') as Array<ModifierBlockType | EffectBlockType>;
const FREE = new Set<BlockType>(['code', 'code-mod', 'code-fx', 'param']);

/** Alle Namen, die ein Stück erzeugter Code aufruft (Methoden, Funktionen, Signale). */
function calledNames(js: string): string[] {
  const code = js.replace(/"[^"]*"/g, '""'); // Mini-Notation zählt nicht
  const methods = [...code.matchAll(/\.([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]!);
  const bare = [...code.matchAll(/(?<![.\w"])([A-Za-z_]\w*)(?![\w"(])/g)].map((m) => m[1]!);
  const signals = bare.filter((n) => !['x', 'i'].includes(n) && Number.isNaN(Number(n)));
  return [...methods, ...signals];
}

function emit(type: ModifierBlockType | EffectBlockType, params: ParamValues, ctx: BlockContext): string {
  const block: BlockNode = { id: 'b', type, params: { ...defaultParams(type), ...params } };
  return emitChainBlock(type, new ParamReader(block, BLOCK_CATALOG[type]), ctx);
}

describe('covers', () => {
  it('jeder Baustein außer freiem Code / Beliebigem Parameter deckt mindestens eine Strudel-Funktion ab', () => {
    for (const type of types) {
      if (FREE.has(type)) expect(BLOCK_CATALOG[type].covers, type).toEqual([]);
      else expect(BLOCK_CATALOG[type].covers.length, type).toBeGreaterThan(0);
    }
  });

  it('alle covers-Einträge existieren in der installierten Strudel-Version', () => {
    const missing = types.flatMap((t) => BLOCK_CATALOG[t].covers.filter((n) => !existsInStrudel(n)).map((n) => `${t}: ${n}`));
    expect(missing).toEqual([]);
  });

  it('covers nennt alles, was der Baustein erzeugt (Default + jede Auswahl, für Noten- und Sample-Quellen)', () => {
    const contexts: BlockContext[] = [
      { source: { type: 'melody', speed: 1 }, stretchDrums: false },
      { source: { type: 'drums', speed: 1 }, stretchDrums: false },
    ];
    const problems: string[] = [];
    for (const type of chainTypes) {
      if (FREE.has(type)) continue;
      const variants: ParamValues[] = [{}];
      for (const p of BLOCK_CATALOG[type].params) {
        if (p.type === 'select') for (const o of OPTION_SETS[p.optionSet]) variants.push({ [p.key]: o.value });
        if (p.type === 'toggle') variants.push({ [p.key]: !p.default });
        // Werte, die optionale Aufrufe auslösen (≠ Standard)
        if (p.type === 'number') variants.push({ [p.key]: p.max });
      }
      for (const ctx of contexts) {
        for (const v of variants) {
          let code: string;
          try {
            code = emit(type, v, ctx);
          } catch {
            continue; // z. B. Tonleiter-Schritte auf Drums
          }
          for (const name of calledNames(code)) {
            if (!BLOCK_CATALOG[type].covers.includes(name)) problems.push(`${type}: ${name} (${code})`);
          }
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it('wichtige Klang-Controls haben einen eigenen Baustein', () => {
    const covered = new Set(types.flatMap((t) => BLOCK_CATALOG[t].covers).filter(isControl).map(controlName));
    const important = [
      // (gain = Spur-Lautstärke, kein Baustein)
      's', 'n', 'bank', 'speed', 'velocity', 'postgain',
      'cutoff', 'resonance', 'hcutoff', 'hresonance', 'lpenv', 'lpattack', 'lpdecay', 'lpsustain', 'lprelease',
      'attack', 'decay', 'sustain', 'release', 'vib', 'vibmod',
      'room', 'roomsize', 'delay', 'delaysync', 'delayfeedback', 'pan',
      'crush', 'coarse', 'distort', 'distorttype', 'vowel', 'phaserrate', 'phaserdepth', 'tremolosync', 'tremolodepth',
      'compressor', 'compressorRatio', 'fmi', 'fmh', 'fmwave', 'fmdecay', 'fmsustain', 'begin', 'end', 'cut',
    ];
    expect(important.filter((c) => !covered.has(c))).toEqual([]);
  });
});

describe('Control-Liste (src/blocks/controls.ts)', () => {
  /** Laufzeit-Registry: Hauptname → sortierte Aliase. */
  function runtimeControls(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const name of Object.getOwnPropertyNames(core.Pattern.prototype)) {
      if (!isControl(name)) continue;
      const main = controlName(name);
      if (!map.has(main)) map.set(main, []);
      if (name !== main) map.get(main)!.push(name);
    }
    for (const aliases of map.values()) aliases.sort();
    return map;
  }

  it('entspricht exakt den von Strudel registrierten Controls (Name + Aliase)', () => {
    const runtime = runtimeControls();
    const ours = new Map(CONTROLS.map((c) => [c.name, [...c.aliases].sort()]));
    expect([...ours.keys()].filter((n) => !runtime.has(n)), 'in controls.ts, aber nicht in Strudel').toEqual([]);
    expect([...runtime.keys()].filter((n) => !ours.has(n)), 'in Strudel, aber nicht in controls.ts').toEqual([]);
    for (const [name, aliases] of runtime) expect(ours.get(name), name).toEqual(aliases);
  });

  it('jeder Name ist eindeutig, jede Gruppe ist belegt', () => {
    const all = CONTROLS.flatMap((c) => [c.name, ...c.aliases]);
    expect(new Set(all).size).toBe(all.length);
    expect(CONTROL_NAMES.size).toBe(all.length);
    for (const group of CONTROL_GROUPS) expect(CONTROLS.some((c) => c.group === group), group).toBe(true);
  });

  it('jeder Name ist ein gültiger JS-Bezeichner (sicher als .name(…) im Code)', () => {
    for (const name of CONTROL_NAMES) expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });

  it('Gruppen „external/superdirt/meta“ sind im Browser stumm, der Rest hörbar', () => {
    expect(WEBAUDIO_GROUPS.has('filter')).toBe(true);
    expect(WEBAUDIO_GROUPS.has('superdirt')).toBe(false);
    expect(isWebAudioControl('lpf')).toBe(true);
    expect(isWebAudioControl('squiz')).toBe(false);
    expect(isWebAudioControl('midichan')).toBe(false);
    expect(isWebAudioControl('gibtsnicht')).toBe(false);
  });

  it('findControl löst Aliase auf, suggestControl findet Tippfehler', () => {
    expect(findControl('lpf')).toMatchObject({ name: 'cutoff', group: 'filter' });
    expect(findControl('fm')).toMatchObject({ name: 'fmi', group: 'fm' });
    expect(findControl('wtdepth')).toMatchObject({ group: 'wavetable' });
    expect(findControl('constructor')).toBeUndefined();
    expect(suggestControl('lfp')).toBe('lpf');
    expect(suggestControl('wtdeph')).toBe('wtdepth');
    expect(suggestControl('Vowel')).toBe('vowel');
    expect(suggestControl('reverb')).toBeUndefined();
    expect(suggestControl('')).toBeUndefined();
  });
});
