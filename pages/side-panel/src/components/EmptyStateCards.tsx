/**
 * 空对话首屏的快捷动作卡片
 *
 * 渲染在 BookmarkList 上方（messages.length === 0 时）。三张卡片：
 *  - 🎓 教这个网站 → 父级回调 setShowTeaching(true)
 *  - 🎯 用过的元素 → 跳 options?tab=memory
 *  - 💡 试试这些任务 → 列 2-3 个示例（按 hostname 简易匹配），点了塞进 ChatInput
 *
 * 设计目的：新用户进来不会只看到一个空 textarea + 一堆收藏 —— 让他立刻看到
 * "这扩展能干什么" 的入口。
 */

import { useEffect, useState } from 'react';
import { FiBookOpen, FiCpu, FiZap } from 'react-icons/fi';
import { getHostnameFromUrl } from '@extension/storage';

interface EmptyStateCardsProps {
  /** 点「教这个网站」时回调 */
  onOpenTeaching: () => void;
  /** 点示例任务时回调，把 prompt 文本塞回 ChatInput textarea */
  onTryExample: (prompt: string) => void;
}

/** 按 hostname 关键字给出 2-3 个示例任务；通用 fallback 给两条 */
function exampleTasksFor(hostname: string): string[] {
  const h = hostname.toLowerCase();
  if (h.includes('deepseek')) {
    return ['让 DeepSeek 帮我把这段话翻译成英文', '问 DeepSeek：今天有什么 AI 新闻？'];
  }
  if (h.includes('chat.openai') || h.includes('chatgpt')) {
    return ['让 ChatGPT 解释一下「闭包」', '让 ChatGPT 写一首关于秋天的诗'];
  }
  if (h.includes('claude.ai')) {
    return ['让 Claude 分析这个网页的主要内容', '让 Claude 帮我润色一段邮件'];
  }
  if (h.includes('google.com') || h.includes('bing.com') || h.includes('baidu.com')) {
    return ['搜索"nano browser 是什么"，把第一条结果总结给我', '搜索今天的科技新闻头条'];
  }
  if (h.includes('github.com')) {
    return ['看看这个 repo 最近的 issue', '给这个仓库点 star'];
  }
  if (h.includes('youtube')) {
    return ['打开这个视频的字幕并总结', '搜一个关于 Rust 入门的视频'];
  }
  // 通用兜底
  return ['告诉我当前页面在讲什么', '帮我搜索一下「nanobrowser 怎么用」'];
}

export function EmptyStateCards({ onOpenTeaching, onTryExample }: EmptyStateCardsProps) {
  const [hostname, setHostname] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        setHostname(getHostnameFromUrl(active?.url));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const examples = exampleTasksFor(hostname);
  const cardClass =
    'group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all hover:bg-[var(--bg-card-hover)] hover:-translate-y-0.5';
  const cardStyle = { background: 'var(--bg-card)', borderColor: 'var(--border-color)' } as const;

  return (
    <div className="space-y-2 px-2 pb-3">
      <p className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        快速开始
      </p>

      {/* 卡片 1：教这个网站 */}
      <button type="button" onClick={onOpenTeaching} className={cardClass} style={cardStyle}>
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
          <FiBookOpen size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            🎓 教皮蛋认识这个网站
          </span>
          <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
            一次性把当前页面的按钮、输入框告诉它
          </span>
        </span>
      </button>

      {/* 卡片 2：用过的元素 */}
      <button
        type="button"
        onClick={() => {
          const url = chrome.runtime.getURL('options/index.html') + '?tab=memory';
          chrome.tabs.create({ url });
        }}
        className={cardClass}
        style={cardStyle}>
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
          <FiCpu size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            🧠 已经教过的元素
          </span>
          <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
            打开设置页查看 / 编辑元素记忆
          </span>
        </span>
      </button>

      {/* 卡片 3：示例任务 */}
      <div className="rounded-lg border p-3" style={cardStyle}>
        <div className="mb-2 flex items-center gap-2">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
            <FiZap size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              💡 试试这些任务
            </p>
            <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {hostname ? `针对 ${hostname}` : '通用建议'}
            </p>
          </div>
        </div>
        <ul className="space-y-1">
          {examples.map((ex, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onTryExample(ex)}
                className="w-full rounded border px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-card-hover)]"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
