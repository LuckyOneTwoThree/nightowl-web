import { mondayOfWall, nightOf } from '../core/engine.js';
import { buildIcs, selectIcsMatches } from '../core/ics.js';

export const ICS_EXPORT_RANGES = [
  { id: 'tonight', label: '今晚场次' },
  { id: 'week', label: '本周精选' },
  { id: 'followed', label: '我关注的球队' }
];

/**
 * 构建并触发浏览器下载 .ics 日历文件（SettingsDrawer 与 MeView 共用）
 */
export function exportMatchesToIcs({
  fixtures,
  range,
  reminderMinutes = 30,
  followedTeams = [],
  weekIds = null,
  nowTs = Date.now()
}) {
  const matches = selectIcsMatches(fixtures, {
    range,
    nowTs,
    weekStartStr: range === 'week' ? mondayOfWall(nightOf(nowTs)) : null,
    followedTeams,
    weekIds: range === 'week' ? weekIds : null
  });
  const ics = buildIcs({ matches, reminderMinutes, now: nowTs });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const label = ICS_EXPORT_RANGES.find(r => r.id === range)?.label || '导出';
  const stamp = new Date(nowTs).toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `夜猫看台-${label}-${stamp}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return matches.length;
}
