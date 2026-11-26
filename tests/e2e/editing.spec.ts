// Touch editing on a phone: select first, then act. Real touch input through CDP so the browser
// generates pointer events (and its own scroll/cancel behaviour) the way a finger does.
import { expect, test, type CDPSession, type Page } from '@playwright/test';

type N = { id: string; step: number; length: number; midi: number };
const notes = (page: Page) => page.evaluate(() => (window as unknown as { __riff: () => { notes: N[] } }).__riff().notes);

// Three 250 ms notes, all on screen at 390 px wide.
const RAW = [
  { start: 0.1, end: 0.35, midi: 57, velocity: 100 },
  { start: 0.6, end: 0.85, midi: 60, velocity: 100 },
  { start: 1.1, end: 1.35, midi: 62, velocity: 100 },
];

class Finger {
  constructor(private cdp: CDPSession) {}
  private pt = (x: number, y: number) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 0.5 }];
  async tap(x: number, y: number, wobble = 7) {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.pt(x, y) });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.pt(x + wobble, y + wobble / 2) });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.pt(x - 2, y + 1) });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async drag(x: number, y: number, dx: number, dy = 0, steps = 8) {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.pt(x, y) });
    for (let i = 1; i <= steps; i++) {
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.pt(x + (dx * i) / steps, y + (dy * i) / steps) });
    }
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => '__capture' in window);
  await page.evaluate((raw) => (window as unknown as { __capture: { place: (n: unknown[]) => void } }).__capture.place(raw), RAW);
  await expect(page.getByTestId('riff-screen')).toBeVisible();
  await expect(page.getByTestId('roll-note')).toHaveCount(3);
});

async function setup(page: Page) {
  const finger = new Finger(await page.context().newCDPSession(page));
  const noteBox = async (i: number) => (await page.getByTestId('roll-note').nth(i).boundingBox())!;
  /** A point in the roll that is far (> 3 rows) from every note, at the x of note `i`. */
  const emptyAt = async (i: number) => {
    const b = await noteBox(i);
    const roll = (await page.getByTestId('roll').boundingBox())!;
    const cy = b.y + b.height / 2;
    const y = cy + 108 < roll.y + roll.height - 4 ? cy + 108 : cy - 108;
    return { x: b.x + b.width / 2, y };
  };
  return { finger, noteBox, emptyAt };
}

test('wobbly tap on a note selects it and shows the selection bar', async ({ page }) => {
  const { finger, noteBox } = await setup(page);
  const b = await noteBox(1);
  await finger.tap(b.x + b.width / 2, b.y + b.height / 2, 9);
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await expect(page.getByTestId('edit-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('roll-note').nth(1)).toHaveClass(/roll__note--sel/);
  await expect(page.getByTestId('roll-handle')).toHaveCount(1);
  await expect(page.getByTestId('roll-handle-l')).toHaveCount(1);
});

test('tapping within 10 px outside a note selects it', async ({ page }) => {
  const { finger, noteBox } = await setup(page);
  const b = await noteBox(2);
  await finger.tap(b.x + b.width + 10, b.y + b.height / 2, 3);
  await expect(page.getByTestId('roll-note').nth(2)).toHaveClass(/roll__note--sel/);
});

test('tap on empty space deselects and never adds', async ({ page }) => {
  const { finger, noteBox, emptyAt } = await setup(page);
  const b = await noteBox(0);
  await finger.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  const p = await emptyAt(0);
  await finger.tap(p.x, p.y);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  expect(await notes(page)).toHaveLength(3);
});

test('double-tap on empty space adds exactly one note', async ({ page }) => {
  const { finger, emptyAt } = await setup(page);
  const p = await emptyAt(1);
  await finger.tap(p.x, p.y, 3);
  await finger.tap(p.x + 4, p.y + 2, 3);
  await expect(page.getByTestId('roll-note')).toHaveCount(4);
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  const ns = await notes(page);
  expect(ns).toHaveLength(4);
  expect(ns.some((n) => n.length === 25)).toBe(true);
});

test('delete from the selection bar removes the note and deselects', async ({ page }) => {
  const { finger, noteBox } = await setup(page);
  const b = await noteBox(1);
  await finger.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByTestId('sheet-delete').click();
  await expect(page.getByTestId('roll-note')).toHaveCount(2);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
});

test('dragging the right handle of the selected note lengthens it', async ({ page }) => {
  const { finger, noteBox } = await setup(page);
  const before = (await notes(page))[1]!;
  const b = await noteBox(1);
  await finger.tap(b.x + b.width / 2, b.y + b.height / 2);
  const h = (await page.getByTestId('roll-handle').boundingBox())!;
  await finger.drag(h.x + h.width / 2, h.y + h.height / 2, 60);
  await expect.poll(async () => (await notes(page))[1]!.length).toBeGreaterThan(before.length + 10);
  expect((await notes(page))[1]!.step).toBe(before.step);
});

test('dragging the left handle moves the start and keeps the end', async ({ page }) => {
  const { finger, noteBox } = await setup(page);
  const before = (await notes(page))[1]!;
  const b = await noteBox(1);
  await finger.tap(b.x + b.width / 2, b.y + b.height / 2);
  const h = (await page.getByTestId('roll-handle-l').boundingBox())!;
  await finger.drag(h.x + h.width / 2, h.y + h.height / 2, -40);
  await expect.poll(async () => (await notes(page))[1]!.step).toBeLessThan(before.step - 5);
  const after = (await notes(page))[1]!;
  expect(after.step + after.length).toBe(before.step + before.length);
});

test('dragging the selected note moves it', async ({ page }) => {
  const { finger, noteBox } = await setup(page);
  const before = (await notes(page))[1]!;
  const b = await noteBox(1);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await finger.tap(cx, cy);
  await finger.drag(cx, cy, 50);
  await expect.poll(async () => (await notes(page)).find((n) => n.midi === before.midi)!.step).toBeGreaterThan(before.step + 10);
});

test('a swipe that starts on an unselected note does not move it', async ({ page }) => {
  const { finger, noteBox } = await setup(page);
  const before = await notes(page);
  const b = await noteBox(1);
  await finger.drag(b.x + b.width / 2, b.y + b.height / 2, -80, 30);
  await page.waitForTimeout(300);
  expect(await notes(page)).toEqual(before);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
});
