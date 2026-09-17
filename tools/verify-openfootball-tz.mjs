/**
 * 交叉验证 openfootball 时区换算的正确性
 *
 * 方法：同一轮比赛，ESPN 的开球时间（已换算为北京墙钟、可信）作为基准，
 * 与 openfootball 经 tz.mjs 换算后的北京墙钟比对。两者应当一致。
 *
 * 若换算有误（如夏令时差 1 小时），这里会逐场列出偏差。
 *
 * 用法：node tools/verify-openfootball-tz.mjs [联赛码]
 *      默认全部五个联赛
 */
import * as espn from '../server/sources/espn.js';
import * as openfootball from '../server/sources/openfootball.js';
import { mergeEvents } from '../server/sources/index.js';
import { localToBeijingWall, isEuroDST } from '../server/sources/tz.mjs';

const LEAGUES_TO_TEST = process.argv[2] ? [process.argv[2]] : ['PL', 'PD', 'SA', 'BL', 'FL'];

function bench(label, fn) {
  const t0 = Date.now();
  const r = fn();
  return { r, ms: Date.now() - t0 };
}

async function main() {
  let totalMatched = 0;
  let totalMismatched = 0;
  let totalOnlyOne = 0;
  const mismatches = [];

  for (const league of LEAGUES_TO_TEST) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`联赛 ${league}`);
    console.log('═'.repeat(60));

    // 拉两个源（openfootball 整季；ESPN 取本月几天做样本即可）
    const ofEvents = await openfootball.fetchLeague(league, '2026-27', {}).catch(e => {
      console.log(`  openfootball 拉取失败: ${e.message}`);
      return [];
    });
    if (!ofEvents.length) {
      console.log('  openfootball 无事件，跳过');
      continue;
    }

    // 用 openfootball 出现的日期集合，抽样请 ESPN（控制请求数）
    const dates = new Set();
    for (const e of ofEvents) {
      if (e.kickoff) dates.add(e.kickoff.split('T')[0]);
    }
    const sampleDates = [...dates].sort().slice(0, 12);
    const espnEvents = [];
    for (const d of sampleDates) {
      const evs = await espn.fetchLeague(league, d.replace(/-/g, ''), {}).catch(() => []);
      espnEvents.push(...evs);
      await new Promise(r => setTimeout(r, 250)); // 与生产同步一致，避免打爆上游
    }

    // 双源按 (联赛, 主队, 客队) 配对
    const byKey = new Map();
    for (const e of [...ofEvents, ...espnEvents]) {
      const k = `${e.league}|${e.homeId}|${e.awayId}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }

    let matched = 0, mismatched = 0, onlyOne = 0;

    for (const [k, list] of byKey) {
      const ofEv = list.find(e => e.source === 'openfootball');
      const espnEv = list.find(e => e.source === 'espn');
      if (!ofEv || !espnEv) { onlyOne++; continue; }

      const ofTime = ofEv.kickoff; // 已用 tz.mjs 换算（见下文 openfootball.js 改造）
      const espnTime = espnEv.kickoff;
      if (!ofTime || !espnTime) continue;

      if (ofTime === espnTime) {
        matched++;
      } else {
        mismatched++;
        if (mismatches.length < 15) {
          mismatches.push({ league, k, ofTime, espnTime });
        }
      }
    }

    totalMatched += matched;
    totalMismatched += mismatched;
    totalOnlyOne += onlyOne;

    console.log(`  双源均有: ${matched + mismatched} 场, 时间一致 ${matched}, 不一致 ${mismatched}`);
    console.log(`  仅单源覆盖: ${onlyOne} 场（其中多数是 ESPN 未抽样的日期）`);
    if (mismatched) {
      console.log(`  ⚠️ 存在 ${mismatched} 场时间不一致 —— 见下方明细`);
    } else if (matched > 0) {
      console.log(`  ✓ 抽样场次时间全部一致，时区换算正确`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`汇总：一致 ${totalMatched} · 不一致 ${totalMismatched} · 仅单源 ${totalOnlyOne}`);
  if (mismatches.length) {
    console.log('\n不一致明细（前 15 条）：');
    for (const m of mismatches) {
      console.log(`  ${m.league} ${m.k}  openfootball=${m.ofTime}  espn=${m.espnTime}`);
    }
  }
  console.log('\n结论：若「不一致」为 0，则 tz.mjs 的换算与 ESPN 完全对齐，可安全设为可信时间源。');
}

main().catch(err => {
  console.error('验证失败:', err.message);
  process.exit(1);
});
