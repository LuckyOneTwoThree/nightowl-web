import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(dir, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

const problems = [];
for (const { from, to } of directories) {
  const sourceFiles = await listFiles(from);
  const targetFiles = await listFiles(to);
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);

  for (const relative of sourceFiles) {
    const source = path.join(from, relative);
    const target = path.join(to, relative);
    if (!targetSet.has(relative)) {
      problems.push(`missing: ${path.relative(mobileRoot, target)}`);
    } else if ((await sha256(source)) !== (await sha256(target))) {
      problems.push(`drift: ${path.relative(mobileRoot, target)}`);
    }
  }
  for (const relative of targetFiles) {
    if (!sourceSet.has(relative)) {
      problems.push(`extra: ${path.relative(mobileRoot, path.join(to, relative))}`);
    }
  }
}

for (const file of serverFiles) {
  const source = path.join(repoRoot, 'server', file);
  const target = path.join(destRoot, 'server', file);
  try {
    if ((await sha256(source)) !== (await sha256(target))) {
      problems.push(`drift: ${path.relative(mobileRoot, target)}`);
    }
  } catch {
    problems.push(`missing: ${path.relative(mobileRoot, target)}`);
  }
}

try {
  const source = path.join(repoRoot, 'server', 'sources', 'tz.mjs');
  const target = path.join(mobileRoot, 'src', 'data', 'sync', 'tz.js');
  if ((await sha256(source)) !== (await sha256(target))) {
    problems.push(`drift: ${path.relative(mobileRoot, target)}`);
  }
} catch {
  problems.push('missing: src/data/sync/tz.js');
}

if (problems.length) {
  console.error('[verify-shared] 共享层与桌面端不一致，请先运行 npm run sync:shared');
  for (const problem of problems) console.error(' - ' + problem);
  process.exit(1);
}
console.log('[verify-shared] 共享层与桌面端一致');
