import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function getAppVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const baseVersion = pkg.version || '1.0.0';
  try {
    const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (gitHash) return `v${baseVersion} (${gitHash})`;
  } catch {
    // Fallback when git metadata is unavailable
  }
  return `v${baseVersion}`;
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },
});
