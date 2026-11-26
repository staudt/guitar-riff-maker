import { test } from '@playwright/test';
import { fakeMic, files } from './fakeMic';
import { recordAndCheck } from './captureFlow';

// Freely timed (not on a beat grid), two octaves up, repeated last note.
test.use({ launchOptions: fakeMic(files.whistle) });
test('whistled take: REC -> auto-stop -> editor with trace, notes, playback', async ({ page }) => recordAndCheck(page, 'Whistle'));
