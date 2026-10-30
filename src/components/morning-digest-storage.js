const KEY = 'nightowl:morningDigest:v1';

export function loadMorningDigestDismissed() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { night: '' };
    const parsed = JSON.parse(raw);
    return { night: typeof parsed?.night === 'string' ? parsed.night : '' };
  } catch {
    return { night: '' };
  }
}

export function saveMorningDigestDismissed(night) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ night }));
  } catch {
    // 存储不可用时不影响本次会话关闭
  }
}
