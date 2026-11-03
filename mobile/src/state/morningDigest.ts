import { create } from 'zustand';

/**
 * 晨间补看摘要的「跨屏打开信号」。
 *
 * 背景：摘要此前在 `_layout` 与「我的」页各挂了一份 `useMorningDigest`，
 * 两份各自维护 `visible`、却共读同一个 AsyncStorage 的已关闭夜晚 key，
 * 关闭时只写 key、不回写另一实例的本地 state —— 可能出现叠两层弹窗、或关掉又弹。
 *
 * 收口方案：摘要只保留 `_layout` 里唯一实例（自动弹出也在这里），
 * 「我的」页的「看摘要」改为发一个递增信号，由唯一实例响应。
 * 摘要的「已看 / 待看」事实源仍是补看队列，本 store 不持有任何比赛数据。
 */
type MorningDigestStore = {
  openSignal: number;
  requestOpen: () => void;
};

export const useMorningDigestStore = create<MorningDigestStore>(set => ({
  openSignal: 0,
  requestOpen: () => set(state => ({ openSignal: state.openSignal + 1 })),
}));
