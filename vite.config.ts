import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function getAppVersion(): string {
  try {
    const commitCount = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
    const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (commitCount && gitHash) return `v${commitCount} (${gitHash})`;
    if (gitHash) return `v1 (${gitHash})`;
  } catch {
    // Fallback when git metadata is unavailable
  }
  return 'v1';
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },
});
