import { defineConfig } from 'vite';

// two pages: the lab (index) and the article (learn)
export default defineConfig({
  build: { rollupOptions: { input: { index: 'index.html', learn: 'learn.html' } } },
  test: { include: ['test/**/*.test.ts'] }, // not the copies in .claude/worktrees
});
