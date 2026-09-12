/**
 * 参考项目数据加载器
 *
 * 为什么需要：本项目的 package.json 声明了 `"type": "module"`，而参考项目的数据文件是
 * CommonJS（`module.exports = [...]`）且位于本项目之外，Node 会按最近的 package.json
 * 推断为 ESM，导致 `require()` 直接抛错。
 *
 * 这里改为「读文本 + 剥壳 + JSON.parse」，不依赖模块系统；同时用 Function 包装执行
 * 原版 CommonJS 引擎，供交叉比对使用。
 *
 * ⚠️ 参考项目目录已在 .gitignore 中排除，换机器需先获取副本。
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 参考项目 miniprogram 根目录 */
export const REF_ROOT = resolve(__dirname, '../../参考项目/nightowl-terrace/miniprogram');

function readText(abs, what) {
  if (!existsSync(abs)) {
    throw new Error(
      `找不到${what}：${abs}\n` +
      `提示：该目录已在 .gitignore 中排除，请先获取参考项目副本到 参考项目/nightowl-terrace/。`
    );
  }
  return readFileSync(abs, 'utf8');
}

/** 读取参考项目的数据层文件（CJS），返回解析后的数组 */
export function loadRefData(file) {
  const abs = resolve(REF_ROOT, 'data', file);
  const body = readText(abs, '参考数据')
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')
    .replace(/^\s*module\.exports\s*=\s*/, '')
    .replace(/;\s*$/, '');
  return JSON.parse(body);
}

/** 载入**原版**引擎（CommonJS），用于交叉比对 */
export function loadOrigEngine() {
  const abs = resolve(REF_ROOT, 'utils/engine.js');
  const src = readText(abs, '原版引擎');
  const mod = { exports: {} };
  // 原版引擎内部有 `typeof getApp === 'function'` 守卫，脱离小程序环境可安全执行
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}
