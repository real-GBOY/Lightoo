import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: ['next-env.d.ts', '.next/**', 'node_modules/**', 'coverage/**', 'public/sw.js'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
