import { AINode } from './AINode';
import { AutomationNode } from './AutomationNode';
import { ConditionNode } from './ConditionNode';
import { StartNode } from './StartNode';
import { EndNode } from './EndNode';

export const nodeTypes = {
  ai: AINode,
  automation: AutomationNode,
  condition: ConditionNode,
  start: StartNode,
  end: EndNode,
};

export { AINode, AutomationNode, ConditionNode, StartNode, EndNode };
