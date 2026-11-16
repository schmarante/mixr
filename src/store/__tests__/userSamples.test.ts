import { beforeEach, describe, expect, it } from 'vitest';
import { createZip, crc32, readZip } from '../../lib/zip';
import type { ProjectSettings, UserSampleSlot, VisualAst } from '../../types/ast';
import { appendProject, loadProject, setUserSamples, undo } from '../actions';
import { projectSettings, visualAstStore } from '../agentBus';
import {
  buildProjectFile,
  exportProjectZip,
  openProjectArchive,
  parseProjectFile,
  projectDownloadName,
  projectSettingsOf,
  ProjectFileError,
} from '../projectFile';
import { groupSampleFiles, isAudioFileName, missingSampleFiles, sampleRef, sanitizeSampleName } from '../userSamples';

const AST: VisualAst = {
  nodes: [
    { id: 'track-a', type: 'track', params: { name: 'Beat', color: 'violet', volume: 0.8, muted: false, solo: false } },
    { id: 'block-a', type: 'code', params: { code: 's("kick:1")' } },
  ],
  edges: [{ id: 'e-track-a-block-a', source: 'track-a', target: 'block-a' }],
  arrangement: { sections: [{ id: 'section-1', cycles: 4, name: 'Intro' }], cells: {}, loopSection: null },
};

const SLOTS: UserSampleSlot[] = [
  {
    id: 'slot-1',
    name: 'kick',
    files: [
      { id: 'file-1', fileName: 'kick.wav', mime: 'audio/wav', size: 4 },
      { id: 'file-2', fileName: 'kick.wav', mime: 'audio/wav', size: 4 },
    ],
  },
  { id: 'slot-2', name: 'vox', files: [{ id: 'file-3', fileName: 'hey there.mp3', mime: 'audio/mpeg', size: 3 }] },
];

const SETTINGS: ProjectSettings = { bpm: 128, prelude: 'const x = 1', samples: SLOTS };

describe('Klangnamen', () => {
  it('macht gültige, eindeutige Strudel-Namen', () => {
    expect(sanitizeSampleName('My Kick 01.wav')).toBe('my_kick_01');
    expect(sanitizeSampleName('Ünïcödé Pad')).toBe('unicode_pad');
    expect(sanitizeSampleName('808')).toBe('s808');
    expect(sanitizeSampleName('***')).toBe('sample');
    expect(sanitizeSampleName('kick', ['kick', 'kick_2'])).toBe('kick_3');
  });

  it('weicht eingebauten Klängen aus', () => {
    expect(sanitizeSampleName('bd')).toBe('bd_2');
    expect(sanitizeSampleName('Piano')).toBe('piano_2');
    expect(sanitizeSampleName('sawtooth')).toBe('sawtooth_2');
  });

  it('erkennt Audiodateien und Varianten-Referenzen', () => {
    expect(isAudioFileName('a.WAV')).toBe(true);
    expect(isAudioFileName('notes.txt')).toBe(false);
    expect(sampleRef('kick')).toBe('kick');
    expect(sampleRef('kick', 2)).toBe('kick:2');
  });
});

describe('Ordner wie strudel.cc „import sounds“', () => {
  it('Unterordner = Klang, Dateien = Varianten (natürlich sortiert), Wurzeldateien = Ordnername', () => {
    const groups = groupSampleFiles([
      { path: 'Kit/kick/kick10.wav' },
      { path: 'Kit/kick/kick2.wav' },
      { path: 'Kit/snare/a.wav' },
      { path: 'Kit/loose.wav' },
      { path: 'single.wav' },
    ]);
    expect(groups.map((g) => g.name)).toEqual(['kick', 'Kit', 'single.wav', 'snare']);
    expect(groups.find((g) => g.name === 'kick')!.files.map((f) => f.path)).toEqual(['Kit/kick/kick2.wav', 'Kit/kick/kick10.wav']);
  });

  it('findet fehlende Dateien', () => {
    expect(missingSampleFiles(SLOTS, { 'file-1': true, 'file-3': true }).map((m) => m.file.id)).toEqual(['file-2']);
  });
});

describe('ZIP', () => {
  it('CRC-32 stimmt', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('Roundtrip mit gespeicherten und komprimierten Dateien', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ hello: 'world'.repeat(50) }));
    const audio = new Uint8Array([1, 2, 3, 4, 5, 250, 0, 7]);
    const zip = await createZip([
      { path: 'mixr.json', data: json },
      { path: 'samples/kick/kick.wav', data: audio },
    ]);
    const back = await readZip(zip);
    expect(back.map((e) => e.path)).toEqual(['mixr.json', 'samples/kick/kick.wav']);
    expect(back[0]!.data).toEqual(json);
    expect(back[1]!.data).toEqual(audio);
  });
});

describe('Projektdatei', () => {
  it('Manifest mit eindeutigen Pfaden, Roundtrip über JSON', () => {
    const file = buildProjectFile(AST, SETTINGS);
    expect(file.format).toBe('mixr');
    expect(file.version).toBe(1);
    expect(file.settings.samples![0]!.files.map((f) => f.path)).toEqual(['samples/kick/kick.wav', 'samples/kick/kick-2.wav']);
    const parsed = parseProjectFile(JSON.stringify(file));
    expect(parsed.ast).toEqual(AST);
    expect(projectSettingsOf(parsed)).toEqual(SETTINGS);
  });

  it('prüft das Format mit freundlichen Fehlern', () => {
    const fail = (text: string) => {
      try {
        parseProjectFile(text);
        return null;
      } catch (e) {
        return e instanceof ProjectFileError ? e.messageKey : 'other';
      }
    };
    expect(fail('nope')).toBe('ui.projectFile.errors.notJson');
    expect(fail('{"format":"other"}')).toBe('ui.projectFile.errors.notProject');
    expect(fail('{"format":"mixr","version":9}')).toBe('ui.projectFile.errors.version');
    expect(fail('{"format":"mixr","version":1,"settings":{"bpm":120},"ast":{"nodes":[{"id":1}],"edges":[]}}')).toBe('ui.projectFile.errors.invalid');
  });

  it('ZIP-Export → Import: Projekt und Audiodaten kommen zurück, fehlende bleiben im Manifest', async () => {
    const blobs: Record<string, Blob> = {
      'file-1': new Blob([new Uint8Array([1, 2, 3, 4])]),
      'file-3': new Blob([new Uint8Array([9, 8, 7])]),
    };
    const { zip, missing } = await exportProjectZip(AST, SETTINGS, async (id) => blobs[id] ?? null);
    expect(missing).toBe(1);
    const archive = await openProjectArchive(zip);
    expect(archive.project?.ast).toEqual(AST);
    expect(projectSettingsOf(archive.project!)).toEqual(SETTINGS);
    expect([...archive.blobs.keys()].sort()).toEqual(['file-1', 'file-3']);
    expect(archive.blobs.get('file-3')).toEqual(new Uint8Array([9, 8, 7]));
  });


  it('ZIP ohne Projekt = Sample-Ordner', async () => {
    const zip = await createZip([
      { path: 'drums/kick/a.wav', data: new Uint8Array([1]) },
      { path: 'readme.txt', data: new TextEncoder().encode('hi') },
    ]);
    const archive = await openProjectArchive(zip);
    expect(archive.project).toBeNull();
    expect(archive.looseAudio.map((e) => e.path)).toEqual(['drums/kick/a.wav']);
  });

  it('Download-Name', () => {
    expect(projectDownloadName('Mein Lied!', 'zip')).toBe('mixr-mein-lied.zip');
    expect(projectDownloadName('', 'zip')).toBe('mixr.zip');
  });
});

describe('Samples im Projekt (Undo, Laden, Hinzufügen)', () => {
  beforeEach(() => {
    loadProject({ nodes: [], edges: [] }, { bpm: 120 });
  });

  it('setUserSamples ist undo-fähig, loadProject ersetzt, appendProject ergänzt', () => {
    setUserSamples(SLOTS);
    expect(projectSettings.get().samples).toEqual(SLOTS);
    undo();
    expect(projectSettings.get().samples).toBeUndefined();

    setUserSamples([SLOTS[0]!]);
    loadProject(AST, { bpm: 100 });
    expect(projectSettings.get().samples).toBeUndefined();

    loadProject(AST, { bpm: 100, samples: [SLOTS[0]!] });
    appendProject(AST, undefined, SLOTS);
    expect(projectSettings.get().samples!.map((s) => s.name)).toEqual(['kick', 'vox']);
    expect(visualAstStore.get().nodes.filter((n) => n.type === 'track')).toHaveLength(2);
    undo();
    expect(projectSettings.get().samples!.map((s) => s.name)).toEqual(['kick']);
  });
});
