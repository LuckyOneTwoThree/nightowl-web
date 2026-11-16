import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useNow(intervalMs = 30_000, active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;

    const startTimer = () => {
      if (timer) return;
      if (AppState.currentState !== 'active') return;
      setNow(Date.now());
      timer = setInterval(() => {
        if (AppState.currentState === 'active') {
          setNow(Date.now());
        }
      }, intervalMs);
    };

    const stopTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    startTimer();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') startTimer();
      else stopTimer();
    });

    return () => {
      stopTimer();
      sub.remove();
    };
  }, [intervalMs, active]);

  return now;
}
