/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { serviceWorker } from './scripts/sw-plugin';

export default defineConfig(({ mode }) => ({
  base: './',
  // `pnpm dev:lan` serves https on the LAN (self-signed) so the phone gets a secure context for AudioWorklet.
  plugins: [
    // Worklet and worker modules have no DOM (and no Vite HMR client): keep Preact's dev-only
    // refresh/debug injection out of them.
    preact({ exclude: [/\/src\/audio\/worklet\.ts$/, /\/src\/platform\/recorderWorklet\.ts$/, /\/src\/capture\/tapWorklet\.ts$/, /\/src\/capture\/trackerWorker\.ts$/] }),
    serviceWorker(),
    ...(mode === 'lan' ? [basicSsl()] : []),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/audio/**/*.test.ts', 'tests/capture/**/*.test.ts'],
    testTimeout: 5_000,
  },
}));
