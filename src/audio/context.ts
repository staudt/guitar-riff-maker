// The app has a single AudioContext, owned by platform/audio.ts (iOS unlock, latencyHint 'interactive').
// Re-exported here so audio code has one import point and never creates a second context.
export { getAudioContext, ensureRunning, onAudioStateChange } from '../platform/audio';
