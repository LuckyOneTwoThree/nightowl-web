/**
 * 核实 ESPN scoreboard 的 dates= 参数日期口径
 *
 * activeSyncTargets 用 new Date(ts(m.t)).getUTC*() 取日期（ts 已减 8 小时），
 * 凌晨场次会落到北京墙钟的前一天。本脚本拉真实 ESPN 数据，判定哪种口径能命中。
 *
 * 用法：node tools/verify-espn-dates.mjs
 */
import { fetchJSON } from '../server/sources/normalize.js';
import { ts } from '../src/core/engine.js';
import fixtures from '../src/data/fixtures.json' with { type: 'json' };

const pad = n => String(n).padStart(2, '0');

async function fetchEspn(leagueCode, date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard?dates=${date}&limit=300`;
  return fetchJSON(url, { timeoutMs: 20000 });
}

async function main() {
  const now = Date.now();
  const leagueCode = 'eng.1'; // PL

  // 取最近的一场非 tbd PL 比赛（可能是已完赛或即将开球）
  const cand = fixtures
    .filter(m => m.l === 'PL' && !m.tbd)
    .sort((a, b) => Math.abs(ts(a.t) - now) - Math.abs(ts(b.t) - now))[0];

  console.log(`对照场次：${cand.h} vs ${cand.a} · 北京墙钟 ${cand.t}`);

  const t = ts(cand.t);
  const d = new Date(t);
  const shifted = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const wall = cand.t.split('T')[0].replace(/-/g, '');

  console.log(`  activeSyncTargets 口径（ts 减 8h 后取 UTC）: ${shifted}`);
  console.log(`  北京墙钟口径                                  : ${wall}`);
  console.log('');

  for (const [label, date] of [['减8h口径', shifted], ['北京墙钟口径', wall]]) {
    try {
      const j = await fetchEspn(leagueCode, date);
      const events = j.events || [];
      console.log(`【${label}】 dates=${date} → 返回 ${events.length} 场`);
      for (const e of events.slice(0, 4)) {
        console.log(`    ${e.date}  ${e.name}  [${e.status?.type?.state || '?'}]`);
      }
      // 命中判定：返回的事件里有没有我们的对照场次
      // 队名匹配必须大小写不敏感（ESPN 的 "Chelsea" 不含本地码 "CHE"）
      const needle = [cand.h, cand.a].map(s => s.toLowerCase());
      const hit = events.some(e => {
        const n = (e.name || '').toLowerCase();
        return needle.some(x => n.includes(x));
      });
      console.log(`    → 命中对照场次: ${hit ? '是 ✓' : '否'}`);
      console.log('');
    } catch (err) {
      console.log(`【${label}】 dates=${date} → 请求失败: ${err.message}`);
      console.log('');
    }
  }

  // 第二组对照：找一场凌晨 0-6 点的场次（最能暴露日期偏移）
  const late = fixtures
    .filter(m => m.l === 'PL' && !m.tbd)
    .sort((a, b) => {
      const ha = Number(a.t.split('T')[1].split(':')[0]);
      const hb = Number(b.t.split('T')[1].split(':')[0]);
      const da = ha < 6 ? ha + 24 : ha; // 凌晨排最前
      const db = hb < 6 ? hb + 24 : hb;
      return da - db;
    })[0];

  if (late) {
    console.log(`\n凌晨对照场次：${late.h} vs ${late.a} · 北京墙钟 ${late.t}`);
    const lt = ts(late.t);
    const ld = new Date(lt);
    const lshifted = `${ld.getUTCFullYear()}${pad(ld.getUTCMonth() + 1)}${pad(ld.getUTCDate())}`;
    const lwall = late.t.split('T')[0].replace(/-/g, '');
    console.log(`  减8h口径: ${lshifted}  |  北京墙钟口径: ${lwall}`);
    for (const [label, date] of [['减8h口径', lshifted], ['北京墙钟口径', lwall]]) {
      try {
        const j = await fetchEspn(leagueCode, date);
        const events = j.events || [];
        const lneedle = [late.h, late.a].map(s => s.toLowerCase());
        const hit = events.some(e => {
          const n = (e.name || '').toLowerCase();
          return lneedle.some(x => n.includes(x));
        });
        console.log(`【${label}】 dates=${date} → ${events.length} 场, 命中: ${hit ? '是 ✓' : '否'}`);
      } catch (err) {
        console.log(`【${label}】 dates=${date} → 失败: ${err.message}`);
      }
    }
  }
}

main().catch(err => {
  console.error('核实失败:', err.message);
  process.exit(1);
});
