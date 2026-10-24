import { defineConfig } from 'vite';

// two pages: the lab (index) and the article (learn)
export default defineConfig({
  base: './', // relative asset paths: the build works under any subpath (GitHub Pages serves it at /<repo>/)
  build: { rollupOptions: { input: { index: 'index.html', learn: 'learn.html' } }, chunkSizeWarningLimit: 700 }, // 700 kB: the lazy 3D chunk is three.js itself (~636 kB), nothing of ours to split
  test: { include: ['test/**/*.test.ts'], testTimeout: 30000 }, // not the copies in .claude/worktrees; the physics tests are CPU-heavy (5 s tripped on a busy machine and would on a CI runner)
});
