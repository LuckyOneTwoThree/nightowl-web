import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 主流级开屏动画 · 夜猫看台 (NightOwl Splash Screen)
 *
 * 设计灵感参考：Apple TV+ / DAZN / 哔哩哔哩 / 腾讯视频
 * 核心特质：
 *   · 沉浸式暗夜星云宇宙光效，与应用主体深海钴蓝 + 极光紫无缝融合
 *   · 夜猫双瞳金色点亮特效，辅以科技感光晕脉冲环
 *   · 电影级渐变文字排印与状态微流光进度条
 *   · 用户控制权第一：右上角「跳过」倒计时按钮，支持鼠标直接点击，
 *     或按 Space / Enter / Escape 快捷键即刻跳过
 *   · 退出阶段采用 cubic-bezier 丝滑缩放淡出（scale-105 opacity-0），随后彻底自卸载
 */
export default function SplashScreen({
  onClose,
  duration = 2000,
  initialCountdown = 2
}) {
  const [phase, setPhase] = useState('active'); // 'active' | 'exit' | 'done'
  const [countdown, setCountdown] = useState(initialCountdown);
  const [statusText, setStatusText] = useState('正在连接绿茵信号网络...');
  const [progress, setProgress] = useState(25);
  // 退出阶段的 450ms 计时器：必须可清理 —— 父级在退出动画期间卸载本组件时，
  // 未清理的计时器会命中「卸载后 setState」并二次触发 onClose。
  const dismissTimerRef = useRef(null);

  // 快捷跳过处理
  const handleDismiss = useCallback(() => {
    if (phase === 'exit' || phase === 'done') return;
    setPhase('exit');
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      setPhase('done');
      onClose?.();
    }, 450);
  }, [phase, onClose]);

  // 卸载时兜底清理退出计时器（组件由父级按 splashOpen 条件渲染，随时可能被摘掉）
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, []);

  // 键盘快捷键监听：Space / Enter / Escape 直接跳过
  useEffect(() => {
    const onKeyDown = (e) => {
      if (['Space', 'Enter', 'Escape'].includes(e.code) || e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDismiss]);

  // 动画阶段与文案状态调度
  useEffect(() => {
    // 进度条微步推进
    const progTimer = setTimeout(() => setProgress(88), 50);

    // 状态文字步进
    const step1 = setTimeout(() => setStatusText('正在推导夜猫观赛指数...'), 700);
    const step2 = setTimeout(() => setStatusText('智能观赛座席就绪'), 1400);

    // 倒计时
    const cdTimer = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    // 自动淡出
    const exitTimer = setTimeout(() => {
      setPhase('exit');
    }, duration);

    // 彻底销毁
    const doneTimer = setTimeout(() => {
      setPhase('done');
      onClose?.();
    }, duration + 500);

    return () => {
      clearTimeout(progTimer);
      clearTimeout(step1);
      clearTimeout(step2);
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
      clearInterval(cdTimer);
    };
  }, [duration, onClose]);

  if (phase === 'done') return null;

  return (
    <div
      role="dialog"
      aria-label="夜猫看台开屏画面"
      className={`fixed inset-0 z-splash flex flex-col items-center justify-between overflow-hidden select-none bg-[#08090e] px-6 py-8 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        phase === 'exit'
          ? 'opacity-0 scale-105 pointer-events-none'
          : 'opacity-100 scale-100'
      }`}
    >
      {/* 多重宇宙星云背景环境光 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_85%_10%,_rgba(124,58,237,0.22),_transparent_65%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_50%_at_15%_20%,_rgba(37,99,235,0.20),_transparent_65%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_50%,_rgba(245,185,66,0.06),_transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-15%,_rgba(30,42,75,0.4),_rgba(8,10,16,0.95)_70%,_#05060a_100%)]" />

      {/* 顶部栏：右上角跳过按钮 */}
      <div className="relative z-10 flex w-full max-w-[1200px] items-center justify-end">
        <button
          type="button"
          onClick={handleDismiss}
          className="group flex items-center gap-1.5 rounded-full border border-white/10 bg-surface-card/60 px-3.5 py-1.5 text-xs text-text-secondary shadow-lg backdrop-blur-md transition-all hover:border-accent/40 hover:bg-surface-raised/80 hover:text-text-primary cursor-pointer"
        >
          <span>跳过</span>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 font-num text-2xs font-semibold text-accent group-hover:bg-accent/30">
            {countdown}
          </span>
        </button>
      </div>

      {/* 中心视觉核心群 */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center">
        {/* 夜猫徽标与脉冲光环 */}
        <div className="relative mb-6 flex items-center justify-center">
          {/* 外圈微光脉冲环 */}
          <div className="absolute h-28 w-28 rounded-full border border-accent/20 bg-accent/5 animate-ping opacity-25" />
          <div className="absolute h-36 w-36 rounded-full border border-purple-500/20 bg-purple-500/5 animate-pulse opacity-20" />

          {/* 发光主体圆角底座 */}
          <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-b from-[#1c2237] via-[#101424] to-[#0a0c16] shadow-[0_0_40px_rgba(245,185,66,0.28),0_16px_36px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-transform duration-700 hover:scale-105">
            <img
              src="/favicon.png"
              alt="夜猫看台"
              width="96"
              height="96"
              className="h-full w-full object-cover select-none pointer-events-none drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]"
              loading="eager"
            />
          </div>
        </div>

        {/* 主标题：夜猫看台 */}
        <h1 className="mb-2 bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-wider text-transparent sm:text-4xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
          夜猫看台
        </h1>

        {/* 英文标识 */}
        <div className="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-accent/85 drop-shadow-[0_0_8px_rgba(245,185,66,0.3)]">
          N I G H T O W L
        </div>

        {/* 核心副标 */}
        <p className="max-w-md text-xs sm:text-sm text-text-secondary/90 tracking-widest font-normal">
          五大联赛与欧战 · 智能观赛座席
        </p>
      </div>

      {/* 底部进度与就绪提示 */}
      <div className="relative z-10 flex w-full max-w-[280px] flex-col items-center gap-2.5 pb-4">
        {/* 极细流光进度条 */}
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 shadow-[0_0_8px_rgba(245,185,66,0.7)] transition-all duration-700 ease-out"
            style={{
              width: phase === 'exit' ? '100%' : `${progress}%`
            }}
          />
        </div>

        {/* 动态状态文案 */}
        <div className="flex items-center gap-2 text-2xs text-text-faint font-medium">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          <span>{statusText}</span>
        </div>
      </div>
    </div>
  );
}
