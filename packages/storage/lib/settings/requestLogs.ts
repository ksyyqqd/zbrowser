import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';

export type AgentRequestLogPhase = 'stream' | 'structured' | 'manual';
export type AgentRequestLogStatus = 'success' | 'failed';

export interface AgentRequestLogEntry {
  id: string;
  taskId: string;
  agent: string;
  modelName: string;
  phase: AgentRequestLogPhase;
  parseStatus: AgentRequestLogStatus;
  createdAt: number;
  requestContent: string;
  responseContent: string;
  error?: string;
}

export type AgentRequestLogMap = Record<string, AgentRequestLogEntry[]>;

const REQUEST_LOGS_KEY = 'agent_request_logs';
const MAX_LOGS_PER_TASK = 50;

const requestLogsStorage = createStorage<AgentRequestLogMap>(
  REQUEST_LOGS_KEY,
  {},
  {
    storageEnum: StorageEnum.Session,
    liveUpdate: true,
  },
);

function trimLogs(entries: AgentRequestLogEntry[]): AgentRequestLogEntry[] {
  if (entries.length <= MAX_LOGS_PER_TASK) {
    return entries;
  }
  return entries.slice(entries.length - MAX_LOGS_PER_TASK);
}

export const requestLogStore = {
  async getAll(): Promise<AgentRequestLogMap> {
    return await requestLogsStorage.get();
  },

  async getByTaskId(taskId: string): Promise<AgentRequestLogEntry[]> {
    const logs = await requestLogsStorage.get();
    return logs[taskId] ?? [];
  },

  async append(entry: AgentRequestLogEntry): Promise<void> {
    await requestLogsStorage.set(prev => {
      const next = { ...prev };
      const taskLogs = next[entry.taskId] ? [...next[entry.taskId]] : [];
      taskLogs.push(entry);
      next[entry.taskId] = trimLogs(taskLogs);
      return next;
    });
  },

  async clearTask(taskId: string): Promise<void> {
    await requestLogsStorage.set(prev => {
      if (!prev[taskId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  },

  subscribe(listener: () => void): () => void {
    return requestLogsStorage.subscribe(listener);
  },
};
