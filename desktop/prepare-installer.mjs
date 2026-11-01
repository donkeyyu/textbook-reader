import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
// Vite keeps the web build intact. Only the desktop build removes downloadable pages.
await rm(new URL('../dist/textbooks', import.meta.url), { recursive: true, force: true });
const result = spawnSync(process.execPath, ['scripts/offline-resources.mjs', 'installer', 'dist', 'resources/offline/installer.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
