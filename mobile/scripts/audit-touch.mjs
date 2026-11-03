#!/usr/bin/env node
/**
 * 触控目标审计 —— 移动端所有 Pressable 的可点高度必须 ≥ 44dp。
 *
 * 为什么要脚本而不是靠看：44dp 不是在 Pressable 上写一个数字就成立，它取决于
 * 样式数组叠加后的实际高度、文字行高、padding、以及 hitSlop 补了多少。肉眼过一遍
 * 30 个文件、90 多个 Pressable 必然会漏，而且改一次样式就可能把某个按钮打回 28dp。
 *
 * 判定方式：
 *   1. 从同文件的 StyleSheet.create 里按样式名取回样式块（支持单行与多行写法）；
 *   2. 把数组里的样式叠加（高度取最大，paddingVertical 取最大）；
 *   3. 把 hitSlop 的上下外扩加上去（数字 / {top,bottom} / {vertical} 三种写法）；
 *   4. 结果 < 44 判失败。
 *
 * 两种情况会算不出高度，都不静默放过：
 *   · 高度写在子 View 上（Pressable 只是包一层）；
 *   · 高度来自布局（flex、卡片内容撑开、全屏遮罩）。
 * 这些必须进 UNRESOLVED，写清为什么它是达标的。新出现一条算不出高度的
 * 控件而不进表，脚本一样失败 —— 否则这个门禁会慢慢变成假绿。
 */

import fs from 'node:fs';
import path from 'node:path';

const MIN_SIZE = 44;
const ROOT = 'src';

/**
 * 算不出高度、或算出来没有意义、但人工确认达标的控件。
 *
 * 键是 `相对路径 :: 触发处的样式名`，值写清楚为什么够 44dp。
 * 这里的条目一律不参与失败判定；但如果某条目在所有 Pressable 里都找不到了，
 * 脚本会提示删掉 —— 免得表越攒越长、最后盖住真问题。
 */
const WAIVERS = {
  'src/app/(tabs)/index.tsx :: prompt,pressed': '关注球队引导卡：padding 12 + 两行文字，实测约 54dp',
  'src/app/(tabs)/index.tsx :: replayCard,pressed': '补看卡：padding 12 + 三行内容，高由内容撑开',
  'src/app/(tabs)/index.tsx :: pressed': 'Hero 卡与焦点战卡整块可点，内容远超 44dp',
  'src/app/team/[id].tsx :: pressed': '精选比赛卡片整块可点，内容远超 44dp',
  'src/ui/Chip.tsx :: pressed': '高度在内容 View 的 base 上（32dp），Pressable 另有 hitSlop 6 → 44dp',
  'src/ui/DecisionStrip.tsx :: cell,pressed': '两行文字约 27dp，hitSlop 上下各 12 → 51dp；相邻格子不接手势，重叠不抢点击',
  'src/ui/Sheet.tsx :: -': '遮罩层，全屏可点',
};

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith('.tsx')) files.push(full);
  }
})(ROOT);

/** 取同文件 StyleSheet.create 里的样式块，按顶层 key 切开 */
function styleBlocks(src) {
  const at = src.indexOf('StyleSheet.create(');
  if (at < 0) return {};
  let i = src.indexOf('(', at);
  let depth = 0;
  let end = i;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(at + 'StyleSheet.create('.length, end);
  const out = {};
  let j = 0;
  while (j < body.length) {
    const km = /(^|\n)\s{2}([A-Za-z0-9_]+):\s*\{/.exec(body.slice(j));
    if (!km) break;
    const braceStart = j + km.index + km[0].length - 1;
    let d = 0;
    let k = braceStart;
    for (; k < body.length; k++) {
      if (body[k] === '{') d++;
      else if (body[k] === '}') {
        d--;
        if (d === 0) break;
      }
    }
    out[km[2]] = body.slice(braceStart, k + 1);
    j = k + 1;
  }
  return out;
}

/** 文件里 `const X = 34;` 这类数字常量，样式里用到时替换掉 */
function numberConsts(src) {
  const out = {};
  for (const m of src.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*([0-9.]+)\s*;/gm)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

function expandConsts(block, consts) {
  let out = block;
  for (const [name, value] of Object.entries(consts)) {
    out = out.replace(new RegExp(`:\\s*${name}(?=[,\\s}])`, 'g'), `: ${value}`);
  }
  return out;
}

/**
 * 样式里写的是 `fontSize.xs`、`spacing.sm + 2` 这种 token 与算式，不是字面量。
 * 直接把 theme.ts 里的数值读出来替换，避免这里再抄一份会漂移的表。
 */
const THEME = (() => {
  const file = 'src/ui/theme.ts';
  const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const pick = name => {
    const m = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(src);
    const out = {};
    if (!m) return out;
    for (const kv of m[1].matchAll(/([A-Za-z0-9_]+):\s*([0-9.]+)/g)) out[kv[1]] = Number(kv[2]);
    return out;
  };
  return { fontSize: pick('fontSize'), spacing: pick('spacing') };
})();

function expandTokens(text) {
  let out = text;
  for (const [k, v] of Object.entries(THEME.fontSize)) {
    out = out.replace(new RegExp(`fontSize\\.${k}(?![A-Za-z0-9_])`, 'g'), String(v));
  }
  for (const [k, v] of Object.entries(THEME.spacing)) {
    out = out.replace(new RegExp(`spacing\\.${k}(?![A-Za-z0-9_])`, 'g'), String(v));
  }
  return out;
}

/** 取某个属性的数值；支持 token 与简单算式，取不到返回 null */
function px(block, prop) {
  const m = new RegExp(`(?:^|[\\s{])${prop}:\\s*([^,}\\n]+)`).exec(block);
  if (!m) return null;
  const raw = expandTokens(m[1]).trim();
  if (!/^[0-9.+\-*/\s()]+$/.test(raw)) return null;
  const value = Function(`return (${raw})`)();
  return Number.isFinite(value) ? value : null;
}

const maxOf = (a, b) => (a === null ? b : b === null ? a : Math.max(a, b));

/** 打开标签：从 `<Name` 扫到深度 0 的 `>` */
function openTags(src, name) {
  const list = [];
  let i = 0;
  while ((i = src.indexOf('<' + name, i)) >= 0) {
    let j = i + name.length + 1;
    let depth = 0;
    let end = -1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) break;
    list.push({ start: i, text: src.slice(i, end + 1) });
    i = end + 1;
  }
  return list;
}

function slopVertical(text) {
  const num = /hitSlop=\{([0-9]+)\}/.exec(text);
  if (num) return Number(num[1]) * 2;
  const obj = /hitSlop=\{\{([^}]*)\}\}/.exec(text);
  if (!obj) return 0;
  const body = obj[1];
  const top = /top:\s*([0-9]+)/.exec(body);
  const bottom = /bottom:\s*([0-9]+)/.exec(body);
  const vertical = /vertical:\s*([0-9]+)/.exec(body);
  if (top || bottom) return Number(top ? top[1] : 0) + Number(bottom ? bottom[1] : 0);
  if (vertical) return Number(vertical[1]) * 2;
  return 0;
}

const rows = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const blocks = styleBlocks(src);
  const consts = numberConsts(src);
  for (const tag of openTags(src, 'Pressable')) {
    const line = src.slice(0, tag.start).split('\n').length;
    const names = [...tag.text.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map(m => m[1]);
    let height = null;
    let minHeight = null;
    let padV = 0;
    for (const name of names) {
      if (!blocks[name]) continue;
      const block = expandConsts(blocks[name], consts);
      height = maxOf(height, px(block, 'height'));
      minHeight = maxOf(minHeight, px(block, 'minHeight'));
      padV = Math.max(padV, px(block, 'paddingVertical') ?? 0);
    }

    // 高度没写在外层时，退一步估：内容（文字行高 / 图标 / 内层固定高度）+ 上下 padding
    let inner = 0;
    if (height === null && minHeight === null) {
      const close = src.indexOf('</Pressable>', tag.start + tag.text.length);
      const body = close < 0 ? '' : src.slice(tag.start + tag.text.length, close);
      const lines = [];
      let box = 0;
      for (const m of body.matchAll(/styles\.([A-Za-z0-9_]+)/g)) {
        const block = blocks[m[1]];
        if (!block) continue;
        const expanded = expandConsts(block, consts);
        box = Math.max(box, px(expanded, 'height') ?? 0, px(expanded, 'minHeight') ?? 0);
        const lineHeight = px(expanded, 'lineHeight');
        const size = px(expanded, 'fontSize');
        if (lineHeight !== null) lines.push(lineHeight);
        else if (size !== null) lines.push(size * 1.2);
      }
      for (const m of body.matchAll(/fontSize:\s*([0-9.]+)/g)) lines.push(Number(m[1]) * 1.2);
      for (const m of body.matchAll(/lineHeight:\s*([0-9.]+)/g)) lines.push(Number(m[1]));
      for (const m of body.matchAll(/size=\{([0-9.]+)\}/g)) box = Math.max(box, Number(m[1]));
      // 多行文字竖排时高度是累加的；有内层 View 时不敢累加（可能是并排），只取最大
      const stacked = (body.match(/<Text/g) || []).length >= 2 && !/<View/.test(body);
      const textH = lines.length ? (stacked ? lines.reduce((a, b) => a + b, 0) : Math.max(...lines)) : 0;
      inner = Math.max(box, textH);
    }

    const slop = slopVertical(tag.text);
    const base = height !== null ? height + padV * 2 : (minHeight ?? (inner ? inner + padV * 2 : null));
    rows.push({
      file,
      line,
      key: `${file} :: ${names.length ? names.join(',') : '-'}`,
      size: base === null ? null : base + slop,
      slop,
    });
  }
}

const failures = [];
const unknown = [];
let waived = 0;
for (const row of rows) {
  if (row.key in WAIVERS) {
    waived += 1;
    continue;
  }
  if (row.size === null) {
    unknown.push(row);
    continue;
  }
  if (row.size < MIN_SIZE) failures.push(row);
}

const stale = Object.keys(WAIVERS).filter(key => !rows.some(row => row.key === key));

console.log(
  `Pressable ${rows.length} 个 · 门槛 ${MIN_SIZE}dp · 豁免 ${waived} 个（每个都写了理由）`
);

if (failures.length) {
  console.log('\n✗ 可点区域不足 44dp：');
  for (const f of failures) console.log(`  ${f.file}:${f.line}  ${f.size}dp（其中 hitSlop ${f.slop}）`);
}
if (unknown.length) {
  console.log('\n✗ 算不出高度，需要人工确认后写进 WAIVERS：');
  for (const u of unknown) console.log(`  ${u.file}:${u.line}  ${u.key}`);
}
if (stale.length) {
  console.log('\n⚠ WAIVERS 里有已经对不上的条目，请删掉：');
  for (const key of stale) console.log(`  ${key}`);
}

const failed = failures.length + unknown.length + stale.length;
if (failed) {
  console.log(`\n✗ 触控审计未通过（${failed} 项）`);
  process.exit(1);
}
console.log('✓ 触控目标全部达标');
