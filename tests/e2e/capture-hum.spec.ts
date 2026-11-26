import { test } from '@playwright/test';
import { fakeMic, files } from './fakeMic';
import { recordAndCheck } from './captureFlow';

test.use({ launchOptions: fakeMic(files.melody) });
test('hummed take: REC -> auto-stop -> editor with trace, notes, playback', async ({ page }) => recordAndCheck(page, 'Hum'));
