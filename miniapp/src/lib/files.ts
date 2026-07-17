import Taro from '@tarojs/taro';
import { sessionStore } from '../platform/session';

function authorizedHeader(): Record<string, string> {
  const token = sessionStore.token();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function chooseFiles(count = 9): Promise<Array<{ path: string; name: string }>> {
  const result = await Taro.chooseMessageFile({ count, type: 'all' });
  return result.tempFiles.map((file) => ({ path: file.path, name: file.name }));
}

export async function openProtectedFile(url: string, filename: string, mime = ''): Promise<void> {
  try {
    Taro.showLoading({ title: '正在打开…' });
    const result = await Taro.downloadFile({ url, header: authorizedHeader() });
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error('下载失败');
    if (mime.startsWith('image/')) {
      await Taro.previewImage({ current: result.tempFilePath, urls: [result.tempFilePath] });
    } else {
      await Taro.openDocument({ filePath: result.tempFilePath, showMenu: true });
    }
  } catch {
    await Taro.showModal({ title: '无法打开文件', content: `“${filename}”的文件类型可能不受微信预览支持，可以稍后在网页版下载。`, showCancel: false });
  } finally {
    Taro.hideLoading();
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
