import { describe, expect, it } from 'vitest';
import type { HttpAdapter, HttpRequest } from './http.js';
import { createFilesClient, type FileTransferAdapter } from './files.js';

describe('files client', () => {
  it('keeps platform file handles behind the transfer adapter', async () => {
    const uploads: Array<{ path: string; file: string }> = [];
    const http: HttpAdapter = { request: async <T>(_request: HttpRequest) => undefined as T };
    const transfer: FileTransferAdapter<string> = {
      async upload<T>(path, file): Promise<T> {
        uploads.push({ path, file });
        return { files: [{ id: 'file-1' }] } as T;
      },
      downloadUrl: (path, inline) => `${path}?inline=${inline ? '1' : '0'}`,
    };

    const client = createFilesClient(http, transfer);
    const file = await client.task.upload('task-1', 'wxfile://temporary');

    expect(file.id).toBe('file-1');
    expect(uploads).toEqual([{ path: '/tasks/task-1/files', file: 'wxfile://temporary' }]);
    expect(client.task.url('task-1', 'file-1', true)).toBe('/tasks/task-1/files/file-1?inline=1');
  });
});
