import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Absolute imports: `@/x` -> `src/x`
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Modern baseline keeps the bundle small; adjust if you must support older browsers.
    target: 'es2022',
    // Surface accidental bundle bloat early.
    chunkSizeWarningLimit: 600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // Threads, not the default `forks`. On Windows the fork pool intermittently
    // fails with "Timeout waiting for worker to respond" before a single test
    // runs, and a suite that fails for reasons unrelated to the code is worse
    // than no suite — it trains you to re-run rather than to read the failure.
    pool: 'threads',
    // One file at a time. jsdom plus a full provider tree is heavy enough that
    // parallel files contend for the same cores and each other's timers; the
    // wall-clock saving is small and the flakiness is not.
    fileParallelism: false,
    // Twenty seconds, not vitest's five.
    //
    // The heavy tests here render the entire application into jsdom and then
    // run axe over the result. That is 3–5 seconds of real work on an idle
    // machine, which leaves nothing in hand: on a machine that is also
    // compiling, or running other projects, `accessibility.test.tsx` crosses
    // five seconds and fails on the clock rather than on a violation. Observed
    // at 6.3s while the rest of this machine was busy; the same three tests
    // pass in 22s total when given room.
    //
    // Same reasoning as `pool` and `fileParallelism` above: a suite that fails
    // for reasons unrelated to the code is worse than no suite. A real hang
    // still fails, twenty seconds later.
    testTimeout: 20_000,
  },
});
