import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default [
  { ignores: ['dist', 'dev-dist', 'coverage', 'docs/prototype'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],

      // eslint-plugin-react-hooks 7 adds the React Compiler's own rules, and
      // they found 35 real things on first run. They are warnings rather than
      // errors for now, the same way biome.json holds the a11y backlog:
      // visible, counted, and promoted back to `error` as each is cleared.
      // Landing them as errors instead would have meant either a 35-item
      // refactor inside a dependency upgrade, or turning them off and
      // pretending the findings did not exist.
      //
      //   static-components (20, all in src/pages/Admin.jsx) — components
      //     declared inside other components. They get a new identity every
      //     render, so React unmounts and remounts the subtree instead of
      //     updating it, losing its state and DOM each time. Concentrated in
      //     one file, so it is one afternoon rather than a campaign.
      //   set-state-in-effect (14) — the `useEffect(() => { load() }, [load])`
      //     shape every page uses to fetch on mount. Idiomatic for its time
      //     and not wrong, but it is the cascade the compiler wants gone.
      //   preserve-manual-memoization (1, AuthContext) — a useCallback whose
      //     declared dependencies are narrower than the ones inferred
      //     (`session?.user?.id` against `session`), so the compiler declines
      //     to optimise that component at all.
      'react-hooks/static-components': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    // Test files and test helpers export fixtures and utilities, not
    // components — react-refresh's rule has nothing to say about them.
    files: ['**/*.test.{js,jsx}', 'test/**/*.{js,jsx,mjs}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // public/push-sw.js runs as a service worker, not in a page: it uses
    // `clients`, `registration` and `importScripts`, none of which exist in
    // the browser globals above. It used to declare them with a
    // `/* global self, clients */` comment, which was itself the one error
    // this config reported — `self` is already a browser built-in, so naming
    // it again is `no-redeclare`. Giving the file the right environment is
    // both the fix and one less hand-maintained list.
    files: ['public/*.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
]
