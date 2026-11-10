/**
 * L1 推荐池生成器（C9：解决「L1 断粮」）
 *
 * 背景：`recommendations.json` 里 31 条全是 8–9 月的人工精修，**未来命中 0**。
 * 结果是 Hero 只要不靠德比/六强就必然是 L3「看点有限」，
 * 未来 55 个 Hero 夜里有 30 夜 star ≤ 1、20 夜 index < 5。
 *
 * 这个脚本只做一件事：**把「值得当成焦点」的场次按时补齐**，让 L1 不再断粮。
 * 它刻意不追求「给所有比赛都编一条推荐」——那是给排名注水的另一种写法。
 *
 * 三条产品纪律：
 *   1. **只用有源头的事实**：德比名、故事线、关键节点、联赛轮次、睡眠档位。
 *      不生成 `trivia`（那是人工的点睛，规则写不出来就别写），不写 xG/控球/阵型等无源字段。
 *   2. **保持稀缺**：每个自然周最多 `WEEKLY_CAP` 条（README 说的「每周 1–2 条」就是这个意思）。
 *      全季 451 场可行动，如果全都塞进 L1，L1/L2 的分层就没了意义。
 *   3. **人工优先**：手工条目（没有 `src` 或 `src: 'manual'`）永远不会被覆盖；
 *      本脚本只接管 `src: 'generated'` 的条目，且每次运行整体重建这一部分。
 *
 * 用法：
 *   node tools/build-recommendations.mjs              # 预演（打印将写入的条目）
 *   node tools/build-recommendations.mjs --apply      # 写回 src/data/recommendations.json
 *   node tools/build-recommendations.mjs --now=2026-11-05T12:00   # 固定时钟（测试/复现）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getFixtures, REC_MAP, rivalries, storylines, leagueName } from '../src/data/index.js';
import { isActionable } from '../src/core/actionable.js';
import * as E from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REC_PATH = resolve(ROOT, 'src/data/recommendations.json');
const MOBILE_REC_PATH = resolve(ROOT, 'mobile/src/shared/data/recommendations.json');

/** 每个自然周最多生成几条（稀缺性是 L1 的定义，不是可调参数） */
export const WEEKLY_CAP = 2;
/** 只补未来这么多周：再远的时间多半还是 tbd，写了也会被重排打乱 */
export const HORIZON_WEEKS = 6;
/** 每条最多几行正文（Hero 卡片放得下，再多就成小作文） */
const MAX_POINTS = 3;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const nowArg = argv.find(a => a.startsWith('--now='));
const NOW = nowArg ? E.ts(nowArg.split('=')[1]) : Date.now();

/** 星级「底座」：不带 recMap，避免用推荐去证明推荐（自证循环） */
function baseEval(match) {
  return E.evaluate(match, {}, rivalries, storylines, [], []);
}

/**
 * 焦点排序分。纯规则、可解释，不做隐式加权：
 * 关键节点 > 宿敌德比 > 六强内战 > 有故事线 > 其它（后者根本不入池）
 */
export function focusScore(match, ev) {
  if (ev.keyNode) return 5;
  if (ev.rivalry) return 4;
  if (E.isBigSixClash(match)) return 3;
  if (ev.storyIds.length) return 2;
  return 0;
}

/** 北京时间自然周（周一为界）——与周视图同一口径，避免周日 23:00 的场次被算进下一周 */
function weekKeyOf(match) {
  return E.mondayOfWall(E.owlDay(match.t));
}

/**
 * 造一条 L1 条目。
 *
 * ⚠️ 每一行都必须能指回一个数据字段；写不出就不写。
 */
export function buildEntry(match, ev) {
  const bigSix = E.isBigSixClash(match);
  const stories = (storylines || []).filter(
    s => s.status !== 'draft' && (s.nodes || []).indexOf(match.id) >= 0
  );
  const keyStory = stories.find(s => (s.keyNodes || []).indexOf(match.id) >= 0) || null;
  const tier = E.tierOf(match);

  const points = [];
  if (keyStory) points.push(`${keyStory.name}关键节点`);
  if (ev.rivalry) points.push(ev.rivalry);
  else if (bigSix) points.push(`${leagueName(match.l)}六强内战`);
  for (const s of stories) {
    if (keyStory && s.id === keyStory.id) continue;
    points.push(s.name);
  }
  points.push(`${leagueName(match.l)} 第 ${match.r} 轮`);
  if (points.length < MAX_POINTS) points.push(`${tier.label} ${tier.zh}档 · 睡眠成本 ${tier.cost}h`);

  // 去重后截断（同一故事线名可能在两条规则里都出现）
  const uniq = [...new Set(points)].slice(0, MAX_POINTS);

  return {
    m: match.id,
    star: Math.min(3, Math.max(2, ev.star)),
    story: ev.storyIds.slice(),
    points: uniq,
    // 人工点睛留白：规则写不出「考文垂上次踢顶级联赛时英超还没有 VAR」这种句子
    trivia: null,
    replay: false,
    avoid: false,
    upset: false,
    src: 'generated',
    genAt: new Date(NOW).toISOString().slice(0, 10)
  };
}

/**
 * 生成候选池（纯函数，便于测试）。
 * @returns {{ entries: object[], considered: number, skippedTbd: number }}
 */
export function buildPool({ fixtures, now = NOW, weeklyCap = WEEKLY_CAP, horizonWeeks = HORIZON_WEEKS } = {}) {
  const horizonEnd = now + horizonWeeks * 7 * 86400000;
  const byWeek = new Map();
  let considered = 0;
  let skippedTbd = 0;

  for (const m of fixtures || []) {
    if (m.st !== 'sched') continue;
    // tbd 的 t 是整轮占位时间，写进 L1 会让「今晚焦点」指向一个不存在的时刻
    if (m.tbd) {
      skippedTbd++;
      continue;
    }
    const kick = E.ts(m.t);
    if (!Number.isFinite(kick) || kick <= now || kick > horizonEnd) continue;
    if (!isActionable(m, now)) continue;

    const ev = baseEval(m);
    const score = focusScore(m, ev);
    if (score < 2) continue;      // 没有规则依据的普通场次不进 L1（那是 L2/L3 的活）
    considered++;
    const key = weekKeyOf(m);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push({ m, ev, score, kick });
  }

  const entries = [];
  for (const [, list] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => (b.score - a.score) || (a.kick - b.kick));
    for (const item of list.slice(0, weeklyCap)) entries.push(buildEntry(item.m, item.ev));
  }
  entries.sort((a, b) => {
    const ta = E.ts((fixtures || []).find(x => x.id === a.m)?.t || '');
    const tb = E.ts((fixtures || []).find(x => x.id === b.m)?.t || '');
    return ta - tb;
  });
  return { entries, considered, skippedTbd };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixtures = getFixtures();
  const existing = JSON.parse(readFileSync(REC_PATH, 'utf8'));
  const manual = existing.filter(r => r && r.src !== 'generated');
  // 人工条目里可能有已被上游删除的场次：不静默丢，先报出来
  const ids = new Set(fixtures.map(m => m.id));
  const orphans = manual.filter(r => !ids.has(r.m));

  const { entries, considered, skippedTbd } = buildPool({ fixtures, now: NOW });

  console.log(`L1 推荐池生成 · ${new Date(NOW).toISOString().slice(0, 16).replace('T', ' ')}`);
  console.log(`  人工条目保留      ${manual.length}${orphans.length ? `（其中 ${orphans.length} 条已无对应场次）` : ''}`);
  console.log(`  进入候选的场次    ${considered}（关键节点/德比/六强/故事线）`);
  console.log(`  因 tbd 跳过       ${skippedTbd}`);
  console.log(`  生成条目          ${entries.length}（每周上限 ${WEEKLY_CAP}，未来 ${HORIZON_WEEKS} 周）`);
  if (orphans.length) {
    console.log('');
    console.log('⚠️  以下人工条目在 fixtures 里找不到对应场次（保留原样，请人工确认）：');
    orphans.slice(0, 8).forEach(r => console.log(`    ${r.m}`));
  }

  console.log('');
  entries.forEach(e => console.log(`  ${e.m.padEnd(18)} ★${e.star}  ${e.points.join(' / ')}`));

  if (APPLY) {
    const next = [...manual, ...entries];
    const serialized = JSON.stringify(next);
    writeFileSync(REC_PATH, serialized, 'utf8');
    if (existsSync(dirname(MOBILE_REC_PATH))) {
      writeFileSync(MOBILE_REC_PATH, serialized, 'utf8');
    }
    const futureHit = entries.length;
    console.log('');
    console.log(`✅ 已写回 ${REC_PATH.replace(ROOT + '/', '')}（并同步 mobile 共享副本）：人工 ${manual.length} + 生成 ${entries.length} = ${next.length} 条`);
    console.log(`   未来可行动的 L1 条目：${futureHit}（此前 0）`);
  } else {
    console.log('');
    console.log('（预演结束，未写盘。加 --apply 落盘）');
  }

  // 挂在 REC_MAP 上的旧条目是否还在数据里，顺带体检
  const mapOrphans = Object.keys(REC_MAP).filter(id => !ids.has(id));
  if (mapOrphans.length) console.log(`\n⚠️ REC_MAP 有 ${mapOrphans.length} 条指向不存在的场次：${mapOrphans.slice(0, 5).join('、')}`);
}
