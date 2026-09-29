import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

// Regras do React Compiler (eslint-plugin-react-hooks v7) rebaixadas para warning:
// os casos existentes exigem refatoração de comportamento (derivar estado em vez de
// setState em effect, extrair componentes aninhados) e são tratados junto da quebra
// dos componentes monolíticos, não em massa.
const reactCompilerAsWarn = Object.fromEntries(
  [
    'set-state-in-effect',
    'static-components',
    'refs',
    'immutability',
    'preserve-manual-memoization',
    'purity',
  ].map((rule) => [`react-hooks/${rule}`, 'warn']),
);

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...reactCompilerAsWarn,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Toggle de Set via ternário (`has ? delete : add`) é idiomático no código.
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
