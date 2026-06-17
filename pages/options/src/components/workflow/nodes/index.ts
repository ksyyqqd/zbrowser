import { AINode } from './AINode';
import { AutomationNode } from './AutomationNode';
import { ConditionNode } from './ConditionNode';
import { StartNode } from './StartNode';
import { EndNode } from './EndNode';
import { OutputNode } from './OutputNode';

export const nodeTypes = {
  ai: AINode,
  automation: AutomationNode,
  condition: ConditionNode,
  start: StartNode,
  end: EndNode,
  output: OutputNode,
};

export { AINode, AutomationNode, ConditionNode, StartNode, EndNode, OutputNode };
