import * as Haptics from 'expo-haptics';

function fire(promise: Promise<void>) {
  promise.catch(() => {
    // 触感反馈不是功能依赖；设备不支持时静默降级
  });
}

export function selectionFeedback() {
  fire(Haptics.selectionAsync());
}

export function impactFeedback() {
  fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
