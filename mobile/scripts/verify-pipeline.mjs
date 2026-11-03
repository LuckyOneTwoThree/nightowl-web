#!/usr/bin/env node
/**
 * 手机端「数据管道」差异校验
 *
 * 背景：`mobile/src/data/sync/*` 与 `mobile/src/data/{live,highlights,scraper}.js`
 * 是桌面端 `server/*` 的**手抄分支**，有合理差异（无 curl 兜底、含 quickSyncTargets、
 * 用 AsyncStorage 而非磁盘缓存等），但它们**不在 `verify:shared` 的覆盖范围内** ——
 * verify:shared 的绿灯只代表 `src/core`、`src/data`、6 个 JSON、tz 没漂移，
 * 容易被误读成「整条数据管道一致」。
 *
 * 本脚本解决的是「差异不可见」这一点，而不是强行要求两端逐字节相同：
 *   · 记录每一对文件当前的内容哈希（manifest）；
 *   · 任一侧改动 → 校验失败，提示你重新审视两端是否仍等价；
 *   · 确认等价后运行 `npm run sync:pipeline -- --write` 更新哈希。
 * 同时每次都打印两端行数差，让「这对手抄分支已经差多少」一眼可见。
 *
 * 用法：
 *   node scripts/verify-pipeline.mjs            # 校验（默认，CI / 提交前）
 *   node scripts/verify-pipeline.mjs --write    # 更新 manifest（人工确认后）
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptDir, '..');
const repoRoot = resolve(mobileRoot, '..');
const manifestPath = resolve(scriptDir, 'pipeline-manifest.json');

/** 桌面 → 手机的手抄管道对。reason 会被写进 manifest，供人理解「为什么允许不同」。 */
const PAIRS = [
  {
    desktop: 'server/scores.js',
    mobile: 'mobile/src/data/sync/scores.js',
    reason: '手机多 quickSyncTargets（72h 下拉快检）；共享函数应保持同口径'
  },
  {
    desktop: 'server/sources/index.js',
    mobile: 'mobile/src/data/sync/sources.js',
    reason: '端侧取数入口不同（桌面本地服务 / 手机直连 ESPN）'
  },
  {
    desktop: 'server/sources/espn.js',
    mobile: 'mobile/src/data/sync/espn.js',
    reason: 'ESPN 主源适配，两端应保持字段映射一致'
  },
  {
    desktop: 'server/sources/openfootball.js',
    mobile: 'mobile/src/data/sync/openfootball.js',
    reason: '副源适配；手机版传 retries'
  },
  {
    desktop: 'server/sources/normalize.js',
    mobile: 'mobile/src/data/sync/normalize.js',
    reason: '桌面有 curl 兜底与事故背景注释，手机精简'
  },
  {
    desktop: 'server/live.js',
    mobile: 'mobile/src/data/live.js',
    reason: '实时比分解析；缓存介质不同（内存 / AsyncStorage）'
  },
  {
    desktop: 'server/highlights.js',
    mobile: 'mobile/src/data/highlights.js',
    reason: '集锦解析；磁盘缓存 vs AsyncStorage，URL 校验实现不同'
  },
  {
    desktop: 'server/scraper.js',
    mobile: 'mobile/src/data/scraper.js',
    reason: '直播源抓取；手机不内置签名频道（TV_SPORTS_CHANNELS=[]）'
  }
];

const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const lineCount = async file => (await readFile(file, 'utf8')).split('\n').length;

async function currentPair(pair) {
  const desktopPath = resolve(repoRoot, pair.desktop);
  const mobilePath = resolve(repoRoot, pair.mobile);
  const missing = [];
  if (!existsSync(desktopPath)) missing.push(pair.desktop);
  if (!existsSync(mobilePath)) missing.push(pair.mobile);
  if (missing.length) return { pair, missing };
  const [desktopSha, mobileSha, desktopLines, mobileLines] = await Promise.all([
    sha256(desktopPath),
    sha256(mobilePath),
    lineCount(desktopPath),
    lineCount(mobilePath)
  ]);
  return { pair, desktopSha, mobileSha, desktopLines, mobileLines };
}

function fmtDelta(d, m) {
  const delta = m - d;
  const sign = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
  return `${d} / ${m} (${sign})`;
}

async function main() {
  const write = process.argv.includes('--write');
  const results = [];
  for (const pair of PAIRS) results.push(await currentPair(pair));

  const missing = results.filter(r => r.missing);
  if (missing.length) {
    for (const r of missing) console.error(`✗ 缺少文件：${r.missing.join('、')}`);
    process.exit(1);
  }

  const entries = results.map(r => ({
    desktop: r.pair.desktop,
    mobile: r.pair.mobile,
    reason: r.pair.reason,
    desktopSha: r.desktopSha,
    mobileSha: r.mobileSha,
    desktopLines: r.desktopLines,
    mobileLines: r.mobileLines
  }));

  if (write) {
    const manifest = {
      _readme:
        '手机端数据管道是桌面端的手抄分支（存在有意差异）。本清单让差异可见：任一侧改动都会让 verify:pipeline 失败；确认两端仍等价后运行 npm run sync:pipeline -- --write 更新哈希。',
      generatedAt: new Date().toISOString(),
      pairs: entries
    };
    await (await import('node:fs/promises')).writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8'
    );
    console.log(`✓ 已更新 pipeline manifest（${entries.length} 对）→ scripts/pipeline-manifest.json`);
    for (const e of entries) {
      console.log(`  · ${e.mobile.replace('mobile/', '')}  ${fmtDelta(e.desktopLines, e.mobileLines)}`);
    }
    return;
  }

  if (!existsSync(manifestPath)) {
    console.error(
      '✗ 未找到 scripts/pipeline-manifest.json。\n' +
        '  首次使用请人工核对两端等价后运行：npm run sync:pipeline -- --write'
    );
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const byKey = new Map((manifest.pairs || []).map(p => [`${p.desktop}::${p.mobile}`, p]));

  const problems = [];
  console.log('手机数据管道差异（desktop 行数 / mobile 行数）：');
  for (const e of entries) {
    const prev = byKey.get(`${e.desktop}::${e.mobile}`);
    const changed = [];
    if (!prev) {
      problems.push(`${e.mobile}：manifest 缺少该对（新增文件？请运行 sync:pipeline -- --write）`);
      changed.push('NEW');
    } else {
      if (prev.desktopSha !== e.desktopSha) changed.push('desktop 已变');
      if (prev.mobileSha !== e.mobileSha) changed.push('mobile 已变');
      if (changed.length) {
        problems.push(`${e.mobile}：${changed.join(' / ')}，需复核两端是否仍等价`);
      }
    }
    const mark = changed.length ? '✗' : '✓';
    console.log(`  ${mark} ${e.mobile.replace('mobile/', '').padEnd(34)} ${fmtDelta(e.desktopLines, e.mobileLines)}`);
  }

  if (problems.length) {
    console.error('\n发现管道漂移：');
    for (const p of problems) console.error(`  • ${p}`);
    console.error('\n如果差异是有意的且两端仍等价，运行：npm run sync:pipeline -- --write');
    process.exit(1);
  }

  console.log('\n✓ 管道差异清单一致（未发现未登记的改动）');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
