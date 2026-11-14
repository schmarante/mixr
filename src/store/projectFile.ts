import type { TKey } from '../i18n';
import { createZip, isZip, readZip, ZipError, type ZipEntry } from '../lib/zip';
import type { ProjectSettings, UserSampleFile, UserSampleSlot, VisualAst } from '../types/ast';
import { baseName, isAudioFileName, sanitizeSampleName } from './userSamples';

/**
 * Projektdatei „strudelmixr.json“ und Projekt-ZIP (JSON + samples/<slot>/<datei>).
 * Reine Funktionen (Node-tauglich, getestet); Audiodaten kommen über einen Getter.
 */

export const PROJECT_FILE_NAME = 'strudelmixr.json';
export const PROJECT_FORMAT = 'strudelmixr';
export const PROJECT_VERSION = 1;

export interface ProjectSampleFile extends UserSampleFile {
  /** Pfad im ZIP, z. B. „samples/kick/kick-01.wav“. */
  path: string;
}

export interface ProjectSampleSlot extends Omit<UserSampleSlot, 'files'> {
  files: ProjectSampleFile[];
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  settings: Omit<ProjectSettings, 'samples'> & { samples?: ProjectSampleSlot[] };
  ast: VisualAst;
}

/* ------------------------------------------------------------------ */
/* Schreiben                                                           */
/* ------------------------------------------------------------------ */

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'sample' : cleaned;
}

/** Manifest mit eindeutigen ZIP-Pfaden je Datei. */
export function buildProjectFile(ast: VisualAst, settings: ProjectSettings): ProjectFile {
  const { samples, ...rest } = settings;
  const file: ProjectFile = { format: PROJECT_FORMAT, version: PROJECT_VERSION, settings: { ...rest }, ast };
  if (samples && samples.length > 0) {
    file.settings.samples = samples.map((slot) => {
      const used = new Set<string>();
      return {
        ...slot,
        files: slot.files.map((f) => {
          let name = safeFileName(f.fileName);
          const dot = name.lastIndexOf('.');
          const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
          for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}-${i}${ext}`;
          used.add(name.toLowerCase());
          return { ...f, path: `samples/${slot.name}/${name}` };
        }),
      };
    });
  }
  return file;
}

/** Dateiname des Downloads: strudelmixr-<name>.zip bzw. .json */
export function projectDownloadName(name: string, ext: 'zip' | 'json'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `strudelmixr${slug ? `-${slug}` : ''}.${ext}`;
}

/**
 * Projekt als ZIP. Fehlen Audiodaten (getBlob → null), bleibt der Eintrag im
 * Manifest (beim Öffnen „fehlt“), die Datei selbst fehlt im ZIP.
 */
export async function exportProjectZip(
  ast: VisualAst,
  settings: ProjectSettings,
  getBlob: (fileId: string) => Promise<Blob | null>,
): Promise<{ zip: Uint8Array; missing: number }> {
  const project = buildProjectFile(ast, settings);
  const entries: ZipEntry[] = [{ path: PROJECT_FILE_NAME, data: new TextEncoder().encode(JSON.stringify(project, null, 2)) }];
  let missing = 0;
  for (const slot of project.settings.samples ?? []) {
    for (const f of slot.files) {
      const blob = await getBlob(f.id);
      if (!blob) {
        missing++;
        continue;
      }
      entries.push({ path: f.path, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  }
  return { zip: await createZip(entries), missing };
}

/* ------------------------------------------------------------------ */
/* Lesen & prüfen                                                      */
/* ------------------------------------------------------------------ */

export class ProjectFileError extends Error {
  constructor(readonly messageKey: TKey) {
    super(String(messageKey));
    this.name = 'ProjectFileError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function checkAst(v: unknown): VisualAst {
  if (!isObj(v) || !Array.isArray(v['nodes']) || !Array.isArray(v['edges'])) throw new ProjectFileError('ui.projectFile.errors.invalid');
  for (const n of v['nodes'] as unknown[]) {
    if (!isObj(n) || !isStr(n['id']) || !isStr(n['type']) || !isObj(n['params'])) throw new ProjectFileError('ui.projectFile.errors.invalid');
  }
  for (const e of v['edges'] as unknown[]) {
    if (!isObj(e) || !isStr(e['id']) || !isStr(e['source']) || !isStr(e['target'])) throw new ProjectFileError('ui.projectFile.errors.invalid');
  }
  return v as unknown as VisualAst;
}

function checkSamples(v: unknown): ProjectSampleSlot[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ProjectFileError('ui.projectFile.errors.invalid');
  const names: string[] = [];
  return v.map((raw): ProjectSampleSlot => {
    if (!isObj(raw) || !Array.isArray(raw['files'])) throw new ProjectFileError('ui.projectFile.errors.invalid');
    const name = sanitizeSampleName(isStr(raw['name']) ? raw['name'] : 'sample', names);
    names.push(name);
    const files = (raw['files'] as unknown[]).map((f): ProjectSampleFile => {
      if (!isObj(f) || !isStr(f['id']) || !isStr(f['fileName'])) throw new ProjectFileError('ui.projectFile.errors.invalid');
      const file: ProjectSampleFile = {
        id: f['id'],
        fileName: baseName(f['fileName']),
        mime: isStr(f['mime']) ? f['mime'] : 'application/octet-stream',
        size: typeof f['size'] === 'number' ? f['size'] : 0,
        path: isStr(f['path']) ? f['path'] : `samples/${name}/${baseName(f['fileName'])}`,
      };
      if (typeof f['duration'] === 'number') file.duration = f['duration'];
      return file;
    });
    return { id: isStr(raw['id']) ? raw['id'] : `slot-${name}`, name, files };
  });
}

/** Prüft und normalisiert eine strudelmixr.json. @throws ProjectFileError */
export function parseProjectFile(text: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectFileError('ui.projectFile.errors.notJson');
  }
  if (!isObj(data) || data['format'] !== PROJECT_FORMAT) throw new ProjectFileError('ui.projectFile.errors.notProject');
  if (data['version'] !== PROJECT_VERSION) throw new ProjectFileError('ui.projectFile.errors.version');
  const settings = data['settings'];
  if (!isObj(settings) || typeof settings['bpm'] !== 'number' || !Number.isFinite(settings['bpm'])) {
    throw new ProjectFileError('ui.projectFile.errors.invalid');
  }
  const ast = checkAst(data['ast']);
  const samples = checkSamples(settings['samples']);
  const out: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    settings: { bpm: settings['bpm'] },
    ast,
  };
  if (isStr(settings['prelude'])) out.settings.prelude = settings['prelude'];
  if (samples.length > 0) out.settings.samples = samples;
  return out;
}

/** Projekt-Manifest → ProjectSettings (ZIP-Pfade fallen weg). */
export function projectSettingsOf(project: ProjectFile): ProjectSettings {
  const { samples, ...rest } = project.settings;
  const settings: ProjectSettings = { ...rest };
  if (samples && samples.length > 0) {
    settings.samples = samples.map((s) => ({ id: s.id, name: s.name, files: s.files.map(({ path: _path, ...f }) => f) }));
  }
  return settings;
}

export interface OpenedArchive {
  /** Projekt aus strudelmixr.json (fehlt bei reinen Sample-Archiven). */
  project: ProjectFile | null;
  /** Audiodaten je Datei-ID des Projekts. */
  blobs: Map<string, Uint8Array>;
  /** Audiodateien ohne Projektbezug (Sample-Ordner im ZIP). */
  looseAudio: ZipEntry[];
}

/** Liest ein Projekt- oder Sample-ZIP. @throws ProjectFileError */
export async function openProjectArchive(data: Uint8Array): Promise<OpenedArchive> {
  if (!isZip(data)) throw new ProjectFileError('ui.projectFile.errors.notZip');
  let entries: ZipEntry[];
  try {
    entries = await readZip(data);
  } catch (err) {
    throw new ProjectFileError(err instanceof ZipError && err.reason === 'unsupported' ? 'ui.projectFile.errors.zipUnsupported' : 'ui.projectFile.errors.zipBroken');
  }
  // strudelmixr.json im Wurzelordner oder in genau einem Unterordner (z. B. nach Entpacken/Neu-Packen)
  const manifest = entries.find((e) => baseName(e.path) === PROJECT_FILE_NAME && e.path.split('/').length <= 2);
  if (!manifest) {
    return { project: null, blobs: new Map(), looseAudio: entries.filter((e) => isAudioFileName(e.path)) };
  }
  const prefix = manifest.path.slice(0, manifest.path.length - PROJECT_FILE_NAME.length);
  const project = parseProjectFile(new TextDecoder().decode(manifest.data));
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const blobs = new Map<string, Uint8Array>();
  for (const slot of project.settings.samples ?? []) {
    for (const f of slot.files) {
      const hit = byPath.get(prefix + f.path) ?? byPath.get(f.path);
      if (hit) blobs.set(f.id, hit.data);
    }
  }
  return { project, blobs, looseAudio: [] };
}
