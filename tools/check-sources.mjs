/**
 * 观赛源健康检查（SP-2 的落地）
 *
 * 用途：
 *   1. 日常巡检：注册表里的源是否还活着（域名/链接模式会变）
 *   2. 新增源的前置验证：接入前先跑一遍，确认可达与搜索模板可用
 *   3. 代理白名单一致性：watch-sources 的域名与 rules.json 是否同步
 *
 * 运行：node tools/check-sources.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const registry = JSON.parse(readFileSync(resolve(ROOT, 'server/watch-sources.json'), 'utf8'));
const rules = JSON.parse(readFileSync(resolve(ROOT, 'server/rules.json'), 'utf8'));

const PROBE_QUERY = encodeURIComponent('阿森纳');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? `  ${detail}` : ''}`); }
}

async function probe(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // redirect: 'manual' 让 301/302 也算"可达"，但记录重定向目标
    const r = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return { status: r.status, location: r.headers.get('location') || null };
  } catch (err) {
    return { error: err?.cause?.code || err?.message };
  } finally {
    clearTimeout(timer);
  }
}

console.log('观赛源健康检查');
console.log('');

/* ================================================================== */
console.log('一、官方平台（official）');

for (const src of registry.official || []) {
  const home = await probe(src.homeUrl);
  const homeOk = home.status && home.status < 400;
  ok(`${src.name} 首页可达`, !!homeOk, home.error || `HTTP ${home.status}${home.location ? ` → ${home.location}` : ''}`);

  if (homeOk && home.location) {
    console.log(`       ⚠️  ${src.name} 首页发生重定向 → ${home.location}（登记地址可能过期，建议更新）`);
  }

  if (src.searchTemplate) {
    const url = src.searchTemplate.replace('{q}', PROBE_QUERY);
    const s = await probe(url);
    ok(`${src.name} 搜索模板可用`, !!s.status && s.status < 400, s.error || `HTTP ${s.status}`);
  }
}

/* ================================================================== */
console.log('');
console.log('二、聚合导航（watch）');

for (const src of registry.watch || []) {
  const home = await probe(src.homeUrl);
  const homeOk = home.status && home.status < 400;
  ok(`${src.name} 首页可达`, !!homeOk, home.error || `HTTP ${home.status}${home.location ? ` → ${home.location}` : ''}`);
  if (homeOk && home.location) {
    console.log(`       ⚠️  ${src.name} 发生重定向 → ${home.location}（登记地址可能过期，建议更新）`);
  }
}

/* ================================================================== */
console.log('');
console.log('三、代理白名单一致性');

{
  const regHosts = (registry._proxy?.allowedHosts || []);
  const regSuffixes = (registry._proxy?.allowedHostSuffixes || []);
  const ruleHosts = (rules.proxy?.allowedHosts || []);
  const ruleSuffixes = (rules.proxy?.allowedHostSuffixes || []);

  const same =
    regHosts.length === ruleHosts.length && regHosts.every(h => ruleHosts.includes(h)) &&
    regSuffixes.length === ruleSuffixes.length && regSuffixes.every(h => ruleSuffixes.includes(h));
  ok('watch-sources._proxy 与 rules.json 的代理白名单一致', same,
    `watch-sources: [${regHosts.concat(regSuffixes).join(', ')}] vs rules: [${ruleHosts.concat(ruleSuffixes).join(', ')}]`);

  if (!regHosts.length && !regSuffixes.length) {
    console.log('       （两者均为空 = 直链代理当前一律拒绝，属预期：P5 抓取模块接入后再登记）');
  }
}

/* ================================================================== */
console.log('');
console.log('四、登记纪律');

{
  const all = [...(registry.official || []), ...(registry.watch || [])];
  const noVerify = all.filter(s => !s.verifiedAt);
  ok('所有条目都标注了 verifiedAt', noVerify.length === 0, noVerify.map(s => s.id).join(', '));
}

/* ================================================================== */
console.log('');
console.log('─'.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('');
  console.log('失败明细：');
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
