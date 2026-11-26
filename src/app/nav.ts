// Which screen is showing. Tiny on purpose: three screens, no router.
import { signal } from '@preact/signals';

export type Screen = 'library' | 'riff' | 'capture';
export type RiffMode = 'edit' | 'lesson';

export const screen = signal<Screen>('riff');
export const riffMode = signal<RiffMode>('edit');
