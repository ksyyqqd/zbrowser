import { describe, expect, it } from 'vitest';
import { computeNavigatorResult } from '../navigator';

describe('computeNavigatorResult', () => {
  it('carries the done text back as finalAnswer', () => {
    // 回归用例：done 的答复文本必须一路带回 executor。Navigator 直接 done 时 planner 不再跑，
    // context.finalAnswer 若一直是 null，TASK_OK 就只能退化成 taskId ——
    // 表现为「任务跑完了，但找到的内容没有输出出来」。
    const result = computeNavigatorResult([
      { isDone: false, extractedContent: 'clicked something' },
      { isDone: true, extractedContent: '今日微博十大热搜：\n1. ...' },
    ]);

    expect(result.done).toBe(true);
    expect(result.finalAnswer).toBe('今日微博十大热搜：\n1. ...');
  });

  it('reports not-done when the last action is not done', () => {
    const result = computeNavigatorResult([
      { isDone: true, extractedContent: 'stale done from an earlier step' },
      { isDone: false, extractedContent: 'clicked' },
    ]);

    expect(result.done).toBe(false);
    expect(result.finalAnswer).toBeUndefined();
  });

  it('handles an empty result list', () => {
    expect(computeNavigatorResult([])).toEqual({ done: false });
  });

  it('leaves finalAnswer undefined when done carries no text', () => {
    // executor 侧会在 finalAnswer 为空时退回通用完成语，所以这里不能返回空字符串冒充答复
    const result = computeNavigatorResult([{ isDone: true, extractedContent: null }]);

    expect(result.done).toBe(true);
    expect(result.finalAnswer).toBeUndefined();
  });
});
