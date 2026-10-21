import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const mobileRoot = path.resolve(scriptDir, '..');
const destRoot = path.join(mobileRoot, 'src', 'shared');

const directories = [
  { from: path.join(repoRoot, 'src', 'core'), to: path.join(destRoot, 'core') },
  { from: path.join(repoRoot, 'src', 'data'), to: path.join(destRoot, 'data') },
];

const serverFiles = [
  'espn-alias.json',
  'openfootball-alias.json',
  'scraper-alias.json',
  'highlights-alias.json',
  'watch-sources.json',
  'rules.json',
];

await rm(destRoot, { recursive: true, force: true });
await mkdir(destRoot, { recursive: true });

for (const { from, to } of directories) {
  await cp(from, to, { recursive: true });
}

const serverDest = path.join(destRoot, 'server');
await mkdir(serverDest, { recursive: true });
for (const file of serverFiles) {
  await cp(path.join(repoRoot, 'server', file), path.join(serverDest, file));
}

await cp(
  path.join(repoRoot, 'server', 'sources', 'tz.mjs'),
  path.join(mobileRoot, 'src', 'data', 'sync', 'tz.js')
);

console.log('[sync-shared] desktop src/core + src/data + server aliases → mobile/src/shared');
