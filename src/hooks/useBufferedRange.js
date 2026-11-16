import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 缓冲型数值滑杆 Hook：
 * 拖动中仅更新本地 draft（保持 60fps 滑杆与数字反馈），松手 / 失焦或短暂防抖停顿后
 * 才向上游提交 setPrefs，避免每次微调同步写 15+ localStorage 键并重算整周背包 DP。
 */
export function useBufferedRange(committedValue, onCommit, debounceMs = 180) {
  const [draft, setDraft] = useState(committedValue);
  const draftRef = useRef(committedValue);
  const timerRef = useRef(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    setDraft(committedValue);
    draftRef.current = committedValue;
  }, [committedValue]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (draftRef.current !== committedValue) {
      onCommitRef.current?.(draftRef.current);
    }
  }, [committedValue]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleChange = useCallback(
    nextVal => {
      const num = Number(nextVal);
      setDraft(num);
      draftRef.current = num;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onCommitRef.current?.(num);
      }, debounceMs);
    },
    [debounceMs]
  );

  return {
    value: draft,
    onChange: handleChange,
    commit: flush
  };
}
