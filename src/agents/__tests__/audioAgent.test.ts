import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAMPLE_SOURCES,
  sampleMapUrl,
  describeError,
  findBrokenTrack,
  findTrackName,
  installReplShims,
  parseStrudelLog,
  prepareCode,
  startAudioAgent,
  VISUAL_METHODS,
} from '../AudioAgent';
import { languageStore } from '../../i18n';
import { playbackState } from '../../store/agentBus';

// Meldungen sind Text in der aktuellen Sprache; die Tests prüfen Deutsch (Englisch: eigener Block).
beforeEach(() => languageStore.set('de'));

const COMPILED = `setcpm(120/4)

// Drums 1
$: s("bd*4, ~ sd ~ sd").bank("modern").room(0.4).gain(0.8)

// Bass
$: n("0 2 4").scale("C2:minor").s("sawtooth")
`;

/** Echten Strudel-REPL (ohne Audio) bauen – gleiche Pakete, die @strudel/web bündelt. */
async function makeRepl() {
  const core: any = await import('@strudel/core');
  const mini: any = await import('@strudel/mini');
  const tonal: any = await import('@strudel/tonal');
  const { transpiler } = await import('@strudel/transpiler');
  await core.evalScope(core, mini, tonal);
  mini.miniAllStrings?.();
  const errors: unknown[] = [];
  const repl = core.repl({
    defaultOutput: async () => {},
    getTime: () => 0,
    transpiler,
    setInterval: () => 0,
    clearInterval: () => {},
    onEvalError: (e: unknown) => errors.push(e),
  });
  return { repl, errors, core };
}

describe('prepareCode', () => {
  it('liefert null für leeren / reinen Kommentar-Code', () => {
    expect(prepareCode('')).toBeNull();
    expect(prepareCode(null)).toBeNull();
    expect(prepareCode('   \n\n')).toBeNull();
    expect(prepareCode('// Drums 1\n  // stumm\n/* block\n kommentar */\n')).toBeNull();
  });

  it('lässt Compiler-Code unverändert (nur Zeilenenden normalisiert)', () => {
    expect(prepareCode(COMPILED)).toBe(COMPILED);
    expect(prepareCode('setcpm(30)\r\n$: s("bd")')).toBe('setcpm(30)\n$: s("bd")');
  });

  it('erkennt Code hinter Kommentaren und URLs in Strings', () => {
    expect(prepareCode('// x\n$: s("bd") // y')).not.toBeNull();
    expect(prepareCode('samples("https://example.com/x.json")')).not.toBeNull();
  });
});

describe('findTrackName', () => {
  it('ordnet Zeilen der Spur über den Compiler-Kommentar zu', () => {
    expect(findTrackName(COMPILED, 4)).toBe('Drums 1');
    expect(findTrackName(COMPILED, 7)).toBe('Bass');
    expect(findTrackName(COMPILED, 1)).toBeNull();
  });
});

describe('findBrokenTrack', () => {
  it('findet die Spur mit dem Syntaxfehler, auch wenn er erst später gemeldet wird', () => {
    const broken = COMPILED.replace('.gain(0.8)', '.gain(0.8');
    expect(findBrokenTrack(broken)).toBe('Drums 1');
    expect(findBrokenTrack(COMPILED)).toBeNull();
    expect(findBrokenTrack('$: await samples("x")')).toBeNull();
  });
});

describe('parseStrudelLog', () => {
  it('erkennt Laufzeitfehler, ignoriert Eval-Fehler und Infos', () => {
    expect(parseStrudelLog('[getTrigger] error: sound foo not found! Is it loaded?')).toBe(
      'sound foo not found! Is it loaded?',
    );
    expect(parseStrudelLog('[cyclist] error: boom')).toBe('boom');
    expect(parseStrudelLog('[eval] error: Unexpected token (1:3)')).toBeNull();
    expect(parseStrudelLog('[eval] code updated')).toBeNull();
    expect(parseStrudelLog('[sampler] loading sound "bd:0" took too long')).toBeNull();
    expect(parseStrudelLog('[sampler] could not load "bd:3"')).toBe('[sampler] could not load "bd:3"');
    expect(parseStrudelLog(undefined)).toBeNull();
    // Sidechain-Ziel noch nicht angelegt (nur beim Start) – kein Hinweis für Nutzer
    expect(parseStrudelLog('[superdough] error: duck target orbit 2 does not exist')).toBeNull();
    expect(parseStrudelLog('[superdough] error: something else broke')).toBe('something else broke');
  });
});

describe('describeError', () => {
  it('übersetzt bekannte Meldungen ins Deutsche', () => {
    expect(describeError(new Error('sound modern_xx not found! Is it loaded?'))).toBe(
      'Den Klang „xx“ gibt es im Drumcomputer „modern“ nicht.',
    );
    expect(describeError(new Error('sound blub not found! Is it loaded?'))).toMatch(/„blub“ gibt es nicht/);
    expect(describeError(new Error('error loading "https://x/y.json"'))).toMatch(/Verbindung prüfen/);
    expect(describeError(new TypeError('s(...).fooo is not a function'))).toBe(
      '„fooo“ ist keine bekannte Strudel-Funktion – Tippfehler im Code?',
    );
    expect(describeError(new ReferenceError('blub is not defined'))).toBe(
      'Unbekannter Name „blub“ – Tippfehler im Code?',
    );
    expect(describeError('irgendwas')).toBe('Fehler im Code: irgendwas');
  });

  it('übersetzt bekannte Meldungen ins Englische', () => {
    languageStore.set('en');
    expect(describeError(new Error('sound modern_xx not found! Is it loaded?'))).toBe(
      'There\'s no sound “xx” in the drum machine “modern”.',
    );
    expect(describeError(new Error('error loading "https://x/y.json"'))).toMatch(/check your connection/);
    expect(describeError(new TypeError('s(...).fooo is not a function'))).toBe(
      '“fooo” isn\'t a known Strudel function – a typo in the code?',
    );
    expect(describeError(new ReferenceError('blub is not defined'))).toBe('Unknown name “blub” – a typo in the code?');
    expect(describeError('whatever')).toBe('Error in the code: whatever');
    expect(describeError('')).toBe('Unknown error in the code.');
  });

  it('Funktionen aus einer neueren Strudel-Version bzw. bewusst nicht unterstützte', () => {
    expect(describeError(new TypeError('s(...).juxFlip is not a function'))).toBe(
      '„juxFlip“ gibt es erst in einer neueren Strudel-Version als der, die strudelmixr nutzt – auf strudel.cc läuft es bereits.',
    );
    // Alias einer neuen Funktion
    expect(describeError(new TypeError('s(...).flux is not a function'))).toMatch(/^„flux“ gibt es erst in einer neueren/);
    // Neue Schreibweise einer bei uns vorhandenen Funktion (stackCentre läuft, stackCenter noch nicht)
    expect(describeError(new ReferenceError('stackCenter is not defined'))).toMatch(/^„stackCenter“ gibt es erst/);
    expect(describeError(new ReferenceError('edoScale is not defined'))).toMatch(/^„edoScale“ gibt es erst/);
    expect(describeError(new TypeError('s(...).osc is not a function'))).toMatch(/^„osc“ sendet OSC-Nachrichten .*lokalen OSC-Server/);
    // Unbekanntes bleibt beim Tippfehler-Hinweis
    expect(describeError(new TypeError('s(...).juxFlop is not a function'))).toBe(
      '„juxFlop“ ist keine bekannte Strudel-Funktion – Tippfehler im Code?',
    );

    languageStore.set('en');
    expect(describeError(new TypeError('s(...).juxFlip is not a function'))).toBe(
      '“juxFlip” only exists in a newer Strudel version than the one strudelmixr uses – it already works on strudel.cc.',
    );
    expect(describeError(new TypeError('s(...).osc is not a function'))).toMatch(/^“osc” sends OSC messages .*local OSC server/);
  });

  it('Zeitüberschreitung beim Laden wird in jeder Sprache erkannt', () => {
    const err = new Error('Loading took too long');
    err.name = 'TimeoutError';
    expect(describeError(err)).toBe('Klänge konnten nicht geladen werden – bitte Verbindung prüfen.');
  });
});

describe('Integration mit dem echten Strudel-Transpiler/REPL (ohne Audio)', () => {
  it('unterstützt $:-Labels und setcpm im Compiler-Format', async () => {
    const { repl, errors } = await makeRepl();
    const pat = await repl.evaluate(COMPILED, false);
    expect(errors).toEqual([]);
    expect(pat).toBeTruthy();
    // setcpm(120/4) → 30 Zyklen/min → 0.5 cps
    expect(repl.scheduler.cps).toBeCloseTo(0.5);
    const haps = pat.queryArc(0, 1);
    const values = haps.map((h: any) => `${h.value.bank ?? ''}/${h.value.s}`);
    expect(values).toContain('modern/bd');
    expect(values).toContain('modern/sd');
    expect(values).toContain('/sawtooth');
  });

  it('liefert für Syntaxfehler eine deutsche Meldung mit Spurname, altes Pattern bleibt', async () => {
    const { repl, errors } = await makeRepl();
    const good = await repl.evaluate(COMPILED, false);
    const broken = COMPILED.replace('$: n("0 2 4")', '$: n("0 2 4"');
    const result = await repl.evaluate(broken, false);
    expect(result).toBeUndefined();
    expect(repl.scheduler.pattern).toBe(good);
    expect(errors).toHaveLength(1);
    const msg = describeError(errors[0], broken);
    expect(msg).toMatch(/^Syntaxfehler im Code \(Spur „Bass“\): /);
  });

  it('übersetzt nicht geschlossene Strings und unbekannte Funktionen', async () => {
    const { repl, errors } = await makeRepl();
    await repl.evaluate('// Lead\n$: s("bd).fast(2)', false);
    await repl.evaluate('$: s("bd").fooo(2)', false);
    await repl.evaluate('$: blub("bd")', false);
    expect(errors).toHaveLength(3);
    expect(describeError(errors[0], '// Lead\n$: s("bd).fast(2)')).toBe(
      'Syntaxfehler im Code (Spur „Lead“): Ein Anführungszeichen wird nicht geschlossen.',
    );
    expect(describeError(errors[1])).toBe('„fooo“ ist keine bekannte Strudel-Funktion – Tippfehler im Code?');
    expect(describeError(errors[2])).toBe('Unbekannter Name „blub“ – Tippfehler im Code?');

    languageStore.set('en');
    expect(describeError(errors[0], '// Lead\n$: s("bd).fast(2)')).toBe(
      'Syntax error in the code (track “Lead”): A quotation mark is never closed.',
    );
  });

  it('meldet neuere Funktionen aus echten Evaluationsfehlern', async () => {
    const { repl, errors } = await makeRepl();
    await repl.evaluate('$: s("bd").juxFlip(rev)', false);
    await repl.evaluate('$: s("bd").osc()', false);
    expect(errors).toHaveLength(2);
    expect(describeError(errors[0])).toMatch(/^„juxFlip“ gibt es erst in einer neueren Strudel-Version/);
    expect(describeError(errors[1])).toMatch(/^„osc“ sendet OSC-Nachrichten/);
  });

  it('übersetzt Mini-Notation-Fehler', async () => {
    const { repl, errors } = await makeRepl();
    await repl.evaluate('$: s("bd [sd")', false);
    expect(errors).toHaveLength(1);
    expect(describeError(errors[0])).toMatch(/^Fehler in der Mini-Notation/);
  });

  it('editPattern-Probe: Abfragefehler lassen das alte Pattern weiterlaufen', async () => {
    const core: any = await import('@strudel/core');
    const { transpiler } = await import('@strudel/transpiler');
    const make = (probe: boolean) => {
      const errors: unknown[] = [];
      const repl = core.repl({
        defaultOutput: async () => {},
        getTime: () => 0,
        transpiler,
        setInterval: () => 0,
        clearInterval: () => {},
        onEvalError: (e: unknown) => errors.push(e),
        // wie probePattern() im AudioAgent
        ...(probe && {
          editPattern: (p: any) => {
            p.query(new core.State(new core.TimeSpan(0, 1), { _cps: 0.5 }));
            return p;
          },
        }),
      });
      return { repl, errors };
    };
    const badCode = '$: s("bd").lpf(sine.range("a", 3))';

    // Ohne Probe: Evaluierung „gelingt“, queryArc() verschluckt den Fehler → Spur wird still.
    const plain = make(false);
    const silent = await plain.repl.evaluate(badCode, false);
    expect(silent).toBeTruthy();
    expect(silent.queryArc(0, 1)).toEqual([]);

    // Mit Probe: Evaluierung schlägt fehl, das alte Pattern bleibt aktiv.
    const probed = make(true);
    const good = await probed.repl.evaluate('$: s("bd")', false);
    const res = await probed.repl.evaluate(badCode, false);
    expect(res).toBeUndefined();
    expect(probed.repl.scheduler.pattern).toBe(good);
    expect(probed.errors).toHaveLength(1);
    expect(describeError(probed.errors[0])).toMatch(/^Fehler im Code: /);
  });
});

describe('Konfiguration & SSR', () => {
  it('lädt nur selbst gehostete Sample-Quellen', () => {
    expect(SAMPLE_SOURCES.map((s) => s.id)).toEqual(['drums', 'piano', 'sonicpi']);
    expect(sampleMapUrl('drums', 'https://example.test')).toBe('https://example.test/samples/drums/strudel.json');
  });

  it('startAudioAgent ist ohne window ein No-op', () => {
    expect(typeof window).toBe('undefined');
    startAudioAgent();
    expect(playbackState.get().status).toBe('idle');
  });
});

describe('REPL-Shims für strudel.cc-Code', () => {
  it('ersetzt auch vorhandene Zeichen-Methoden (Canvas über der Oberfläche) durch No-ops', () => {
    const drew: string[] = [];
    class FakePattern {
      pianoroll() {
        drew.push('pianoroll');
        return 'canvas';
      }
    }
    const scope: Record<string, unknown> = {};
    installReplShims({ Pattern: FakePattern }, scope);
    const pat = new FakePattern() as unknown as Record<string, () => unknown>;
    for (const name of VISUAL_METHODS) {
      expect(pat[name]!(), name).toBe(pat);
      expect(pat[`_${name}`]!(), name).toBe(pat);
    }
    expect(drew).toEqual([]);
    expect((scope.slider as (v: number) => number)(3)).toBe(3);
    expect((scope.sliderWithID as (id: string, v: number) => number)('x', 4)).toBe(4);
  });


  it('_pianoroll, punchcard & slider() laufen als No-ops, echter Klang bleibt', async () => {
    const { core, evaluateStrudel } = await import('./strudelHarness');
    installReplShims(core);
    const { query } = await evaluateStrudel(
      'setcpm(30)\n$: s("bd sd").lpf(slider(3000, 0, 3000))._pianoroll().punchcard()',
    );
    const haps = query(0, 1);
    expect(haps.map((h) => h.value.s)).toEqual(['bd', 'sd']);
    expect(haps[0]!.value.cutoff).toBe(3000);
  });
});
