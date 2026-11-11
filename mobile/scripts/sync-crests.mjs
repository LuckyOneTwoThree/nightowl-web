import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCrestMapContent } from './crest-map.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const mobileRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'public', 'crests');
const destDir = path.join(mobileRoot, 'assets', 'crests');
const mapFile = path.join(mobileRoot, 'src', 'data', 'crests.ts');

await rm(destDir, { recursive: true, force: true });
await mkdir(destDir, { recursive: true });
await mkdir(path.dirname(mapFile), { recursive: true });

const files = (await readdir(sourceDir)).filter(file => file.endsWith('.png')).sort();
for (const file of files) {
  await cp(path.join(sourceDir, file), path.join(destDir, file));
}

const content = buildCrestMapContent(files);

await writeFile(mapFile, content);
console.log(`[sync-crests] ${files.length} crests → mobile/assets/crests + src/data/crests.ts`);
