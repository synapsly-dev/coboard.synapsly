import { createFilesClient, createResourceClients, createTasksClient } from 'client-core';
import { taroFileTransfer } from './file-transfer';
import { taroHttpAdapter } from './http';

export const coboardClient = {
  ...createResourceClients(taroHttpAdapter),
  tasks: createTasksClient(taroHttpAdapter),
  files: createFilesClient(taroHttpAdapter, taroFileTransfer),
};

