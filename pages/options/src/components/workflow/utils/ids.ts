import { nanoid } from 'nanoid';

export const newWorkflowId = () => `workflow-${nanoid(10)}`;
export const newNodeId = () => `node-${nanoid(8)}`;
export const newEdgeId = () => `edge-${nanoid(8)}`;
export const newBranchId = () => `branch-${nanoid(6)}`;
