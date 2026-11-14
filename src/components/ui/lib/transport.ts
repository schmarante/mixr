import { playbackState, transportCommand } from '../../../store/agentBus';

/**
 * Transport-Wünsche an den Audio-Agent. MUSS synchron im Klick-/Keydown-Handler
 * aufgerufen werden (Autoplay-Policy: AudioContext braucht die User-Geste).
 */
export function requestPlay(): void {
  transportCommand.set({ action: 'play', at: Date.now() });
}

export function requestStop(): void {
  transportCommand.set({ action: 'stop', at: Date.now() });
}

export function togglePlayback(): void {
  if (playbackState.get().isPlaying) requestStop();
  else requestPlay();
}
