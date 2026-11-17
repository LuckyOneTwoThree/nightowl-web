/**
 * 唯一 CSP 策略源。
 *
 * main.cjs 的 onHeadersReceived 与 server 静态 HTML 响应共用这一份策略：
 * check:render / check:layout 加载的是真实 server 的 dist 响应，因此门禁窗口
 * 也受同一策略约束——删掉 worker-src 之类的回归会在门禁里变红，而不是只在真机出现
 * （此前策略只挂在 main.cjs，门禁窗口从未注入 CSP，「无违规」断言恒真）。
 *
 * 策略说明：
 *   · script-src 'self' —— 构建产物是 Vite 标准外部模块，无内联脚本
 *   · worker-src 'self' blob: —— hls.js 的解复用 Worker 走 blob:，缺这条会被
 *     script-src 拦截并静默退回主线程解封装（enableWorker 失效，高码率直播卡顿）
 *   · style-src 需 'unsafe-inline' —— 组件大量使用 style={{}} 内联样式（React 行为，
 *     非用户输入），不放行会整体破坏布局；内联样式不是脚本执行通道
 *   · media-src blob: —— hls.js 通过 MediaSource 给 video 喂 blob: 流
 *   · connect-src 只放行自身 + GitHub Releases API（网页端更新检测）
 */
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' https://api.github.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

module.exports = { CSP_POLICY };