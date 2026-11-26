// Indirection so editor UI can preview notes without importing the audio engine.
export type Auditioner = (midis: number[], vel: number, seconds: number) => void;

let current: Auditioner | null = null;

export function setAuditioner(fn: Auditioner | null): void {
  current = fn;
}

/** Plays a short preview. No-op until an auditioner is set. */
export function audition(midis: number[], vel = 100, seconds = 0.3): void {
  current?.(midis, vel, seconds);
}
