import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    testTimeout: 10000,
    hookTimeout: 15000,
  },
});
