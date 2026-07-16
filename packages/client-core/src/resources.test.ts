import { describe, expect, it } from 'vitest';
import type { HttpAdapter, HttpRequest } from './http.js';
import { createResourceClients } from './resources.js';

describe('resource clients', () => {
  it('uses one transport contract for project mutations', async () => {
    const requests: HttpRequest[] = [];
    const http: HttpAdapter = {
      async request<T>(request: HttpRequest): Promise<T> {
        requests.push(request);
        return { project: { id: 'project-1' } } as T;
      },
    };

    const client = createResourceClients(http);
    await client.projects.update('project-1', { archived: true });

    expect(requests).toEqual([
      {
        method: 'PATCH',
        path: '/projects/project-1',
        body: { archived: true },
      },
    ]);
  });

  it('unwraps the server comment response once in client-core', async () => {
    const http: HttpAdapter = {
      async request<T>(): Promise<T> {
        return { comments: [{ id: 'comment-1', body: 'hello' }] } as T;
      },
    };

    const comment = await createResourceClients(http).comments.create('task-1', { body: 'hello' });
    expect(comment.id).toBe('comment-1');
  });
});
