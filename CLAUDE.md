# Guitar Riff Maker

Mobile-first PWA: whistle or hum a riff, get back a tab, a fretboard view, and a lesson you can play back.

## Stack

- Preact + @preact/signals, TypeScript (strict), Vite, Vitest, Playwright
- Pitch detection: `@spotify/basic-pitch` on TensorFlow.js (`@tensorflow/tfjs`)
- Validation: zod
- Fonts: Space Grotesk (UI), IBM Plex Mono (tab/numbers), via @fontsource
- Service worker generated at build time (`scripts/sw-plugin.ts`); production only

## Commands

- `pnpm dev` - dev server (port 5173)
- `pnpm dev:lan` - HTTPS dev server on the LAN (port 5190) so a phone gets a secure context
- `pnpm test` - Vitest unit/audio/capture tests
- `pnpm test:e2e` - build to `dist-e2e` and run Playwright (`PW_PORT` to pick the preview port)
- `pnpm typecheck` - `tsc --noEmit`
- `pnpm build` - notices, typecheck, production build to `dist`

## Directory layout

- `src/app` - app shell and top-level composition
- `src/platform` - browser/device adapters (permissions, recorder worklet, storage)
- `src/capture` - mic capture, tap worklet, tracker worker
- `src/music` - pure music theory (notes, frets, tabs, lessons)
- `src/model` - pure data model and transforms (riff, tab, lesson state)
- `src/audio` - audio engine and AudioWorklet (`worklet.ts`)
- `src/ui` - tokens, base styles, components
- `src/screens` - full-screen views
- `tests/unit`, `tests/audio`, `tests/capture` - Vitest; `tests/e2e` - Playwright

## Rules

- TypeScript strict. No `any` without a comment explaining why.
- Audio is scheduled only inside the AudioWorklet. Never schedule audio with main-thread timers (`setTimeout`/`setInterval`/`requestAnimationFrame`).
- No allocations in the worklet `process()` path (preallocate buffers, no array/object literals, no closures).
- Pure logic lives in `src/music` and `src/model` and must have unit tests in `tests/unit`.
- Colours come from tokens in `src/ui/tokens.css` only, never hard-coded hex in components. Amber (`--accent`) = what you play or select; cyan (`--trace`) = live pitch; coral (`--rec`) = record.
- Left-handed mode mirrors the fretboard at render time only. Text, numbers and labels never mirror.
- Touch targets are at least 44px (`--tap`).
- Worklet and worker modules are excluded from the Preact Vite plugin (see `vite.config.ts`); keep new worklet/worker files on that list.
