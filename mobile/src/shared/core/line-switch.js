/**
 * 直播断流自动换线（纯函数）
 *
 * 只处理“下一条直链是谁”和“还允许自动尝试几次”；
 * 真正的起播、时间轴保留、提示由 PlayerStage 负责。
 */

/** 下一条可直链；当前线路不在直链列表时从第一条开始 */
export function nextDirectLine(lines, activeId) {
  const direct = (lines || []).filter(l => l.isDirect && l.url);
  if (!direct.length) return null;
  const idx = direct.findIndex(l => l.id === activeId);
  if (idx < 0) return direct[0];
  if (direct.length < 2) return null;
  return direct[(idx + 1) % direct.length];
}

/**
 * @returns {{switch:boolean, line?:object, reason?:string}}
 */
export function autoSwitchDecision({ lines, activeId, attempts = 0, maxAttempts = 2 }) {
  if (attempts >= maxAttempts) return { switch: false, reason: 'exhausted' };
  const line = nextDirectLine(lines, activeId);
  if (!line) return { switch: false, reason: 'no-alternative' };
  if (line.id === activeId) return { switch: false, reason: 'same-line' };
  return { switch: true, line, reason: 'next-line' };
}
