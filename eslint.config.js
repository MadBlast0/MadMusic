import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // `src-tauri/target` is Cargo's build directory. It has to be here rather
  // than left to the default ignores because Tauri's codegen writes compressed
  // asset blobs there with a `.js` extension — `eslint .` picks them up and
  // reports a parse error per file, which makes `pnpm verify` fail for anyone
  // who has ever run a release build. The lint result must not depend on
  // whether a build directory happens to exist.
  // `src-tauri/gen` is likewise generated (the Android/iOS projects).
  // `.prettierignore` already lists both; this keeps the two tools agreed.
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'src-tauri/target',
      'src-tauri/gen',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Node-context config files
  {
    files: ['*.{js,ts}', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Vendored shadcn/ui primitives are upstream source we re-sync with the
  // shadcn CLI, so we don't hand-patch them to satisfy our lint config.
  //
  // - only-export-components: they intentionally co-export variants/helpers
  //   (e.g. buttonVariants, useFormField).
  // - set-state-in-effect / purity: React Compiler rules added in
  //   eslint-plugin-react-hooks v7. carousel.tsx syncs embla state in an
  //   effect, and sidebar.tsx randomises skeleton widths during render. Both
  //   are cosmetic upstream patterns; fixing them locally would be clobbered
  //   on the next `shadcn add`.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  // Disable stylistic rules that conflict with Prettier — keep last.
  prettier,
);
