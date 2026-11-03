import React from 'react';
import { copyText } from '../lib/clipboard.js';

/**
 * 渲染期错误的最后兜底。v0.1.25 的 MatchCanvas 漏解构曾让整棵树卸载成黑屏；
 * 这里至少保留一个可操作的出口，而不是把 #root 清空。
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = String(this.state.error?.stack || this.state.error?.message || this.state.error || '未知错误');
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-panel p-6 text-text-primary">
        <div className="w-full max-w-lg rounded-2xl border border-line-hairline bg-surface-card p-6 shadow-card">
          <p className="text-2xs font-medium tracking-wide text-text-faint">夜猫看台</p>
          <h1 className="mt-2 text-lg font-semibold text-text-primary">界面遇到错误</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            比赛数据没有丢失。可以先重新加载；如果反复出现，请复制错误信息反馈。
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-line-hairline bg-surface-panel p-3 text-2xs leading-relaxed text-text-muted whitespace-pre-wrap break-words">
            {message}
          </pre>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-transform hover:brightness-110 active:scale-95"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(message);
                this.setState({ copied: ok ? 'ok' : 'failed' });
              }}
              className="rounded-lg border border-line-hairline px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
            >
              {this.state.copied === 'ok' ? '已复制' : this.state.copied === 'failed' ? '复制失败' : '复制错误信息'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
