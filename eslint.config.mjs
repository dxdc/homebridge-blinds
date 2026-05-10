// @ts-check
import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                __dirname: 'readonly',
                require: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-console': 'off',
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],
            'linebreak-style': ['error', 'unix'],
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.js', '*.config.ts'],
    },
);
