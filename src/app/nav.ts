// Which screen is showing. Tiny on purpose: three screens, no router.
import { signal } from '@preact/signals';

export type Screen = 'library' | 'riff' | 'capture';

export const screen = signal<Screen>('riff');
