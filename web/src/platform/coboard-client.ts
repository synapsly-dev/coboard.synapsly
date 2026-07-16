import { createFilesClient, createResourceClients, createTasksClient } from 'client-core';
import { webHttpAdapter } from '../api/client';
import { webFileTransfer } from './file-transfer';

/** The browser composition root. No resource client depends on React or the DOM. */
export const coboardClient = {
  ...createResourceClients(webHttpAdapter),
  files: createFilesClient(webHttpAdapter, webFileTransfer),
  tasks: createTasksClient(webHttpAdapter),
};
