import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Integration files share one database and truncate it, so files must not run concurrently.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], fileParallelism: false },
});
