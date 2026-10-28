/**
 * 把 /api/scores/sync 的响应翻译成用户可读结果。
 *
 * 关键：HTTP 200 不等于写盘成功，也不等于「检查成功」。
 * 服务端会回传 patches / errors / attempted / written，必须区分：
 *   not_needed      没有需要检查的场次
 *   up_to_date      检查完整成功，但没有新比分
 *   updated         检查完整成功，且有补丁写入
 *   partial_failure 有补丁写入，但部分来源失败
 *   failed          没有可用结果（写盘失败 / 全部来源失败）
 *
 * 旧 UI 只看 written.changed，会把「全部来源 offline、无补丁」误报成「已经是最新」；
 * 也会把「部分来源失败」误报成完全成功。
 */
/** 统一的同步结果分类；桌面文案与手机 store 共用，避免两边各写一套。 */
export function classifySyncOutcome({ attempted = true, changed = 0, errors = 0 } = {}) {
  if (!attempted) return 'not_needed';
  if (changed > 0 && errors > 0) return 'partial_failure';
  if (changed > 0) return 'updated';
  if (errors > 0) return 'failed';
  return 'up_to_date';
}

export function summarizeSyncResponse(payload) {
  if (!payload) return { ok: false, status: 'failed', text: '同步响应为空' };
  if (payload.error) return { ok: false, status: 'failed', text: String(payload.error) };

  const summary = payload.summary || {};
  const written = summary.written;
  const errors = Number(summary.errors || 0);
  const patches = Number(summary.patches || 0);
  const changed = Number(written?.changed || 0);

  if (written?.ok === false) {
    const reason = written.reason || '写盘失败';
    const firstIssue = Array.isArray(written.issues) && written.issues.length ? written.issues[0] : null;
    return {
      ok: false,
      status: 'failed',
      text: firstIssue ? `${reason}（${firstIssue}）` : reason
    };
  }

  // 没有任何可尝试的场次：不是「最新」，只是没检查。
  if (summary.attempted === false) {
    return { ok: true, status: 'not_needed', text: '当前没有需要检查的场次' };
  }

  if (errors > 0) {
    if (changed > 0) {
      return {
        ok: false,
        status: 'partial_failure',
        text: `已更新 ${changed} 场，${errors} 个来源失败`
      };
    }
    return {
      ok: false,
      status: 'failed',
      text: `同步失败：${errors} 个来源未返回有效数据`
    };
  }

  // 旧服务端 / dryRun 缺 written：不冒充「最新」，但也不谎报失败。
  if (!written) {
    return {
      ok: true,
      status: patches > 0 ? 'updated' : 'not_needed',
      text: patches > 0 ? `发现 ${patches} 条补丁（预览模式）` : '同步完成（无写入结果）'
    };
  }

  if (changed > 0) {
    return { ok: true, status: 'updated', text: `已更新 ${changed} 场比分` };
  }
  return { ok: true, status: 'up_to_date', text: '已经是最新' };
}
