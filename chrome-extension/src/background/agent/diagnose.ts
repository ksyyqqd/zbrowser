/**
 * 任务失败诊断 —— 在 TASK_FAIL 发出前用 LLM 生成一段简短的失败摘要 + 3 条修复建议。
 *
 * 与 background/inferElementPurposes 同一种"独立 LLM 调用"模式：
 *  - 不走 Navigator/Planner agent prompts，避免污染
 *  - 严格 JSON 输出 + markdown fence / bracket 兜底
 *  - 任何失败 → 返回 null，调用方 fallback 到「无诊断的 TASK_FAIL」
 *
 * 用 BaseChatModel 而非 createChatModel 直接调，因为 executor 已经持有 navigator LLM
 * 实例（复用同一个 model 配置，省一次 store 查询）。
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { TaskFailDiagnosis } from '@extension/shared';
import { createLogger } from '@src/background/log';

const logger = createLogger('diagnose');

const DIAGNOSE_TIMEOUT_MS = 15000;

/**
 * 让 LLM 看任务+最近几步+错误信息，给一个诊断。
 *
 * @param llm Navigator 或 Planner 模型（任何能 invoke 的都行）
 * @param task 用户原始任务文本
 * @param recentSteps 最近 N 步的简短摘要（按时间倒序无所谓，LLM 看得懂）
 * @param errorMessage executor 抓到的 error.message
 * @returns 诊断对象；任何失败/超时返回 null
 */
export async function diagnoseTaskFailure(
  llm: BaseChatModel,
  task: string,
  recentSteps: string[],
  errorMessage: string,
): Promise<TaskFailDiagnosis | null> {
  try {
    const stepsBlock = recentSteps.length > 0 ? recentSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(无)';
    const prompt = [
      '你是一个浏览器自动化任务的诊断助手。',
      '一个 AI Agent 在尝试完成下面的任务时失败了，请给出简短诊断。',
      '',
      `用户任务：${task}`,
      '',
      `最近的执行步骤：`,
      stepsBlock,
      '',
      `失败原因：${errorMessage}`,
      '',
      '请用中文返回：',
      '1. summary：一句话简短解释为什么失败（不超过 30 字，直接说原因不要客套）',
      '2. suggestions：3 条具体可执行的修复建议（每条不超过 25 字）',
      '',
      '**严格按 JSON 输出，不要 markdown 代码块、不要解释**：',
      '{"summary":"...","suggestions":["...","...","..."]}',
    ].join('\n');

    // 加超时保护：失败诊断不能拖延任务结束太久
    const llmCall = llm.invoke(prompt);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('diagnose timeout')), DIAGNOSE_TIMEOUT_MS),
    );
    const response = await Promise.race([llmCall, timeout]);
    const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // 同 inferElementPurposes 的解析兜底：去 markdown fence → 找 {...} 范围
    let cleaned = raw.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          logger.warning('[diagnose] JSON parse failed:', cleaned.slice(0, 200));
          return null;
        }
      } else {
        return null;
      }
    }

    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Record<string, unknown>;
    const summary = typeof p.summary === 'string' ? p.summary.trim() : '';
    const suggestions = Array.isArray(p.suggestions)
      ? p.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map(s => s.trim())
      : [];
    if (!summary) return null;
    return {
      summary: summary.slice(0, 60),
      suggestions: suggestions.slice(0, 3).map(s => s.slice(0, 50)),
    };
  } catch (err) {
    logger.warning('[diagnose] failed:', err);
    return null;
  }
}
