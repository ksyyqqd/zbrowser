import { AINode } from './AINode';
import { AutomationNode } from './AutomationNode';
import { ConditionNode } from './ConditionNode';
import { LoopNode } from './LoopNode';
import { NoteNode } from './NoteNode';
import { SubflowNode } from './SubflowNode';
import { StartNode } from './StartNode';
import { EndNode } from './EndNode';
import { OutputNode } from './OutputNode';

export const nodeTypes = {
  ai: AINode,
  automation: AutomationNode,
  condition: ConditionNode,
  loop: LoopNode,
  note: NoteNode,
  subflow: SubflowNode,
  start: StartNode,
  end: EndNode,
  output: OutputNode,
};

export { AINode, AutomationNode, ConditionNode, LoopNode, NoteNode, SubflowNode, StartNode, EndNode, OutputNode };
