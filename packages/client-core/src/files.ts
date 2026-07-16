import type { Attachment, AttachmentsResponse, TaskFile, TaskFilesResponse } from 'shared';
import type { HttpAdapter } from './http.js';

export type AttachmentOwner = 'ideas' | 'comments';

/** Platform file transfer boundary: browser File, Taro temp path, or another native handle. */
export interface FileTransferAdapter<TFile> {
  upload<T>(path: string, file: TFile): Promise<T>;
  downloadUrl(path: string, inline?: boolean): string;
}

export function createFilesClient<TFile>(http: HttpAdapter, transfer: FileTransferAdapter<TFile>) {
  return {
    task: {
      list: (taskId: string, signal?: AbortSignal): Promise<TaskFilesResponse> =>
        http.request({ method: 'GET', path: `/tasks/${taskId}/files`, signal }),
      upload: async (taskId: string, file: TFile): Promise<TaskFile> => {
        const response = await transfer.upload<TaskFilesResponse>(`/tasks/${taskId}/files`, file);
        const created = response.files[0];
        if (!created) throw new Error('服务器未返回上传文件信息');
        return created;
      },
      remove: (taskId: string, fileId: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/tasks/${taskId}/files/${fileId}` }),
      url: (taskId: string, fileId: string, inline = false): string =>
        transfer.downloadUrl(`/tasks/${taskId}/files/${fileId}`, inline),
    },
    attachment: {
      upload: async (owner: AttachmentOwner, ownerId: string, file: TFile): Promise<Attachment> => {
        const response = await transfer.upload<AttachmentsResponse>(
          `/${owner}/${ownerId}/files`,
          file,
        );
        const created = response.files[0];
        if (!created) throw new Error('服务器未返回上传文件信息');
        return created;
      },
      remove: (owner: AttachmentOwner, ownerId: string, fileId: string): Promise<void> =>
        http.request({ method: 'DELETE', path: `/${owner}/${ownerId}/files/${fileId}` }),
      url: (owner: AttachmentOwner, ownerId: string, fileId: string, inline = false): string =>
        transfer.downloadUrl(`/${owner}/${ownerId}/files/${fileId}`, inline),
    },
  };
}
