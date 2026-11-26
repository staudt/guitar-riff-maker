// Record -> hear: Chromium plays a riff file as the microphone. REC, sing/whistle, auto-stop on
// silence, then the editor shows the recorded line with the notes on it and starts playing.
import { expect, type Page } from '@playwright/test';

// A3 C4 B3 A3 E3 G3 A3 A3 (the octave gets folded into guitar range): same contour, nothing skipped.
const WANT = [57, 60, 59, 57, 52, 55, 57, 57];

export async function recordAndCheck(page: Page, source: 'Whistle' | 'Hum') {
  await page.goto('./');
  await page.getByTestId('nav-capture').click();
  await page.getByTestId('capture-source').getByText(source).click();
  await page.getByTestId('capture-rec').click();
  await expect(page.getByTestId('capture-screen')).toHaveAttribute('data-phase', 'recording');

  // ~3 s of sound then silence: auto-stop, analysis, editor.
  await expect(page.getByTestId('riff-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('riff-meta')).toContainText('free time');

  const riff = await page.evaluate(() => (window as unknown as { __riff: () => { notes: { midi: number }[]; trace?: unknown } }).__riff());
  expect(riff.notes.map((n) => n.midi - riff.notes[0]!.midi)).toEqual(WANT.map((m) => m - WANT[0]!));
  expect(riff.trace).toBeTruthy();

  await expect(page.getByTestId('trace-layer')).toBeVisible();
  await expect(page.getByTestId('roll-note')).toHaveCount(WANT.length);
  await expect(page.getByTestId('tab-note')).toHaveCount(WANT.length);
  // It plays back right away, highlighting notes.
  await expect(page.getByTestId('tb-play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-active]').first()).toBeAttached({ timeout: 5_000 });
}

