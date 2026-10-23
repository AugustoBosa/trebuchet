import { defineConfig } from 'vite';

// two pages: the lab (index) and the article (learn)
export default defineConfig({
  build: { rollupOptions: { input: { index: 'index.html', learn: 'learn.html' } } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30000 }, // not the copies in .claude/worktrees; the physics tests are CPU-heavy (5 s tripped on a busy machine and would on a CI runner)
});
