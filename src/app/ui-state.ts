// Small shared UI state for the riff screen (not persisted).
import { signal } from '@preact/signals';

export type KeyMode = 'chromatic' | 'diatonic';

/** How the key ◀▶ steppers move the riff: by semitone or by scale step. */
export const keyMode = signal<KeyMode>('chromatic');
/** Whether the riff settings sheet is open. */
export const moreOpen = signal(false);
/** Edit: hide out-of-key rows in the roll and keep nudged notes in the scale. Set in the settings sheet. */
export const snapScale = signal(false);
