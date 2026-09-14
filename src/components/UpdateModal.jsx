import React, { useState, useEffect, useCallback } from 'react';
import { Button, Chip, Meta } from './atoms.jsx';
import { IconClose, IconWarn } from './icons.jsx';

const REPO_OWNER = 'LuckyOneTwoThree';
const REPO_NAME = 'nightowl-web';
const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/**
 * 语义化版本比较：a > b 返回正数、相等 0、小于返回负数。
 * 只比较数字段（忽略预发布标记），用于判断线上版本是否真的比本地新。
 */
function compareSemver(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function UpdateModal({
  open,
  onClose,
  currentVersion = __APP_VERSION__,
  updateState,
  onCheck,
  onDownload,
  onInstall
}) {
  const isDesktop = !!window.desktop?.isDesktop;

  // Web 回退状态（纯浏览器环境通过 GitHub API 探测）
  const [webCheck, setWebCheck] = useState({
    loading: false,
    checked: false,
    available: false,
    latestTag: null,
    publishedAt: null,
    body: '',
    downloadUrl: null,
    error: null
  });

  const checkWebUpdate = useCallback(async () => {
    setWebCheck(prev => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(GITHUB_API_URL);
      if (!res.ok) throw new Error(`GitHub API 响应异常 (${res.status})`);
      const data = await res.json();
      const latestTag = (data.tag_name || '').replace(/^v/, '');
      // 语义化比较，不能用 latestTag !== currentVersion：
      // 开发版/本地构建的版本号可能**领先**线上（如 0.2.0 对 0.1.9），
      // 字符串不等会把这种情况误报成「发现新版本」。
      const hasNew = latestTag && compareSemver(latestTag, currentVersion) > 0;
      const asset = data.assets?.find(a => a.name.endsWith('.exe')) || data.assets?.[0];

      setWebCheck({
        loading: false,
        checked: true,
        available: hasNew,
        latestTag: data.tag_name,
        publishedAt: data.published_at ? data.published_at.slice(0, 10) : null,
        body: data.body || '无更新说明',
        downloadUrl: asset?.browser_download_url || data.html_url || RELEASES_PAGE_URL,
        error: null
      });
    } catch (err) {
      setWebCheck(prev => ({
        ...prev,
        loading: false,
        checked: true,
        error: err.message || '获取 GitHub 最新版本失败'
      }));
    }
  }, [currentVersion]);

  // 打开弹窗且非桌面端时，自动走 Web 探测
  useEffect(() => {
    if (open && !isDesktop && !webCheck.checked && !webCheck.loading) {
      checkWebUpdate();
    }
  }, [open, isDesktop, webCheck.checked, webCheck.loading, checkWebUpdate]);

  if (!open) return null;

  // 状态归一化
  const status = isDesktop ? (updateState?.status || 'idle') : (
    webCheck.loading ? 'checking' :
    webCheck.error ? 'error' :
    webCheck.available ? 'available' :
    webCheck.checked ? 'not-available' : 'idle'
  );

  const targetVersion = isDesktop
    ? (updateState?.info?.version || '最新版')
    : (webCheck.latestTag || '最新版');

  const releaseNotes = isDesktop
    ? (updateState?.info?.releaseNotes || '性能优化与体验增强')
    : webCheck.body;

  const handleOpenReleasePage = () => {
    const targetUrl = (!isDesktop && webCheck.downloadUrl) ? webCheck.downloadUrl : RELEASES_PAGE_URL;
    if (window.desktop?.openExternal) {
      window.desktop.openExternal(targetUrl);
    } else {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="版本更新"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/75 px-4 backdrop-blur-md transition-opacity duration-200"
    >
      <div className="relative flex w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0c101c]/95 shadow-[0_20px_50px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.12)]">
        {/* 顶部环境流光装饰条 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-blue-500 via-amber-400 to-purple-500" />

        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/30 bg-accent/15 text-accent shadow-[0_0_12px_rgba(245,185,66,0.3)]">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v8m0 0l3-3m-3 3l-3-3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">夜猫看台 · 版本升级</h2>
              <p className="text-2xs text-text-muted">
                当前安装版本 <span className="font-num text-text-secondary">v{currentVersion}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary cursor-pointer"
          >
            <IconClose size={15} />
          </button>
        </div>

        {/* 内容展示区 */}
        <div className="flex flex-col gap-4 p-5 text-xs text-text-secondary">
          {/* 状态 1：正在检查 */}
          {status === 'checking' && (
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p className="text-xs text-text-muted">正在连接 GitHub Releases 查询最新构建...</p>
            </div>
          )}

          {/* 状态 2：已是最新版本 */}
          {status === 'not-available' && (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="font-medium text-text-primary">当前已是最新版本</p>
              <p className="text-2xs text-text-muted">
                {updateState?.message || '您的夜猫看台桌面端保持在最新状态，无需更新。'}
              </p>
            </div>
          )}

          {/* 状态 3：发现新版本（等待下载） */}
          {status === 'available' && (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between rounded-lg border border-accent/25 bg-accent/10 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
                  <span className="font-semibold text-accent">发现新版本</span>
                </div>
                <span className="font-num font-semibold text-text-primary">v{targetVersion}</span>
              </div>

              {/* 更新日志区域 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-2xs font-medium text-text-muted">更新内容与修复：</span>
                <div className="scrollbar-thin max-h-36 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/40 p-3 text-2xs leading-relaxed text-text-secondary whitespace-pre-line font-mono">
                  {releaseNotes}
                </div>
              </div>
            </div>
          )}

          {/* 状态 4：下载中 */}
          {status === 'downloading' && (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center justify-between text-2xs">
                <span className="font-medium text-accent">正在下载新版本...</span>
                <span className="font-num font-semibold text-text-primary">{updateState?.progress?.percent || 0}%</span>
              </div>

              {/* 进度条 */}
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 shadow-[0_0_10px_rgba(245,185,66,0.6)] transition-all duration-300"
                  style={{ width: `${updateState?.progress?.percent || 0}%` }}
                />
              </div>

              {/* 速度与大小 */}
              <div className="flex items-center justify-between text-2xs text-text-faint font-num">
                <span>速度：{formatBytes(updateState?.progress?.bytesPerSecond)}/s</span>
                <span>
                  {formatBytes(updateState?.progress?.transferred)} / {formatBytes(updateState?.progress?.total)}
                </span>
              </div>
            </div>
          )}

          {/* 状态 5：下载完成待重启 */}
          {status === 'downloaded' && (
            <div className="flex flex-col items-center justify-center gap-2.5 py-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/20 text-accent">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="font-medium text-text-primary">新版本下载就绪！</p>
              <p className="text-2xs text-text-muted">
                点击下方按钮将退出并自动安装更新，所有观赛数据与偏好将完整保留。
              </p>
            </div>
          )}

          {/* 状态 6：错误异常 */}
          {status === 'error' && (
            <div className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-2xs leading-relaxed text-danger">
              <div className="flex items-center gap-1.5 font-medium">
                <IconWarn size={14} />
                <span>更新检测或下载未成功</span>
              </div>
              <p className="text-text-secondary/90">
                {updateState?.message || webCheck?.error || '网络连接超时或 GitHub 暂无法访问。'}
              </p>
            </div>
          )}
        </div>

        {/* 底部按钮操作栏 */}
        <div className="flex items-center justify-between rounded-b-2xl border-t border-white/[0.08] bg-[#090c15] px-5 py-3.5">
          <button
            type="button"
            onClick={handleOpenReleasePage}
            className="text-2xs text-text-muted underline underline-offset-4 hover:text-accent transition-colors cursor-pointer"
          >
            GitHub Release 页面
          </button>

          <div className="flex items-center gap-2">
            {status === 'available' && isDesktop && (
              <Button variant="primary" onClick={onDownload}>
                立即下载更新
              </Button>
            )}

            {status === 'available' && !isDesktop && (
              <Button variant="primary" onClick={handleOpenReleasePage}>
                下载最新安装包
              </Button>
            )}

            {status === 'downloaded' && isDesktop && (
              <Button variant="primary" onClick={onInstall}>
                立即重启安装
              </Button>
            )}

            {(status === 'not-available' || status === 'error') && (
              <Button variant="default" onClick={isDesktop ? onCheck : checkWebUpdate}>
                重新检查
              </Button>
            )}

            <Button variant="ghost" onClick={onClose}>
              {status === 'downloaded' ? '稍后' : '关闭'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
