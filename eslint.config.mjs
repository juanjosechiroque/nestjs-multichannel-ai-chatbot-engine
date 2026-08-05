import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['coverage/', 'dist/', 'node_modules/', 'src/generated/prisma/'],
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...eslint.configs.recommended,
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.spec.ts'],
    languageOptions: {
      globals: globals.jest,
    },
  },
  eslintConfigPrettier,
];
