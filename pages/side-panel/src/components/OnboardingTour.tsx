/**
 * 新功能首次启动引导浮层（3 步）
 *
 * 数据源：generalSettingsStore.onboardingSeen
 *   - undefined / false → 挂载
 *   - true → 不挂载
 *
 * 完成或跳过都会 updateSettings({ onboardingSeen: true }) 永久关闭。
 *
 * 设计：纯遮罩浮层，不依赖具体按钮位置（教过几次想精确高亮 DOM 但需要 ref 透传，太重）；
 * 用文字 + 图标说明各功能位置就够了。
 */

import { useEffect, useState } from 'react';
import { FiX, FiAtSign, FiBookOpen, FiCpu, FiArrowRight } from 'react-icons/fi';
import { generalSettingsStore } from '@extension/storage';

interface OnboardingTourProps {
  /** 跳过/完成后回调（用于父级把内部 show flag 置 false） */
  onDone: () => void;
}

interface Step {
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: '@ 引用页面元素',
    icon: <FiAtSign size={24} />,
    body: (
      <>
        在<strong>聊天输入框工具栏左上角</strong>找到 <FiAtSign className="inline" size={13} /> 按钮，
        可以选择已记的页面元素 / 现场拾取新的。这样 AI 就能精确知道你说的是哪个按钮、哪个输入框， 不再凭描述猜。
      </>
    ),
  },
  {
    title: '教导模式',
    icon: <FiBookOpen size={24} />,
    body: (
      <>
        顶部栏 <FiBookOpen className="inline" size={13} /> 按钮 = <strong>教导模式</strong>。 点了之后 AI
        会扫描当前网页的所有可交互元素并猜测每个的用途，你审一遍勾选后批量保存。
        <br />
        <span style={{ color: 'var(--text-muted)' }}>适合刚到一个新网站，一次教完省得每次任务里都问。</span>
      </>
    ),
  },
  {
    title: '元素记忆',
    icon: <FiCpu size={24} />,
    body: (
      <>
        所有教过 / 拾取过的元素都存到了「元素记忆」库（按网站分组）。
        <br />
        想查看 / 编辑 / 清空 → 设置页 → 「元素记忆」标签页。
        <br />
        <span style={{ color: 'var(--text-muted)' }}>下次 AI 操作同一网站时会自动复用，confidence 直接 95%+。</span>
      </>
    ),
  },
];

export function OnboardingTour({ onDone }: OnboardingTourProps) {
  const [stepIdx, setStepIdx] = useState(0);

  const finish = async () => {
    try {
      await generalSettingsStore.updateSettings({ onboardingSeen: true });
    } catch {
      /* 写失败也不阻塞关闭 */
    }
    onDone();
  };

  // Esc 跳过
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center px-3"
      role="dialog"
      aria-modal="true"
      aria-label="新功能引导">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'rgba(15,14,12,0.6)' }} aria-hidden />
      <div
        className="relative z-10 flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            新功能介绍 · {stepIdx + 1} / {STEPS.length}
          </span>
          <button type="button" onClick={finish} className="icon-btn" aria-label="跳过引导">
            <FiX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 px-5 py-5">
          <div
            className="flex size-12 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
            {step.icon}
          </div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {step.title}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {step.body}
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={finish}
            className="text-xs hover:underline"
            style={{ color: 'var(--text-muted)' }}>
            跳过
          </button>
          <div className="flex items-center gap-2">
            {/* 步骤指示 */}
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className="block size-1.5 rounded-full transition-all"
                  style={{
                    background: i === stepIdx ? 'var(--accent-color)' : 'var(--border-color)',
                    width: i === stepIdx ? '12px' : '6px',
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => (isLast ? finish() : setStepIdx(i => i + 1))}
              className="jade-btn inline-flex items-center gap-1 px-4 py-1.5 text-sm">
              {isLast ? '开始用' : '下一步'}
              {!isLast && <FiArrowRight size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
