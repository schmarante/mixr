import { beforeEach, describe, expect, it } from 'vitest';
import { importStrudelCode } from '../../../../agents/importer';
import { languageStore } from '../../../../i18n';
import { codeEntries, kitEntries, soundEntries, entryDetail } from '../completions';
import { DEBOUNCE_MS, LiveCode, offsetOf, type LiveCodeDeps } from '../liveCode';
import { minimalChange } from '../decorations';

beforeEach(() => languageStore.set('en'));

/** Alle ausstehenden Promise-Fortsetzungen abarbeiten. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** Bausteine als einfacher Text-Speicher: sync übernimmt den Text „kanonisch“ (normalisiert). */
function harness(initial = 'setcpm(30)\n\n// Beat\n$: s("bd*4")') {
  let canonical = initial;
  const listeners = new Set<() => void>();
  let timer: (() => void) | null = null;
  const log: string[] = [];
  const state = { override: null as string | null, ended: [] as string[], syncs: [] as Array<{ series: string }> };
  const deps: LiveCodeDeps = {
    getCanonical: () => canonical,
    subscribeCanonical: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    importCode: (text) => importStrudelCode(text),
    sync: (_result, options) => {
      state.syncs.push({ series: options.series });
      log.push('sync');
      return 'changed';
    },
    endSeries: (s) => state.ended.push(s),
    setOverride: (text) => {
      state.override = text;
      log.push(`override:${text === null ? 'null' : 'text'}`);
    },
    setTimer: (fn, ms) => {
      expect(ms).toBe(DEBOUNCE_MS);
      timer = fn;
      return 1;
    },
    clearTimer: () => {
      timer = null;
    },
  };
  const live = new LiveCode(deps);
  live.start();
  return {
    live,
    state,
    log,
    /** Bausteine ändern sich (z. B. Klick im Inspector oder Ergebnis einer Übernahme). */
    setCanonical(text: string) {
      canonical = text;
      for (const l of listeners) l();
    },
    /** Nur den kanonischen Code ändern (wie syncProjectFromCode es tut), Listener später. */
    quietCanonical(text: string) {
      canonical = text;
    },
    fireTimer() {
      const fn = timer;
      timer = null;
      fn?.();
    },
    get pending() {
      return timer !== null;
    },
  };
}

describe('LiveCode – Code → Musik & Bausteine', () => {
  it('folgt den Bausteinen, solange nicht getippt wird', () => {
    const h = harness();
    expect(h.live.state.get().text).toContain('bd*4');
    h.setCanonical('$: s("hh*8")');
    expect(h.live.state.get()).toMatchObject({ text: '$: s("hh*8")', mode: 'blocks' });
  });

  it('Tippen → nach der Pause spielt genau der Editor-Text, Import läuft parallel', () => {
    const h = harness();
    h.live.focus();
    const text = h.live.state.get().text.replace('bd*4', 'bd*8');
    h.live.edit(text);
    expect(h.live.state.get().mode).toBe('typing');
    expect(h.state.override).toBeNull();
    h.fireTimer();
    expect(h.state.override).toBe(text);
    expect(h.state.syncs).toHaveLength(1);
    expect(h.live.state.get().mode).toBe('linked');
  });

  it('fokussiert + schmutzig: neuer kompilierter Code ersetzt den Text NICHT; beim Verlassen angleichen', () => {
    const h = harness();
    h.live.focus();
    const typed = '$:   s("bd*8")   // mein Kommentar';
    h.live.edit(typed);
    h.fireTimer();
    h.setCanonical('setcpm(30)\n\n// Beat\n$: s("bd*8")');
    expect(h.live.state.get().text).toBe(typed);
    h.live.blur();
    expect(h.live.state.get()).toMatchObject({ text: 'setcpm(30)\n\n// Beat\n$: s("bd*8")', mode: 'blocks', notice: { kind: 'aligned' } });
    expect(h.state.override).toBeNull();
    expect(h.state.ended.length).toBeGreaterThan(0);
  });

  it('Strg/⌘+Enter wendet sofort an (ohne Pause) und gleicht an', () => {
    const h = harness();
    h.live.focus();
    h.live.edit('$: s("cp*2")');
    h.quietCanonical('setcpm(30)\n\n// Drums\n$: s("cp*2")');
    h.live.commit();
    expect(h.pending).toBe(false);
    expect(h.state.syncs).toHaveLength(1);
    expect(h.live.state.get()).toMatchObject({ mode: 'blocks', text: 'setcpm(30)\n\n// Drums\n$: s("cp*2")' });
  });

  it('eine Tipp-Serie nutzt denselben Undo-Schlüssel, nach dem Angleichen ein neuer', () => {
    const h = harness();
    h.live.focus();
    h.live.edit('$: s("bd*5")');
    h.fireTimer();
    h.live.edit('$: s("bd*6")');
    h.fireTimer();
    expect(new Set(h.state.syncs.map((s) => s.series)).size).toBe(1);
    h.live.blur();
    h.live.focus();
    h.live.edit('$: s("bd*7")');
    h.fireTimer();
    expect(new Set(h.state.syncs.map((s) => s.series)).size).toBe(2);
  });

  it('Syntaxfehler: Code-Modus, Text bleibt, Fehlerstelle bekannt, Bausteine unberührt', () => {
    const h = harness();
    h.live.focus();
    const broken = '$: s("bd*4").lpf(';
    h.live.edit(broken);
    h.fireTimer();
    const s = h.live.state.get();
    expect(s.mode).toBe('codeMode');
    expect(s.reason).toBe('syntax');
    expect(s.syntax).toMatchObject({ forText: broken, line: 1 });
    expect(h.state.syncs).toHaveLength(0);
    // Engine bekommt den Text trotzdem (letztes gutes Pattern spielt bei Fehlern weiter)
    expect(h.state.override).toBe(broken);
    h.live.blur();
    expect(h.live.state.get()).toMatchObject({ text: broken, mode: 'codeMode' });
  });

  it('Code-Modus, nicht fokussiert: Bausteinänderung ersetzt den Text, Entwurf wiederherstellbar', () => {
    const h = harness();
    h.live.focus();
    h.live.edit('// nur ein Kommentar');
    h.fireTimer();
    expect(h.live.state.get()).toMatchObject({ mode: 'codeMode', reason: 'noPattern' });
    h.live.blur();
    h.setCanonical('$: s("hh*8")');
    expect(h.live.state.get()).toMatchObject({ text: '$: s("hh*8")', mode: 'blocks', notice: { kind: 'replaced' }, discarded: '// nur ein Kommentar' });
    expect(h.state.override).toBeNull();
    h.live.restoreDraft();
    expect(h.live.state.get()).toMatchObject({ text: '// nur ein Kommentar', mode: 'codeMode' });
    expect(h.state.override).toBe('// nur ein Kommentar');
  });

  it('„Zurück zu den Bausteinen“ verwirft den Editor-Text', () => {
    const h = harness();
    const canonical = h.live.state.get().text;
    h.live.focus();
    h.live.edit('$: s("bd*4").lpf(');
    h.fireTimer();
    h.live.backToBlocks();
    expect(h.live.state.get()).toMatchObject({ text: canonical, mode: 'blocks', discarded: '$: s("bd*4").lpf(' });
    expect(h.state.override).toBeNull();
  });

  it('Text gleich dem kompilierten Code → kein Override', () => {
    const h = harness('$: s("bd")');
    h.live.focus();
    h.live.edit('$: s("bd") ');
    h.live.edit('$: s("bd")');
    h.fireTimer();
    expect(h.state.override).toBeNull();
    expect(h.live.state.get().mode).toBe('blocks');
  });
});

describe('LiveCode – Prüfung durch die Engine', () => {
  it('lehnt die Engine den Text ab (Laufzeitfehler), bleiben die Bausteine unverändert', async () => {
    const h = harness();
    let verdict: (ok: boolean | null) => void = () => {};
    (h.live as unknown as { deps: LiveCodeDeps }).deps.validate = () => new Promise((r) => (verdict = r));
    h.live.focus();
    h.live.edit('$: s("bd*4").ro.lpf(800)');
    h.fireTimer();
    expect(h.state.override).toBe('$: s("bd*4").ro.lpf(800)');
    expect(h.state.syncs).toHaveLength(0);
    verdict(false);
    await settle();
    expect(h.state.syncs).toHaveLength(0);
    expect(h.live.state.get()).toMatchObject({ mode: 'codeMode', reason: 'runtime' });
  });

  it('akzeptiert sie ihn, wird übernommen – auch beim Verlassen erst nach dem Urteil angeglichen', async () => {
    const h = harness();
    let verdict: (ok: boolean | null) => void = () => {};
    (h.live as unknown as { deps: LiveCodeDeps }).deps.validate = () => new Promise((r) => (verdict = r));
    h.live.focus();
    h.live.edit('$: s("bd*8")');
    h.quietCanonical('setcpm(30)\n\n// Beat\n$: s("bd*8")');
    h.live.blur();
    expect(h.live.state.get().text).toBe('$: s("bd*8")'); // wartet noch
    verdict(true);
    await settle();
    expect(h.state.syncs).toHaveLength(1);
    expect(h.live.state.get()).toMatchObject({ mode: 'blocks', text: 'setcpm(30)\n\n// Beat\n$: s("bd*8")' });
  });

  it('veraltetes Urteil (inzwischen weitergetippt) wird ignoriert', async () => {
    const h = harness();
    const verdicts: Array<(ok: boolean | null) => void> = [];
    (h.live as unknown as { deps: LiveCodeDeps }).deps.validate = () => new Promise((r) => verdicts.push(r));
    h.live.focus();
    h.live.edit('$: s("bd*5")');
    h.fireTimer();
    h.live.edit('$: s("bd*6")');
    verdicts[0]!(true);
    await settle();
    expect(h.state.syncs).toHaveLength(0);
    h.fireTimer();
    verdicts[1]!(true);
    await settle();
    expect(h.state.syncs).toHaveLength(1);
  });
});

describe('Hilfen', () => {
  it('offsetOf: Zeile/Spalte → Offset', () => {
    expect(offsetOf('ab\ncde\nf', 2, 1)).toBe(4);
    expect(offsetOf('ab', 9, 9)).toBe(2);
  });

  it('minimalChange: nur der geänderte Bereich', () => {
    expect(minimalChange('s("bd*4")', 's("bd*8")')).toEqual({ from: 6, to: 7, insert: '8' });
    expect(minimalChange('abc', 'abc')).toBeNull();
    expect(minimalChange('abc', 'abxc')).toEqual({ from: 2, to: 2, insert: 'x' });
  });
});

describe('Autovervollständigung', () => {
  it('nur lauffähige Strudel-Funktionen (Klasse engine) inkl. Aliase, Controls mit Gruppe', () => {
    const { functions, controls } = codeEntries();
    const labels = new Set([...functions, ...controls].map((e) => e.label));
    expect(labels.has('stack')).toBe(true);
    expect(labels.has('lpf')).toBe(true);
    expect(labels.has('pianoroll')).toBe(false); // editor-Widget
    expect(labels.size).toBe(functions.length + controls.length); // jeder Name einmal
    const lpf = controls.find((e) => e.label === 'lpf')!;
    expect(lpf).toMatchObject({ group: 'filter', aliasOf: 'cutoff' });
    expect(entryDetail(lpf)).toBe('Filter · alias of cutoff');
    const fast = functions.find((e) => e.label === 'fast')!;
    expect(entryDetail(fast)).toBe('Strudel function');
  });

  it('Klangnamen: eigene Slots zuerst, Kits für .bank()', () => {
    const sounds = soundEntries(['vox', 'bd']);
    expect(sounds[0]).toEqual({ label: 'vox', kind: 'sample' });
    expect(sounds.filter((s) => s.label === 'bd')).toHaveLength(1);
    expect(sounds.some((s) => s.label === 'sawtooth')).toBe(true);
    expect(kitEntries().map((k) => k.label)).toEqual(['modern', 'analog', 'emu808']);
  });
});
