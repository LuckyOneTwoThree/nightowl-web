/**
 * 止损状态机 · 桌面 / 手机共用
 *
 * 不负责存储，只回答「这一夜现在是否该提示」以及状态如何迁移。
 * 状态按夜晚保存：同一晚最多提示一次；允许推迟一次（15 分钟后再次提示）；
 * 「继续看」= 已看，当晚不再提示。
 */

import { owlDay } from './engine.js';
import { stopLossAt } from './sleep.js';

export const STOP_LOSS_SNOOZE_MS = 15 * 60 * 1000;
export const STOP_LOSS_MAX_SNOOZE = 1;

export const STOP_LOSS_STATUS = Object.freeze({
  IDLE: 'idle',
  PROMPTED: 'prompted',
  SNOOZED: 'snoozed',
  IGNORED: 'ignored',
  SLEPT: 'slept'
});

export function normalizeStopLossState(state) {
  if (!state || typeof state !== 'object') {
    return { status: STOP_LOSS_STATUS.IDLE, snoozeUntil: 0, snoozeCount: 0 };
  }
  const status = Object.values(STOP_LOSS_STATUS).includes(state.status)
    ? state.status
    : STOP_LOSS_STATUS.IDLE;
  return {
    status,
    snoozeUntil: Number.isFinite(state.snoozeUntil) ? state.snoozeUntil : 0,
    snoozeCount: Number.isFinite(state.snoozeCount) ? Math.max(0, state.snoozeCount) : 0
  };
}

export function stopLossNightKey(match) {
  if (!match || typeof match.t !== 'string' || !match.t.includes('T')) return null;
  return owlDay(match.t);
}

/**
 * @returns {null | {night:string, ledger:object, state:object}}
 */
export function shouldStopLossPrompt(match, profile, now = Date.now(), state = null) {
  const night = stopLossNightKey(match);
  if (!night || match.st === 'done' || match.tbd) return null;

  const ledger = stopLossAt(match.t, profile);
  if (!ledger?.ready || !ledger.profile?.enabled) return null;
  if (now < ledger.stopAt || now > ledger.endTs) return null;

  const st = normalizeStopLossState(state);
  if (
    st.status === STOP_LOSS_STATUS.IGNORED ||
    st.status === STOP_LOSS_STATUS.SLEPT ||
    st.status === STOP_LOSS_STATUS.PROMPTED
  ) {
    return null;
  }
  if (st.status === STOP_LOSS_STATUS.SNOOZED) {
    if (st.snoozeCount > STOP_LOSS_MAX_SNOOZE) return null;
    if (now < st.snoozeUntil) return null;
  }

  return { night, ledger, state: st };
}

export function markStopLossPrompted(state) {
  return { ...normalizeStopLossState(state), status: STOP_LOSS_STATUS.PROMPTED };
}

export function snoozeStopLoss(state, now = Date.now()) {
  const st = normalizeStopLossState(state);
  return {
    status: STOP_LOSS_STATUS.SNOOZED,
    snoozeUntil: now + STOP_LOSS_SNOOZE_MS,
    snoozeCount: st.snoozeCount + 1
  };
}

export function ignoreStopLoss(state) {
  return { ...normalizeStopLossState(state), status: STOP_LOSS_STATUS.IGNORED };
}

export function sleepStopLoss(state) {
  return { ...normalizeStopLossState(state), status: STOP_LOSS_STATUS.SLEPT };
}
