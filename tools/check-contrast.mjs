/**
 * Design token 对比度门禁（WCAG AA 4.5:1）
 *
 * 为什么需要：11px 元信息、S4 徽章与「建议睡觉」Chip 都曾出现
 * 文字与底色对比不足（S4 在 tier-4/12 底上仅 3.2:1）。这些不是审美问题，
 * 而是深夜暗光环境下真实的可读性缺陷。每次改 token 时跑一次。
 *
 * 运行：node tools/check-contrast.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8');

const vars = {};
for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  vars[m[1]] = m[2];
}

const need = name => {
  if (!vars[name]) throw new Error(`缺少 token --${name}`);
  return vars[name];
};

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const a = lum(fg);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** 把 fg 以 alpha 叠到 bg 上，模拟 bg-fg/15 这类 tint 底色 */
function blend(fg, bg, alpha) {
  const f = rgb(fg);
  const b = rgb(bg);
  return '#' + f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

let pass = 0;
let fail = 0;
const failures = [];
function check(label, fg, bg) {
  const ratio = contrast(fg, bg);
  const ok = ratio >= 4.5;
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${label} — ${ratio.toFixed(2)}:1（${fg} on ${bg}）`);
  }
  console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(38)} ${ratio.toFixed(2)}:1`);
}

const card = need('surface-card');
const raised = need('surface-raised');
const press = need('surface-press');
const panel = need('surface-panel');

console.log('Design token 对比度（WCAG AA 4.5:1）');
console.log('');

console.log('一、文本层级');
check('text-primary / card', need('text-primary'), card);
check('text-secondary / card', need('text-secondary'), card);
check('text-muted / card', need('text-muted'), card);
check('text-muted / raised', need('text-muted'), raised);
check('text-muted / press', need('text-muted'), press);
check('text-faint / card', need('text-faint'), card);
check('text-faint / raised', need('text-faint'), raised);
check('text-faint / press', need('text-faint'), press);

console.log('');
console.log('二、品牌与语义色');
check('accent / surface-accent', need('accent'), need('accent-soft'));
check('live / panel', need('live'), panel);
check('danger / card', need('danger'), card);
check('danger / danger-15 card', need('danger'), blend(need('danger'), card, 0.15));
check('danger / danger-15 raised', need('danger'), blend(need('danger'), raised, 0.15));

console.log('');
console.log('三、睡眠档位徽章（tier-N/12 底）');
for (const n of [0, 1, 2, 3, 4]) {
  const fg = need(`tier-${n}`);
  check(`tier-${n} / tier-${n}-12 card`, fg, blend(fg, card, 0.12));
  check(`tier-${n} / tier-${n}-12 raised`, fg, blend(fg, raised, 0.12));
}

console.log('');
console.log('────────────────────────────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败项：');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
