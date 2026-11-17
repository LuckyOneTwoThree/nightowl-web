export type ScheduledLike = {
  identifier: string;
  content: { data?: Record<string, unknown> };
};

/**
 * 手动提醒重排的纯决策（从 reminders.ts 抽出，供离线测试）：
 * 同开球的 prematch 必须取消并以 manual 重排——否则用户关闭自动提醒开关时，
 * 这场显式设置的提醒会随 prematch 一起被静默取消。
 */
export function planManualReminder(
  existing: ScheduledLike[],
  matchId: string,
  kickoff: string
): { cancelIds: string[]; alreadyUpToDate: boolean } {
  const cancelIds: string[] = [];
  let alreadyUpToDate = false;
  for (const item of existing) {
    const data = item.content.data || {};
    if (data.matchId === matchId && (data.kind === 'prematch' || data.kind === 'manual')) {
      if (data.kickoff === kickoff && data.kind === 'manual') {
        alreadyUpToDate = true;
      } else {
        cancelIds.push(item.identifier);
      }
    }
  }
  return { cancelIds, alreadyUpToDate };
}