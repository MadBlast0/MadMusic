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
    // Vendor code, split out of the entry chunk.
    //
    // `rolldownOptions`, not `rollupOptions`: Vite 8 bundles with rolldown, and
    // a `rollupOptions.output.manualChunks` here would be accepted and quietly
    // ignored. The build's own warning names this option.
    //
    // # What this buys, and what it does not
    //
    // Not a smaller download on a first visit — the same bytes are fetched
    // either way, in more requests. What it buys is that these four change on
    // a dependency upgrade rather than on every application edit, so a
    // returning user re-downloads the app chunk and keeps the rest. In a
    // desktop shell that matters most for the updater: a patch release ships a
    // changed entry chunk and unchanged vendor chunks.
    //
    // Grouped by upgrade cadence rather than one chunk per package. Splitting
    // finely trades a cache win for a request count, and these four move
    // together in practice.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React and its DOM renderer. Never one without the other, and a
            // version mismatch between them is a broken app rather than a
            // slow one, so they belong in the same chunk.
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            // Radix primitives, behind the `radix-ui` umbrella package.
            {
              name: 'radix',
              test: /[\\/]node_modules[\\/](radix-ui|@radix-ui)[\\/]/,
            },
            // Motion. Large, and already loaded lazily for its feature bundle
            // in `providers.tsx`; this keeps the core out of the entry too.
            { name: 'motion', test: /[\\/]node_modules[\\/]motion/ },
            // Icons. Tree-shaken to the ones actually used, but that set is
            // stable across application changes.
            { name: 'icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/ },
            // Everything else from `node_modules`, as one chunk.
            //
            // Last, so the named groups above claim their packages first —
            // groups are matched in order and the first match wins.
            //
            // A catch-all rather than a group per package: the remainder is
            // Convex, Clerk, sonner, cmdk and a handful of small utilities,
            // none individually worth a request. Naming them one by one would
            // also mean editing this list every time a dependency is added,
            // and the one that got forgotten would silently land back in the
            // entry chunk — which is how the entry grew to 974 kB.
            //
            // With this, the entry chunk is application code only, so its size
            // tracks the app rather than its dependencies and
            // `chunkSizeWarningLimit` becomes a signal about code that was
            // actually written here.
            { name: 'vendor', test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
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
