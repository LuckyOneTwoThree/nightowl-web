/**
 * 每周熬夜预算可选项（小时）。
 *
 * 我的 / 规划 / 首次引导三处选择器共用这一份，避免「某处加了 7h、另两处没有」
 * 的口径漂移；预算本身仍是 `prefs.weeklyBudget` 单一事实源。
 */
export const WEEKLY_BUDGET_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 8] as const;
