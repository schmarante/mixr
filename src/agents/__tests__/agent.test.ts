import { afterAll, describe, expect, it, vi } from 'vitest';
import { compileState, compiledStrudelCode, projectSettings, visualAstStore } from '../../store/agentBus';
import { startCompilerAgent } from '../CompilerAgent';
import { TEMPLATES } from '../../data/templates';
import { buildTestAst } from './astBuilder';

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('startCompilerAgent', () => {
  afterAll(() => vi.unstubAllGlobals());

  it('tut auf dem Server (ohne window) nichts', () => {
    startCompilerAgent();
    visualAstStore.set(TEMPLATES[0]!.ast);
    expect(compiledStrudelCode.get()).toBe('');
    visualAstStore.set({ nodes: [], edges: [] });
  });

  it('kompiliert sofort, bündelt Änderungen und ist idempotent', async () => {
    vi.stubGlobal('window', {});
    visualAstStore.set(TEMPLATES[0]!.ast);
    startCompilerAgent();
    startCompilerAgent(); // idempotent: kein doppeltes Abo
    expect(compiledStrudelCode.get()).toContain('setcpm(120/4)');

    const writes: string[] = [];
    const unsub = compiledStrudelCode.listen((c) => writes.push(c));
    // Vorlage laden = AST + Tempo synchron → genau eine Kompilierung
    visualAstStore.set(TEMPLATES[1]!.ast);
    projectSettings.set({ bpm: TEMPLATES[1]!.settings.bpm });
    await flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(`setcpm(${TEMPLATES[1]!.settings.bpm}/4)`);

    // identischer Code → kein erneutes Schreiben
    visualAstStore.set(structuredClone(TEMPLATES[1]!.ast));
    await flush();
    expect(writes).toHaveLength(1);
    unsub();

    // Diagnosen landen in compileState
    visualAstStore.set(buildTestAst([{ blocks: [] }]));
    await flush();
    expect(compiledStrudelCode.get()).toBe('');
    expect(compileState.get().diagnostics).toEqual([{ nodeId: 't1', message: expect.any(String) }]);
  });
});
