/**
 * 验证 tbd 查询日期展开的覆盖效果（联网）
 *
 * 方法：把时钟快进到某个 tbd 轮占位日的前 1 天，比较展开前后
 * activeSyncTargets 生成的查询日期，以及 ESPN 在这些日期上能否
 * 覆盖该轮的全部场次。
 *
 * 用法：node tools/verify-tbd-expand.mjs
 */
import { activeSyncTargets } from '../server/scores.js';
import * as espn from '../server/sources/espn.js';
import { ts } from '../src/core/engine.js';
import fixtures from '../src/data/fixtures.json' with { type: 'json' };

const DAY = 86400000;

async function main() {
  // 取一个完整的 tbd 轮：BL 第 5 轮（占位 2026-10-11T02:00）
  const round = fixtures.filter(m => m.l === 'BL' && m.r === 5);
  console.log(`BL 第 5 轮：${round.length} 场，占位时间 ${round[0].t}（整轮共用）\n`);

  // 快进时钟到占位日的前 1 天（模拟该轮进入 48h 同步窗口）
  const [y, m, d] = round[0].t.split('T')[0].split('-').map(Number);
  const simNow = Date.UTC(y, m - 1, d - 1, 12, 0) - 8 * 3600000;

  // 展开前（模拟旧逻辑：只加占位日）
  const flat = new Set();
  for (const m2 of round) {
    const t = ts(m2.t);
    const dd = new Date(t);
    const pad = n => String(n).padStart(2, '0');
    flat.add(`${dd.getUTCFullYear()}${pad(dd.getUTCMonth() + 1)}${pad(dd.getUTCDate())}`);
  }
  console.log(`旧逻辑查询日期（${flat.size} 个）: ${[...flat].join(', ')}`);

  // 展开后
  const expanded = activeSyncTargets(fixtures, simNow).get('BL') || new Set();
  console.log(`展开后查询日期（${expanded.size} 个）: ${[...expanded].sort().join(', ')}\n`);

  // 逐日期拉 ESPN，看能否覆盖该轮 9 场
  const ids = new Set(round.map(m2 => `${m2.h}-${m2.a}`));
  const found = new Set();
  for (const date of [...expanded].sort()) {
    const evs = await espn.fetchLeague('BL', date, {}).catch(e => {
      console.log(`  ${date} 拉取失败: ${e.message}`);
      return [];
    });
    for (const e of evs) {
      const key = `${e.homeId}-${e.awayId}`;
      if (ids.has(key)) found.add(key);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n该轮 ${round.length} 场，ESPN 命中 ${found.size} 场`);
  const missing = [...ids].filter(k => !found.has(k));
  if (missing.length) {
    console.log(`⚠️ 仍未命中: ${missing.join(', ')}`);
  } else {
    console.log('✓ 全部命中 —— 展开后该 tbd 轮被完整覆盖');
  }
}

main().catch(err => {
  console.error('验证失败:', err.message);
  process.exit(1);
});
