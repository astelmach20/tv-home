import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', '.state', 'eslint.config.js'] },
  { files: ['web/**'], languageOptions: { globals: { window: 'readonly', document: 'readonly' } } },
  js.configs.recommended,
  // Type-aware rules: no `any`, explicit or leaking in from untyped values.
  ...tseslint.configs.strictTypeChecked,
  prettier,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `x => void call()` callbacks are idiomatic; still flags void values used inside other expressions.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Fastify handlers and interface implementations are async by contract even when they don't await.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
