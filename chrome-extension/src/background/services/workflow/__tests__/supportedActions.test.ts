import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKFLOW_AUTOMATION_ACTIONS } from '../supportedActions';

/**
 * 白名单与真实执行入口的一致性。
 *
 * `WORKFLOW_AUTOMATION_ACTIONS` 是给 `workflow_create` 用的校验清单，而真正执行
 * automation 节点的是 `handleExecuteWorkflow` 里 `actionExecutor` 的 switch。两边一旦
 * 漂移就是静默的坏数据：
 *  - 清单里有、switch 里没有 → AI 能创建出跑起来报 `Unknown action` 的工作流
 *  - switch 里有、清单里没有 → AI 想用一个明明支持的动作却被告知「不是可用动作」
 *
 * 所以这里直接解析 index.ts 的 case 标签来比对，而不是手抄一份期望值 —— 手抄的那份
 * 会和清单一起腐烂。
 */

const INDEX_PATH = resolve(__dirname, '../../../index.ts');

/**
 * 从 index.ts 里抽出 workflow actionExecutor 那个 switch 的所有 case 标签。
 *
 * 定位方式：`actionExecutor` 的 switch 以 `// Execute action based on type` 注释打头，
 * 到 `Unknown action` 的 default 分支结束。用注释锚点而不是行号，文件增删行时不会失效。
 */
function extractWorkflowActionCases(): string[] {
  const source = readFileSync(INDEX_PATH, 'utf8');

  const startMarker = '// Execute action based on type';
  const start = source.indexOf(startMarker);
  expect(start, `未在 index.ts 找到锚点注释 "${startMarker}"，请同步更新本测试`).toBeGreaterThan(-1);

  const endMarker = 'Unknown action';
  const end = source.indexOf(endMarker, start);
  expect(end, '未在 switch 之后找到 "Unknown action" 默认分支，请同步更新本测试').toBeGreaterThan(start);

  const block = source.slice(start, end);
  const cases = [...block.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]);

  // 锚点失效时 cases 会是空数组，那样下面的集合比对会「意外通过」，这里先兜住
  expect(cases.length, '解析出 0 个 case，锚点可能已失效').toBeGreaterThan(5);
  return cases;
}

describe('WORKFLOW_AUTOMATION_ACTIONS', () => {
  it('与 handleExecuteWorkflow 的 actionExecutor switch 完全一致', () => {
    const actual = new Set(extractWorkflowActionCases());
    const declared = new Set<string>(WORKFLOW_AUTOMATION_ACTIONS);

    const missingFromList = [...actual].filter(a => !declared.has(a));
    const missingFromSwitch = [...declared].filter(a => !actual.has(a));

    expect(missingFromList, '这些动作 switch 里实现了但白名单漏了').toEqual([]);
    expect(missingFromSwitch, '这些动作在白名单里但 switch 里没有实现').toEqual([]);
  });

  it('没有重复项', () => {
    expect(new Set(WORKFLOW_AUTOMATION_ACTIONS).size).toBe(WORKFLOW_AUTOMATION_ACTIONS.length);
  });

  it('不含只在对话里有意义的动作', () => {
    // ask_user / done / skill_invoke 依赖 Executor 的对话上下文，放进工作流节点没有意义
    const conversational = ['ask_user', 'done', 'skill_invoke', 'workflow_create', 'workflow_update'];
    for (const name of conversational) {
      expect(WORKFLOW_AUTOMATION_ACTIONS).not.toContain(name);
    }
  });
});
