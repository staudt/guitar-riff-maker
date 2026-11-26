/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { serviceWorker } from './scripts/sw-plugin';

export default defineConfig(({ mode }) => ({
  base: './',
  // `pnpm dev:lan` serves https on the LAN (self-signed) so the phone gets a secure context for AudioWorklet.
  plugins: [
    // Worklets/workers (and every module they import) have no DOM and no Vite HMR client, so Preact's
    // dev-only refresh injection must stay out of them. Only .tsx files hold components: exclude all .ts.
    preact({ exclude: [/\.ts$/] }),
    serviceWorker(),
    ...(mode === 'lan' ? [basicSsl()] : []),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/audio/**/*.test.ts', 'tests/capture/**/*.test.ts'],
    testTimeout: 5_000,
  },
}));
