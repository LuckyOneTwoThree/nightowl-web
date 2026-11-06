import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';

import { toast } from '@/state/toast';

/**
 * 打开外部链接。
 *
 * `Linking.openURL(...).catch(() => {})` 在本项目里出现过两次：链接失效、没有可处理的应用、
 * 系统拦截，全都变成「点了没反应」。打开失败时用户手上就没有别的补救了，
 * 所以这里必须给两个出口：重试，以及把链接复制走自己贴到浏览器里。
 */
export async function openExternal(
  url: string,
  label: string,
  /**
   * 调用方在原生 Modal 里时传 onError：toast 挂在根布局，会被 Modal 盖住，
   * 失败信息必须由弹层自己就地展示。
   */
  options?: { onError?: () => void }
): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    if (options?.onError) options.onError();
    else {
      toast.error(`打不开「${label}」`, [
        { label: '重试', primary: true, onPress: () => void openExternal(url, label) },
        { label: '复制链接', onPress: () => void copyLink(url) },
      ]);
    }
    return false;
  }
}

export async function copyLink(url: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(url);
    toast.success('链接已复制，可粘到浏览器打开');
  } catch {
    toast.error('复制失败，请长按链接手动复制');
  }
}
