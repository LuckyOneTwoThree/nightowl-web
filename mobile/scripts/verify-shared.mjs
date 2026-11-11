import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCrestMapContent } from './crest-map.mjs';

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

/* crest：public/crests（桌面源）↔ assets/crests（移动副本）↔ src/data/crests.ts（生成映射）。
   此前只校验 core/data，crest 增删改后忘跑 sync:crests 不会被门禁拦下。 */
const crestSourceDir = path.join(repoRoot, 'public', 'crests');
const crestDestDir = path.join(mobileRoot, 'assets', 'crests');
const crestMapFile = path.join(mobileRoot, 'src', 'data', 'crests.ts');
try {
  const sourceCrests = (await readdir(crestSourceDir)).filter(f => f.endsWith('.png')).sort();
  const destCrests = (await readdir(crestDestDir)).filter(f => f.endsWith('.png')).sort();
  const sourceSet = new Set(sourceCrests);
  const destSet = new Set(destCrests);
  for (const file of sourceCrests) {
    if (!destSet.has(file)) {
      problems.push(`missing: assets/crests/${file}`);
    } else if (
      (await sha256(path.join(crestSourceDir, file))) !== (await sha256(path.join(crestDestDir, file)))
    ) {
      problems.push(`drift: assets/crests/${file}`);
    }
  }
  for (const file of destCrests) {
    if (!sourceSet.has(file)) problems.push(`extra: assets/crests/${file}`);
  }
  // 映射必须与「按当前源重算」字节一致：手改 crests.ts 或忘同步都会露馅
  const expectedMap = buildCrestMapContent(sourceCrests);
  const actualMap = await readFile(crestMapFile, 'utf8');
  if (expectedMap !== actualMap) {
    problems.push('drift: src/data/crests.ts（与 public/crests 不一致，请运行 npm run sync:crests）');
  }
} catch {
  problems.push('missing: crest 源/副本/映射（public/crests、assets/crests、src/data/crests.ts）');
}

if (problems.length) {
  console.error('[verify-shared] 共享层与桌面端不一致，请先运行 npm run sync:shared');
  for (const problem of problems) console.error(' - ' + problem);
  process.exit(1);
}
console.log('[verify-shared] 共享层与桌面端一致');
