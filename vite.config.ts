import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  test: {
    // The geometry overlap checks and FDTD runs take seconds each on a slow CI runner.
    testTimeout: 30000,
  },
});
