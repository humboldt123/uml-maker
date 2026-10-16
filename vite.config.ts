import { defineConfig } from 'vitest/config';

// Relative base: works at the custom domain root (uml-maker.vivime.info, see public/CNAME)
// and under https://humboldt123.github.io/uml-maker/ alike.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: { include: ['tests/**/*.test.ts'] },
});
