import { useMemo, useRef, useState } from 'react';
import { getFixtures, teamName } from '../data/index.js';
import {
  buildSeasonReport,
  DIARY_STAMPS,
  MODE_META,
  normalizeDiary,
  STAMP_META,
  WATCH_MODES
} from '../core/diary.js';
import { useDialogFocus } from '../hooks/useDialogFocus.js';
import { Button, Chip, Crest, Meta } from './atoms.jsx';
import { IconClose } from './icons.jsx';

function renderPosterCanvas(report, prefs) {
  const width = 880;
  const height = 1120;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 背景渐变（深空夜间）
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0A0D14');
  bg.addColorStop(0.5, '#111826');
  bg.addColorStop(1, '#0A0D14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 顶部装饰金色光晕
  const glow = ctx.createRadialGradient(width - 140, 120, 10, width - 140, 120, 320);
  glow.addColorStop(0, 'rgba(255, 184, 0, 0.22)');
  glow.addColorStop(1, 'rgba(255, 184, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, 460);

  // 外框线
  ctx.strokeStyle = '#232A3B';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, width - 72, height - 72);

  // 抬头
  ctx.fillStyle = '#FFB800';
  ctx.font = '600 18px system-ui, -apple-system, sans-serif';
  ctx.fillText('NIGHT OWL · 熬夜看球赛季账单', 72, 104);

  ctx.fillStyle = '#F3F6FB';
  ctx.font = '700 48px system-ui, -apple-system, sans-serif';
  ctx.fillText(report.persona.title, 72, 174);

  ctx.fillStyle = '#9BA6B8';
  ctx.font = '400 22px system-ui, -apple-system, sans-serif';
  ctx.fillText(report.persona.detail.slice(0, 34), 72, 218);

  // 4 个核心数值卡
  const stats = [
    { label: '累计盖章场次', value: `${report.safeSummary.totalWatched} 场`, color: '#F3F6FB' },
    { label: 'S3/S4 深宵守夜', value: `${report.safeSummary.lateNightCount} 场`, color: '#FFB800' },
    {
      label: '高能名局命中',
      value:
        report.outcomeSummary.worthItRate == null
          ? '待揭晓'
          : `${report.outcomeSummary.worthItCount} 场 (${report.outcomeSummary.worthItRate}%)`,
      color: '#44E2CD'
    },
    { label: '0-0 催眠踩坑', value: `${report.outcomeSummary.dullDrawCount} 场`, color: '#9BA6B8' }
  ];

  stats.forEach((item, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 72 + col * 378;
    const y = 274 + row * 144;
    ctx.fillStyle = '#131722';
    ctx.fillRect(x, y, 358, 120);
    ctx.strokeStyle = '#232A3B';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, 358, 120);

    ctx.fillStyle = '#7E8A9E';
    ctx.font = '500 18px system-ui, -apple-system, sans-serif';
    ctx.fillText(item.label, x + 24, y + 40);

    ctx.fillStyle = item.color;
    ctx.font = '700 34px monospace';
    ctx.fillText(item.value, x + 24, y + 90);
  });

  // 观赛方式 + 印章分布
  ctx.fillStyle = '#F3F6FB';
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('熬夜方式分布', 72, 608);

  const modesText = WATCH_MODES.map(m => `${MODE_META[m].label}: ${report.safeSummary.byMode[m] || 0} 场`).join('   ·   ');
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '400 20px system-ui, -apple-system, sans-serif';
  ctx.fillText(modesText, 72, 648);

  ctx.fillStyle = '#F3F6FB';
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('情绪印章统计', 72, 718);

  DIARY_STAMPS.forEach((s, i) => {
    const meta = STAMP_META[s];
    const x = 72 + i * 186;
    const y = 746;
    ctx.fillStyle = '#131722';
    ctx.fillRect(x, y, 174, 88);
    ctx.strokeStyle = '#232A3B';
    ctx.strokeRect(x, y, 174, 88);
    ctx.fillStyle = '#FFB800';
    ctx.font = '700 26px monospace';
    ctx.fillText(`${meta.glyph} ${report.safeSummary.byStamp[s] || 0}`, x + 18, y + 42);
    ctx.fillStyle = '#9BA6B8';
    ctx.font = '400 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(meta.label, x + 18, y + 70);
  });

  // 主队陪看战绩
  ctx.fillStyle = '#F3F6FB';
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('主队深夜陪看记录', 72, 892);
  if (report.teamRecords.length > 0) {
    report.teamRecords.slice(0, 3).forEach((rec, i) => {
      const y = 934 + i * 36;
      const line = `${teamName(rec.teamId)}：陪看 ${rec.watched} 场` + (rec.decided > 0 ? ` · ${rec.w}胜 ${rec.d}平 ${rec.l}负 (胜率 ${rec.winRate}%)` : ' · 赛果待揭晓');
      ctx.fillStyle = '#44E2CD';
      ctx.font = '500 20px system-ui, -apple-system, sans-serif';
      ctx.fillText(line, 72, y);
    });
  } else {
    ctx.fillStyle = '#7E8A9E';
    ctx.font = '400 19px system-ui, -apple-system, sans-serif';
    ctx.fillText('可在设置选择主队，统计陪看胜率。', 72, 936);
  }

  // 底部署名（仅本地）
  ctx.fillStyle = '#64748B';
  ctx.font = '400 16px monospace';
  const spoilerMark = prefs?.spoilerFree ? '防剧透口径已隔离未揭晓场次' : '全量已记录场次汇总';
  ctx.fillText(`NightOwl Local Report · ${spoilerMark}`, 72, height - 66);

  return canvas.toDataURL('image/png');
}

export default function SeasonReportModal({
  open,
  diary,
  prefs,
  revealedIds,
  onImportDiary,
  onOpenMatch,
  onClose
}) {
  const closeBtnRef = useRef(null);
  const fileInputRef = useRef(null);
  const [feedback, setFeedback] = useState(null);
  useDialogFocus(open, closeBtnRef);

  const fixtures = getFixtures();
  const report = useMemo(
    () => buildSeasonReport(diary, fixtures, prefs, revealedIds),
    [diary, fixtures, prefs, revealedIds]
  );

  const matchMap = useMemo(() => {
    const map = new Map();
    for (const f of fixtures) map.set(f.id, f);
    return map;
  }, [fixtures]);

  if (!open) return null;

  const handleExportPng = () => {
    try {
      const dataUrl = renderPosterCanvas(report, prefs);
      if (!dataUrl) {
        setFeedback('当前环境不支持画布导出');
        return;
      }
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `nightowl-season-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      setFeedback('已生成本地黑金长图 PNG 下载');
    } catch {
      setFeedback('导出长图失败，请稍后重试');
    }
  };

  const handleExportJson = () => {
    const payload = JSON.stringify(normalizeDiary(diary), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nightowl-diary-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback('已导出本地账本 JSON 备份');
  };

  const handleImportFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = normalizeDiary(JSON.parse(text));
      onImportDiary?.(parsed);
      setFeedback(`已导入 ${Object.keys(parsed.entries).length} 条观赛记录`);
    } catch {
      setFeedback('JSON 格式无效，未覆盖当前记录');
    }
  };

  const maxHourBucket = Math.max(1, ...report.safeSummary.hourBuckets);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="season-report-title"
        className="flex max-h-[min(760px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-hairline bg-surface-panel shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="accent">本地黑金战报</Chip>
              <h2 id="season-report-title" className="text-base font-semibold text-text-primary">
                我的熬夜赛季账单
              </h2>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {report.persona.title} — {report.persona.detail}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <IconClose size={16} />
          </button>
        </header>

        <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 核心 4 项指标 */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <Meta>累计盖章</Meta>
              <div className="mt-1 font-num text-xl font-bold text-text-primary">
                {report.safeSummary.totalWatched}
              </div>
            </div>
            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <Meta>S3/S4 守夜</Meta>
              <div className="mt-1 font-num text-xl font-bold text-accent">
                {report.safeSummary.lateNightCount}
              </div>
            </div>
            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <Meta>血赚名局</Meta>
              <div className="mt-1 font-num text-xl font-bold text-resource">
                {report.outcomeSummary.worthItCount}
                {report.outcomeSummary.worthItRate != null && (
                  <span className="ml-1 text-xs font-normal text-text-muted">
                    ({report.outcomeSummary.worthItRate}%)
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <Meta>0-0 催眠坑</Meta>
              <div className="mt-1 font-num text-xl font-bold text-text-secondary">
                {report.outcomeSummary.dullDrawCount}
              </div>
            </div>
          </div>

          {report.outcomeSummary.maskedBySpoilerCount > 0 && (
            <div className="rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-2xs text-accent">
              防剧透护盾已隔离 {report.outcomeSummary.maskedBySpoilerCount} 场未揭晓补看赛果，揭晓后自动计入主队胜率与名局统计。
            </div>
          )}

          {/* 印章与模式分布 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <h3 className="text-xs font-semibold text-text-primary">观赛方式</h3>
              <div className="mt-2 space-y-1.5">
                {WATCH_MODES.map(mode => {
                  const count = report.safeSummary.byMode[mode] || 0;
                  const pct =
                    report.safeSummary.totalWatched > 0
                      ? Math.round((count / report.safeSummary.totalWatched) * 100)
                      : 0;
                  return (
                    <div key={mode} className="flex items-center justify-between text-xs">
                      <span className="text-text-secondary">{MODE_META[mode].label}</span>
                      <span className="font-num tabular-nums text-text-primary">
                        {count} 场 · {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <h3 className="text-xs font-semibold text-text-primary">情绪印章汇总</h3>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {DIARY_STAMPS.map(id => {
                  const meta = STAMP_META[id];
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between rounded bg-surface-panel px-2 py-1 text-xs"
                    >
                      <span className="text-text-secondary">
                        {meta.glyph} {meta.label}
                      </span>
                      <span className="font-num font-semibold text-text-primary">
                        {report.safeSummary.byStamp[id] || 0}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 深夜出勤小时分布（仅 00-06 + 20-23 直观柱） */}
          <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-text-primary">深夜出勤时段热力（北京时间）</h3>
              <Meta>仅统计已盖章场次开球点</Meta>
            </div>
            <div className="mt-2.5 flex h-12 items-end gap-1">
              {[20, 21, 22, 23, 0, 1, 2, 3, 4, 5].map(hr => {
                const count = report.safeSummary.hourBuckets[hr] || 0;
                const heightPct = Math.max(8, Math.round((count / maxHourBucket) * 100));
                return (
                  <div key={hr} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-8 w-full items-end">
                      <div
                        className={`w-full rounded-t ${count > 0 ? 'bg-accent/80' : 'bg-line-control/40'}`}
                        style={{ height: `${heightPct}%` }}
                        title={`${String(hr).padStart(2, '0')}:00 · ${count} 场`}
                      />
                    </div>
                    <span className="font-num text-[10px] text-text-faint">
                      {String(hr).padStart(2, '0')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 主队深夜战绩 */}
          {report.teamRecords.length > 0 && (
            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <h3 className="text-xs font-semibold text-text-primary">主队深夜陪看账本</h3>
              <div className="mt-2 space-y-1.5">
                {report.teamRecords.map(rec => (
                  <div
                    key={rec.teamId}
                    className="flex items-center justify-between rounded-md bg-surface-panel px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Crest id={rec.teamId} size={18} />
                      <span className="font-medium text-text-primary">{teamName(rec.teamId)}</span>
                    </div>
                    <div className="font-num text-text-secondary">
                      陪看 {rec.watched} 场
                      {rec.decided > 0 && ` · ${rec.w}胜 ${rec.d}平 ${rec.l}负 (${rec.winRate}%)`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 最近记录 */}
          {report.recentEntries.length > 0 && (
            <div className="rounded-lg border border-line-hairline bg-surface-card p-3">
              <h3 className="text-xs font-semibold text-text-primary">近期观赛印章</h3>
              <div className="mt-2 space-y-1.5">
                {report.recentEntries.map(e => {
                  const m = matchMap.get(e.matchId);
                  const meta = STAMP_META[e.stamp];
                  return (
                    <button
                      key={e.matchId}
                      type="button"
                      onClick={() => {
                        if (onOpenMatch) {
                          onClose?.();
                          onOpenMatch(e.matchId);
                        }
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md bg-surface-panel px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-raised"
                    >
                      <span className="min-w-0 truncate text-text-primary">
                        {m ? `${teamName(m.h)} vs ${teamName(m.a)}` : e.matchId}
                        {e.note ? ` · “${e.note}”` : ''}
                      </span>
                      <span className="shrink-0 font-num text-2xs text-accent">
                        {meta?.glyph} {meta?.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line-hairline px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="default" size="xs" onClick={handleExportPng}>
              导出战报 PNG
            </Button>
            <Button variant="ghost" size="xs" onClick={handleExportJson}>
              导出 JSON 备份
            </Button>
            <Button variant="ghost" size="xs" onClick={() => fileInputRef.current?.click()}>
              导入备份
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
          {feedback && <Meta className="text-resource">{feedback}</Meta>}
        </footer>
      </section>
    </div>
  );
}
