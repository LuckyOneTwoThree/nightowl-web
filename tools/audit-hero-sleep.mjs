/**
 * 审计：Hero 的「档位视觉」与「睡眠账本结论」是否一致
 *
 * 背景（外部评审 2026-11-05 提出，本脚本用于复算）：
 * computeTonight 只按星级/指数选 Hero，HeroCard 的档位也只看指数；
 * 而「看完会不会低于个人睡眠底线」是 decision-strip 另算的 —— 两套结论同屏时可能打架。
 *
 * 用法：node tools/audit-hero-sleep.mjs [--days=120] [--team=ARS] [--wake=07:30] [--min=7]
 */
import { computeTonight, heroTier } from '../src/core/owl.js';
import { sleepLedger } from '../src/core/sleep.js';
import * as E from '../src/core/engine.js';

const arg = (k, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const DAYS = Number(arg('days', 120));
const TEAM = arg('team', 'ARS');
const WAKE = arg('wake', '07:30');
const MIN = Number(arg('min', 7));

const prefs = {
  followedTeams: TEAM ? [TEAM] : [],
  followedLeagues: ['PL'],
  sleepEnabled: true,
  sleepWakeTime: WAKE,
  sleepMinHours: MIN,
  spoilerFree: false
};
const profile = { enabled: true, wakeTime: WAKE, minSleep: MIN };

const now = Date.now();
const seen = new Set();
let heroNights = 0, below = 0, belowGold = 0, goldOk = 0;
const samples = [];

for (let d = 0; d < DAYS; d++) {
  const night = E.nightOf(now + d * 86400000);
  if (seen.has(night)) continue;
  seen.add(night);
  const at = Date.parse(`${night}T20:00:00+08:00`);
  const t = computeTonight(at, prefs);
  if (!t.hero) continue;
  heroNights++;

  const m = t.hero.m;
  const ledger = sleepLedger(m.t, profile);
  const tier = heroTier(t.hero);
  const isBelow = ledger.valid === true && ledger.ready === true && ledger.belowFloor === true;
  if (isBelow) {
    below++;
    if (tier === 'highlight') {
      belowGold++;
      if (samples.length < 8) {
        samples.push({
          night,
          id: m.id,
          index: +t.hero.index.toFixed(1),
          star: t.hero.ev.star,
          remainH: +(ledger.remainingHours ?? 0).toFixed(2),
          gapH: +(ledger.gapHours ?? 0).toFixed(2)
        });
      }
    }
  } else if (tier === 'highlight') goldOk++;
}

console.log(`窗口 ${DAYS} 天 · 关注 ${TEAM || '（无）'} · 起床 ${WAKE} · 底线 ${MIN}h`);
console.log(`有 Hero 的夜        ${heroNights}`);
console.log(`看完低于底线        ${below}`);
console.log(`其中仍是金色 highlight ${belowGold}  ${belowGold ? '← 首屏会同时出现「今晚焦点」与「可看可不看」' : '✅ 一致'}`);
console.log(`金色且未越线        ${goldOk}`);
if (samples.length) {
  console.log('\n样例（低于底线却给金色档）:');
  samples.forEach(s => console.log(`  ${s.night} ${s.id.padEnd(16)} index=${s.index} ★${s.star} 剩 ${s.remainH}h（差 ${s.gapH}h）`));
}
