import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { STRUDEL_FUNCTIONS, type StrudelFunctionStatus } from '../../data/strudelFunctions';
import { VISUAL_METHODS, lookupStrudelFunction } from '../AudioAgent';
import { STRUDEL_EXTENSIONS, codeIdentifiers, neededExtensions } from '../strudelExtensions';

const STATUSES: readonly StrudelFunctionStatus[] = ['engine', 'editor', 'internal', 'newer', 'unsupported'];
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

describe('Funktionsliste von strudel.cc (src/data/strudelFunctions.ts)', () => {
  it('enthält die komplette API-Referenz mit gültigen Namen', () => {
    expect(STRUDEL_FUNCTIONS).toHaveLength(544);
    for (const fn of STRUDEL_FUNCTIONS) {
      expect(fn.name).toMatch(IDENTIFIER);
      for (const alias of fn.aliases) expect(alias).toMatch(IDENTIFIER);
    }
  });

  it('jeder Eintrag ist klassifiziert', () => {
    for (const fn of STRUDEL_FUNCTIONS) expect(STATUSES).toContain(fn.status);
    // Jede Klasse kommt vor (sonst ist die Messung vermutlich schiefgegangen).
    const counts = Object.fromEntries(STATUSES.map((s) => [s, STRUDEL_FUNCTIONS.filter((fn) => fn.status === s).length]));
    for (const s of STATUSES) expect(counts[s], s).toBeGreaterThan(0);
    // Der allergrößte Teil läuft.
    expect(counts.engine! / STRUDEL_FUNCTIONS.length).toBeGreaterThan(0.8);
  });

  it('keine Duplikate – weder bei Namen noch bei Aliasen', () => {
    const all = STRUDEL_FUNCTIONS.flatMap((fn) => [fn.name, ...fn.aliases]);
    const dupes = all.filter((name, i) => all.indexOf(name) !== i);
    expect(dupes).toEqual([]);
  });

  it('newerNames nur bei laufenden Funktionen und nur aus Name/Aliasen', () => {
    for (const fn of STRUDEL_FUNCTIONS) {
      if (!fn.newerNames) continue;
      expect(fn.status).toBe('engine');
      expect(fn.newerNames.length).toBeGreaterThan(0);
      for (const n of fn.newerNames) expect([fn.name, ...fn.aliases]).toContain(n);
    }
  });

  it('Kopfzeile der generierten Datei passt zur Zählung', () => {
    const source = readFileSync(new URL('../../data/strudelFunctions.ts', import.meta.url), 'utf8');
    for (const s of STATUSES) {
      const count = STRUDEL_FUNCTIONS.filter((fn) => fn.status === s).length;
      expect(source).toContain(`${s}: ${count}`);
    }
  });

  it('Stichproben der Klassifikation', () => {
    expect(lookupStrudelFunction('s')).toBe('engine');
    expect(lookupStrudelFunction('sound')).toBe('engine');
    expect(lookupStrudelFunction('tune')).toBe('engine'); // @strudel/xen
    expect(lookupStrudelFunction('midi')).toBe('engine'); // @strudel/midi
    expect(lookupStrudelFunction('accX')).toBe('engine'); // @strudel/motion
    expect(lookupStrudelFunction('csoundm')).toBe('engine'); // @strudel/csound
    expect(lookupStrudelFunction('pianoroll')).toBe('editor');
    expect(lookupStrudelFunction('punchcard')).toBe('editor');
    expect(lookupStrudelFunction('writeOutputs')).toBe('internal');
    expect(lookupStrudelFunction('withHapSpan')).toBe('internal');
    expect(lookupStrudelFunction('juxFlip')).toBe('newer');
    expect(lookupStrudelFunction('flux')).toBe('newer');
    expect(lookupStrudelFunction('osc')).toBe('unsupported');
    expect(lookupStrudelFunction('gibtsNicht')).toBeUndefined();
  });

  it('alle Editor-Widgets mit Pattern-Methode haben einen No-op-Shim', () => {
    const shims = new Set<string>(VISUAL_METHODS);
    const methodWidgets = STRUDEL_FUNCTIONS.filter(
      (fn) => fn.status === 'editor' && !['slider', 'color', 'hsl', 'hsla'].includes(fn.name),
    );
    for (const fn of methodWidgets) {
      for (const name of [fn.name, ...fn.aliases]) expect(shims.has(name), name).toBe(true);
    }
  });
});

describe('Zusatzpakete (strudelExtensions)', () => {
  const require = createRequire(import.meta.url);
  /** Exportnamen aus dem `export { a as b, … }`-Block eines dist-Bundles. */
  function distExports(pkg: string): string[] {
    const source = readFileSync(require.resolve(pkg), 'utf8');
    const block = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(source)?.[1] ?? '';
    return block
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/).pop()!.trim())
      .filter(Boolean);
  }

  it('Trigger decken alle Exporte der Pakete ab', () => {
    const triggers = (id: string) => STRUDEL_EXTENSIONS.find((ext) => ext.id === id)!.triggers;
    for (const [id, pkg] of [
      ['xen', '@strudel/xen'],
      ['midi', '@strudel/midi'],
      ['csound', '@strudel/csound'],
    ] as const) {
      const exports = distExports(pkg);
      expect(exports.length, pkg).toBeGreaterThan(0);
      expect(exports.filter((name) => !triggers(id).includes(name)), pkg).toEqual([]);
    }
    // motion wird aus der Quelle geladen
    const motion = readFileSync(require.resolve('@strudel/motion/motion.mjs'), 'utf8');
    const motionExports = [...motion.matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]);
    expect(motionExports.length).toBeGreaterThan(40);
    expect(motionExports.filter((name) => !triggers('motion').includes(name!))).toEqual([]);
  });

  it('jede Funktion der Liste aus einem Zusatzpaket lädt dieses nach', () => {
    for (const name of ['tune', 'xen', 'midi', 'midin', 'midikeys', 'accX', 'rotationAlpha', 'csound', 'csoundm']) {
      expect(neededExtensions(`$: note("c").${name}()`).length, name).toBe(1);
    }
  });

  it('erkennt nur Bezeichner im Code, nicht in Strings oder Kommentaren', () => {
    const ids = codeIdentifiers(
      '// midi\n/* csound */ $: s("tune midi").lpf(\'xen\').gain(`accX ${rand.range(0, 1)} {x}`) // tune',
    );
    expect([...ids].sort()).toEqual(['$', 'gain', 'lpf', 'rand', 'range', 's']);
    expect(neededExtensions('$: s("midi bd") // .csound()')).toEqual([]);
    expect(neededExtensions('$: note("c").midi()').map((ext) => ext.id)).toEqual(['midi']);
    expect(neededExtensions('$: n("0 2").tune("hexany15").lpf(accX.range(200, 2000)).csound()').map((e) => e.id)).toEqual([
      'xen',
      'motion',
      'csound',
    ]);
  });

  it('xen läuft mit derselben core-Instanz wie die Engine', async () => {
    const { core, evaluateStrudel } = await import('./strudelHarness');
    const xen = await import('@strudel/xen');
    await core.evalScope(xen);
    const { query } = await evaluateStrudel('$: freq("0 12".xen("12edo"))');
    expect(query(0, 1).map((h) => h.value.freq)).toEqual([220, 440]);
    expect(typeof core.Pattern.prototype.tune).toBe('function');
  });
});
