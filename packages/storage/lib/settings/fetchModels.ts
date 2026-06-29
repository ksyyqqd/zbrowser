/**
 * 动态从各 LLM provider 的官方接口拉取模型列表。
 *
 * 用法：
 *   const result = await fetchProviderModels(providerType, providerConfig);
 *   if (result.ok) { use result.models } else { show result.error }
 *
 * 不支持的 provider（Azure / Llama / CustomOpenAI）返回 ok=false。
 */

import { ProviderTypeEnum } from './types';
import type { ProviderConfig } from './llmProviders';

export interface FetchModelsResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

/**
 * 过滤 chat 类模型，排除 embedding / image / tts / whisper / 旧版本 base 等
 */
function filterChatModelsOpenAI(ids: string[]): string[] {
  const blockedPrefixes = [
    'dall-e',
    'whisper',
    'tts-',
    'text-embedding',
    'text-moderation',
    'omni-moderation',
    'babbage',
    'davinci',
    'text-davinci',
    'text-curie',
    'text-ada',
    'text-babbage',
    'computer-use',
  ];
  return ids.filter(id => {
    const lower = id.toLowerCase();
    if (blockedPrefixes.some(p => lower.startsWith(p))) return false;
    return true;
  });
}

function filterChatModelsGemini(names: string[]): string[] {
  // Gemini API 返回 "models/gemini-1.5-pro" 这种带前缀的 id，需要去前缀
  return names
    .map(n => (n.startsWith('models/') ? n.slice('models/'.length) : n))
    .filter(n => {
      const lower = n.toLowerCase();
      if (lower.startsWith('text-embedding') || lower === 'embedding-001' || lower.startsWith('aqa')) return false;
      if (lower.startsWith('imagen') || lower.startsWith('veo')) return false;
      return lower.startsWith('gemini') || lower.startsWith('learnlm');
    });
}

/**
 * 大部分 OpenAI 兼容 endpoint 都是 GET {baseUrl}/models 返回 { data: [{id}, ...] }
 */
async function fetchOpenAICompatibleModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = baseUrl.endsWith('/') ? `${baseUrl}models` : `${baseUrl}/models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  if (!Array.isArray(json.data)) {
    throw new Error('Unexpected response format (no data array)');
  }
  return json.data.map(m => m.id).filter(Boolean);
}

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true', // 浏览器扩展需要这个 header
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  if (!Array.isArray(json.data)) {
    throw new Error('Unexpected response format');
  }
  return json.data.map(m => m.id).filter(Boolean);
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const json = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  if (!Array.isArray(json.models)) {
    throw new Error('Unexpected response format');
  }
  // 只保留支持 generateContent 的模型
  return json.models
    .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map(m => m.name)
    .filter(Boolean);
}

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const url = baseUrl.endsWith('/') ? `${baseUrl}api/tags` : `${baseUrl}/api/tags`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const json = (await res.json()) as { models?: Array<{ name: string }> };
  if (!Array.isArray(json.models)) {
    throw new Error('Unexpected response format');
  }
  return json.models.map(m => m.name).filter(Boolean);
}

async function fetchOpenRouterModels(): Promise<string[]> {
  // OpenRouter 模型列表是公开的，不需要 key
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  if (!Array.isArray(json.data)) {
    throw new Error('Unexpected response format');
  }
  return json.data.map(m => m.id).filter(Boolean);
}

/**
 * 按 providerType 分发到对应的拉取函数。
 * Azure / Llama / CustomOpenAI 等不支持/不标准的，返回 ok=false。
 */
export async function fetchProviderModels(
  providerType: ProviderTypeEnum,
  config: ProviderConfig,
): Promise<FetchModelsResult> {
  try {
    let models: string[] = [];
    switch (providerType) {
      case ProviderTypeEnum.OpenAI: {
        const baseUrl = config.baseUrl?.trim() || 'https://api.openai.com/v1';
        models = filterChatModelsOpenAI(await fetchOpenAICompatibleModels(baseUrl, config.apiKey));
        break;
      }
      case ProviderTypeEnum.Anthropic: {
        models = await fetchAnthropicModels(config.apiKey);
        break;
      }
      case ProviderTypeEnum.Gemini: {
        models = filterChatModelsGemini(await fetchGeminiModels(config.apiKey));
        break;
      }
      case ProviderTypeEnum.DeepSeek: {
        const baseUrl = config.baseUrl?.trim() || 'https://api.deepseek.com/v1';
        models = await fetchOpenAICompatibleModels(baseUrl, config.apiKey);
        break;
      }
      case ProviderTypeEnum.Grok: {
        const baseUrl = config.baseUrl?.trim() || 'https://api.x.ai/v1';
        // x.ai 接口里返回的就是 chat 模型，但保守过滤一遍 embedding
        models = (await fetchOpenAICompatibleModels(baseUrl, config.apiKey)).filter(
          id => !id.toLowerCase().includes('embedding'),
        );
        break;
      }
      case ProviderTypeEnum.Groq: {
        const baseUrl = config.baseUrl?.trim() || 'https://api.groq.com/openai/v1';
        models = filterChatModelsOpenAI(await fetchOpenAICompatibleModels(baseUrl, config.apiKey));
        break;
      }
      case ProviderTypeEnum.Cerebras: {
        const baseUrl = config.baseUrl?.trim() || 'https://api.cerebras.ai/v1';
        models = await fetchOpenAICompatibleModels(baseUrl, config.apiKey);
        break;
      }
      case ProviderTypeEnum.OpenRouter: {
        models = await fetchOpenRouterModels();
        break;
      }
      case ProviderTypeEnum.Ollama: {
        const baseUrl = config.baseUrl?.trim() || 'http://localhost:11434';
        models = await fetchOllamaModels(baseUrl);
        break;
      }
      case ProviderTypeEnum.CustomOpenAI: {
        // 自定义 OpenAI 兼容 endpoint，必须有 baseUrl
        if (!config.baseUrl?.trim()) {
          return { ok: false, error: 'Base URL is required for custom OpenAI provider' };
        }
        models = await fetchOpenAICompatibleModels(config.baseUrl, config.apiKey);
        break;
      }
      case ProviderTypeEnum.AzureOpenAI: {
        return {
          ok: false,
          error: 'Azure OpenAI 使用 deployment 名而非 model id，不支持自动获取，请手动填写。',
        };
      }
      case ProviderTypeEnum.Llama: {
        return { ok: false, error: 'Llama provider 暂不支持自动获取模型列表，请手动填写。' };
      }
      default:
        return { ok: false, error: `Unknown provider type: ${providerType}` };
    }

    // 去重 + 排序
    const unique = Array.from(new Set(models)).sort();
    if (unique.length === 0) {
      return { ok: false, error: '接口返回的模型列表为空' };
    }
    return { ok: true, models: unique };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
