import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
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
