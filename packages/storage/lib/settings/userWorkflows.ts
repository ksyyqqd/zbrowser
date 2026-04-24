import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import type { WorkflowNode, WorkflowEdge, WorkflowVariable, WorkflowExecutionConfig } from '@extension/workflow';

/**
 * User-defined Workflow Configuration (stored in extension storage)
 */
export interface UserWorkflowConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: WorkflowVariable[];
  executionConfig: WorkflowExecutionConfig;
  createdAt: number;
  updatedAt?: number;
}

/**
 * User Workflows storage record
 */
export interface UserWorkflowsRecord {
  workflows: Record<string, UserWorkflowConfig>;
}

/**
 * Import result
 */
export interface WorkflowImportResult {
  imported: number;
  errors: string[];
  importedIds: string[];
}

/**
 * User Workflows Storage type with extended methods
 */
export type UserWorkflowsStorage = BaseStorage<UserWorkflowsRecord> & {
  addWorkflow: (workflow: UserWorkflowConfig) => Promise<void>;
  updateWorkflow: (id: string, updates: Partial<UserWorkflowConfig>) => Promise<void>;
  removeWorkflow: (id: string) => Promise<void>;
  getWorkflow: (id: string) => Promise<UserWorkflowConfig | undefined>;
  getAllWorkflows: () => Promise<UserWorkflowConfig[]>;
  importWorkflows: (workflows: UserWorkflowConfig[]) => Promise<WorkflowImportResult>;
  exportWorkflows: (ids?: string[]) => Promise<UserWorkflowConfig[]>;
};

// Storage key
const STORAGE_KEY = 'user-workflows';

// Create base storage
const storage = createStorage<UserWorkflowsRecord>(
  STORAGE_KEY,
  { workflows: {} },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

/**
 * Validate a workflow config
 */
function validateWorkflowConfig(workflow: UserWorkflowConfig): string | null {
  if (!workflow.id) return 'Workflow ID is required';
  if (!workflow.name) return 'Workflow name is required';
  // Description is optional, just use default if empty

  // Check for start and end nodes
  const startNode = workflow.nodes.find(n => n.type === 'start');
  if (!startNode) return 'Workflow must have a start node';

  const endNode = workflow.nodes.find(n => n.type === 'end');
  if (!endNode) return 'Workflow must have an end node';

  // Check for unique node IDs
  const nodeIds = new Set<string>();
  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) return `Duplicate node ID: ${node.id}`;
    nodeIds.add(node.id);
  }

  return null;
}

/**
 * User Workflows Store
 */
export const userWorkflowsStore: UserWorkflowsStorage = {
  ...storage,

  async addWorkflow(workflow: UserWorkflowConfig) {
    const error = validateWorkflowConfig(workflow);
    if (error) {
      throw new Error(error);
    }

    const workflowConfig: UserWorkflowConfig = {
      ...workflow,
      createdAt: workflow.createdAt ?? Date.now(),
    };

    const current = await storage.get();
    await storage.set({
      workflows: {
        ...current.workflows,
        [workflowConfig.id]: workflowConfig,
      },
    });
  },

  async updateWorkflow(id: string, updates: Partial<UserWorkflowConfig>) {
    const current = await storage.get();
    const existing = current.workflows[id];

    if (!existing) {
      throw new Error(`Workflow not found: ${id}`);
    }

    const updated: UserWorkflowConfig = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    // Validate updated workflow
    const error = validateWorkflowConfig(updated);
    if (error) {
      throw new Error(error);
    }

    await storage.set({
      workflows: {
        ...current.workflows,
        [id]: updated,
      },
    });
  },

  async removeWorkflow(id: string) {
    const current = await storage.get();
    const { [id]: removed, ...rest } = current.workflows;
    await storage.set({ workflows: rest });
  },

  async getWorkflow(id: string) {
    const current = await storage.get();
    return current.workflows[id];
  },

  async getAllWorkflows() {
    const current = await storage.get();
    return Object.values(current.workflows);
  },

  async importWorkflows(workflows: UserWorkflowConfig[]) {
    const result: WorkflowImportResult = {
      imported: 0,
      errors: [],
      importedIds: [],
    };

    const current = await storage.get();
    const newWorkflows = { ...current.workflows };

    for (const workflow of workflows) {
      const error = validateWorkflowConfig(workflow);
      if (error) {
        result.errors.push(`Workflow ${workflow.id ?? 'unknown'}: ${error}`);
        continue;
      }

      newWorkflows[workflow.id] = {
        ...workflow,
        createdAt: workflow.createdAt ?? Date.now(),
      };

      result.imported++;
      result.importedIds.push(workflow.id);
    }

    await storage.set({ workflows: newWorkflows });
    return result;
  },

  async exportWorkflows(ids?: string[]) {
    const current = await storage.get();

    if (!ids) {
      return Object.values(current.workflows);
    }

    return ids.map(id => current.workflows[id]).filter((w): w is UserWorkflowConfig => w !== undefined);
  },
};
