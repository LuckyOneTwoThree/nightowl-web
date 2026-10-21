/**
 * 把 /api/scores/sync 的响应翻译成用户可读结果。
 *
 * 关键：HTTP 200 不等于写盘成功。服务端在写盘失败或校验失败时仍返回 200，
 * 由 summary.written.ok 表达真实结果。UI 只看 changed 会把失败误报成「已经是最新」。
 */
export function summarizeSyncResponse(payload) {
  if (!payload) return { ok: false, text: '同步响应为空' };
  if (payload.error) return { ok: false, text: String(payload.error) };

  const written = payload.summary?.written;
  if (!written) return { ok: true, text: '同步完成' };

  if (written.ok === false) {
    const reason = written.reason || '写盘失败';
    const firstIssue = Array.isArray(written.issues) && written.issues.length ? written.issues[0] : null;
    return { ok: false, text: firstIssue ? `${reason}（${firstIssue}）` : reason };
  }

  const changed = Number(written.changed || 0);
  if (changed > 0) return { ok: true, text: `已更新 ${changed} 场比分` };
  return { ok: true, text: '已经是最新' };
}
