import { atom } from 'nanostores';

/**
 * Hintergrund-Visualizer: an/aus und gewählter Modus. Reine Komfort-Einstellung im
 * localStorage; standardmäßig aus, wird über das „⋯“-Menü eingeschaltet.
 */
export const VISUALIZER_MODES = ['warp', 'plasma', 'mesh'] as const;
export type VisualizerMode = (typeof VISUALIZER_MODES)[number];

const ON_KEY = 'mixr.visualizer';
const MODE_KEY = 'mixr.visualizer.mode';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* egal */
  }
}

function isMode(v: string | null): v is VisualizerMode {
  return (VISUALIZER_MODES as readonly string[]).includes(v ?? '');
}

const isBrowser = typeof window !== 'undefined';
const storedMode = isBrowser ? read(MODE_KEY) : null;

export const visualizerEnabled = atom<boolean>(isBrowser && read(ON_KEY) === '1');
export const visualizerMode = atom<VisualizerMode>(isMode(storedMode) ? storedMode : 'warp');

export function setVisualizerEnabled(on: boolean): void {
  visualizerEnabled.set(on);
  write(ON_KEY, on ? '1' : '0');
}

export function setVisualizerMode(mode: VisualizerMode): void {
  visualizerMode.set(mode);
  write(MODE_KEY, mode);
}

/** Nächster Modus in der Reihe; gibt ihn zurück. */
export function nextVisualizerMode(): VisualizerMode {
  const i = VISUALIZER_MODES.indexOf(visualizerMode.get());
  const next = VISUALIZER_MODES[(i + 1) % VISUALIZER_MODES.length]!;
  setVisualizerMode(next);
  return next;
}
