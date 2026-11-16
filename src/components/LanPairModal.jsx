import { useEffect, useMemo, useRef, useState } from 'react';
import { generateQrMatrix } from '../lib/qr-svg.js';
import { useDialogFocus } from '../hooks/useDialogFocus.js';
import { Button, Chip, Meta } from './atoms.jsx';
import { IconClose } from './icons.jsx';

function QrSvgBox({ value }) {
  const qr = useMemo(() => {
    if (!value) return null;
    try {
      return generateQrMatrix(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!qr) {
    return (
      <div className="flex h-[200px] w-[200px] items-center justify-center rounded-xl border border-line-hairline bg-surface-card text-xs text-text-muted">
        二维码生成失败
      </div>
    );
  }

  const quiet = 4;
  const total = qr.size + quiet * 2;
  const rects = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) {
        rects.push(<rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} fill="#0A0D14" />);
      }
    }
  }

  return (
    <div className="inline-flex rounded-xl bg-white p-2.5 shadow-card">
      <svg
        width={196}
        height={196}
        viewBox={`0 0 ${total} ${total}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label="局域网配对二维码"
      >
        <rect x={0} y={0} width={total} height={total} fill="#FFFFFF" />
        {rects}
      </svg>
    </div>
  );
}

export default function LanPairModal({
  open,
  session,
  loading = false,
  syncNotice = null,
  onSwitchHost = null,
  onRestart,
  onClose
}) {
  const closeBtnRef = useRef(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [copied, setCopied] = useState(null);
  useDialogFocus(open, closeBtnRef);

  useEffect(() => {
    if (!open) return undefined;
    setNowTs(Date.now());
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;

  const isHandoff = session?.mode === 'handoff';
  const remainingSec = session?.expiresAt ? Math.max(0, Math.ceil((session.expiresAt - nowTs) / 1000)) : 0;
  const expired = Boolean(session?.active && session?.expiresAt && remainingSec === 0);

  const copyText = async (text, label) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(`已复制${label}`);
        setTimeout(() => setCopied(null), 2500);
      }
    } catch {
      setCopied('复制失败');
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="lan-pair-title"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line-hairline bg-surface-panel shadow-pop"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="accent">{isHandoff ? '被窝手机接力' : '零云端局域网同步'}</Chip>
              <h2 id="lan-pair-title" className="text-base font-semibold text-text-primary">
                {isHandoff ? '把这场比赛无缝交棒给手机' : '局域网一扫同步'}
              </h2>
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {isHandoff
                ? '手机在同一 Wi-Fi 下扫码或输入配对码，直接合并看台偏好并切到同一场播控。'
                : '仅在当前会话开启 120 秒临时局域网端口，不经过任何云端与账号。'}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="关闭配对窗口"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <IconClose size={16} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {syncNotice && (
            <div className="rounded-lg border border-resource/35 bg-resource/10 px-3 py-2 text-xs text-resource">
              {syncNotice}
            </div>
          )}

          {session?.error ? (
            <div className="rounded-lg border border-danger/35 bg-danger/10 p-3 text-xs text-danger">
              配对服务启动失败：{session.error}
            </div>
          ) : loading && !session?.active ? (
            <div className="flex h-48 items-center justify-center text-xs text-text-muted">
              正在开启临时局域网配对会话…
            </div>
          ) : session?.active ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="shrink-0">
                <QrSvgBox value={session.pairUri} />
              </div>

              <div className="w-full min-w-0 flex-1 space-y-2.5 text-xs">
                <div className="rounded-lg border border-line-hairline bg-surface-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Meta>一次性 6 位配对口令</Meta>
                    <span className={`font-num text-xs tabular-nums ${expired ? 'text-danger' : 'text-accent'}`}>
                      {expired ? '已过期' : `${remainingSec}s 后失效`}
                    </span>
                  </div>
                  <div className="font-num text-2xl font-bold tracking-[0.22em] text-text-primary">
                    {session.pin}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-line-hairline pt-2 text-2xs text-text-secondary">
                    <span className="truncate font-num tabular-nums">
                      主机 {session.host}:{session.port}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText(`${session.host}:${session.port}`, '主机端口')}
                      className="shrink-0 text-accent hover:underline cursor-pointer"
                    >
                      复制地址
                    </button>
                  </div>
                  {Array.isArray(session.candidates) && session.candidates.length > 1 && onSwitchHost && (
                    <div className="flex flex-wrap items-center gap-1 border-t border-line-hairline pt-2">
                      <Meta className="mr-1">网卡切换</Meta>
                      {session.candidates.slice(0, 4).map(ip => {
                        const selected = ip === session.host;
                        return (
                          <button
                            key={ip}
                            type="button"
                            disabled={loading || selected}
                            onClick={() => onSwitchHost(ip)}
                            className={`rounded px-1.5 py-0.5 font-num text-2xs tabular-nums transition-colors cursor-pointer ${
                              selected
                                ? 'bg-accent/15 text-accent font-medium'
                                : 'bg-surface-panel text-text-secondary hover:text-text-primary'
                            }`}
                          >
                            {ip}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-line-hairline bg-surface-card p-2.5 text-2xs leading-relaxed text-text-secondary">
                  手机端打开 NightOwl App →「我的 → 局域网同步」扫码或手动填入主机端口与 6 位口令；也可复制深链：
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="min-w-0 truncate rounded bg-surface-panel px-1.5 py-0.5 font-num text-text-primary">
                      {session.pairUri}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyText(session.pairUri, '配对深链')}
                      className="shrink-0 text-accent hover:underline cursor-pointer"
                    >
                      复制链接
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-36 items-center justify-center text-xs text-text-muted">
              配对会话已结束，点击下方「重新生成」再次开启。
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line-hairline px-5 py-3">
          <Meta className="min-w-0 flex-1 leading-relaxed text-text-faint">
            {copied || '仅暴露 /pair/info /pair/sync /pair/handoff，绝不暴露流代理'}
          </Meta>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="xs" onClick={onRestart} disabled={loading}>
              重新生成
            </Button>
            <Button variant="primary" size="xs" onClick={onClose}>
              关闭并停止监听
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
