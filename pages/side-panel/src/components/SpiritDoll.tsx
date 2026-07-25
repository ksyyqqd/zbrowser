/* eslint-disable react/prop-types */
import { useEffect, useRef, useState, useCallback } from 'react';
import { t } from '@extension/i18n';

export type SpiritMood = 'idle' | 'thinking' | 'working' | 'happy' | 'mischief' | 'sleepy' | 'curious' | 'explore';
export type ManualMode = 'auto' | 'explore';

export interface ExecutionStep {
  actor: string;
  content: string;
}

interface SpiritDollProps {
  isDarkMode?: boolean;
  isExecuting?: boolean;
  currentStep?: ExecutionStep | null;
  onAutonomousAction?: (action: string, data?: string) => void;
  onModeChange?: (mode: ManualMode) => void;
}

const MAX_BUBBLE_LENGTH = 300;

const truncateText = (text: string, maxLength: number = MAX_BUBBLE_LENGTH): string =>
  text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;

const MODE_CONFIG: Record<ManualMode, { label: string; icon: string; desc: string; mood: SpiritMood }> = {
  auto: {
    label: t('spirit_mode_auto_label'),
    icon: '●',
    desc: t('spirit_mode_auto_desc'),
    mood: 'idle',
  },
  explore: {
    label: t('spirit_mode_explore_label'),
    icon: '🔍',
    desc: t('spirit_mode_explore_desc'),
    mood: 'explore',
  },
};

const AUTO_STATUS: Record<Exclude<SpiritMood, 'explore'>, string> = {
  idle: t('spirit_mode_auto_status_idle'),
  thinking: t('spirit_mode_auto_status_thinking'),
  working: t('spirit_mode_auto_status_working'),
  happy: t('spirit_mode_auto_status_happy'),
  mischief: t('spirit_mode_auto_status_mischief'),
  sleepy: t('spirit_mode_auto_status_sleepy'),
  curious: t('spirit_mode_auto_status_curious'),
};

const ACTOR_LABELS: Record<string, string> = {
  planner: t('spirit_actor_planner'),
  navigator: t('spirit_actor_navigator'),
  validator: t('spirit_actor_validator'),
  user: t('spirit_actor_user'),
  system: t('spirit_actor_system'),
};

const OVERLAY_BUTTONS = [
  {
    key: 'fireworks',
    label: t('spirit_overlay_fireworks_label'),
    title: t('spirit_overlay_fireworks_title'),
    icon: '🎆',
  },
  { key: 'write', label: t('spirit_overlay_write_label'), title: t('spirit_overlay_write_title'), icon: '✏️' },
  {
    key: 'celebrate',
    label: t('spirit_overlay_celebrate_label'),
    title: t('spirit_overlay_celebrate_title'),
    icon: '🎉',
  },
];

function SpiritAvatar({ mood, isDarkMode }: { mood: SpiritMood; isDarkMode: boolean }) {
  const primary =
    mood === 'happy' ? '#F59E0B' : mood === 'sleepy' ? '#A78BFA' : mood === 'curious' ? '#EC4899' : '#40916C';
  const face = isDarkMode ? '#1C1A17' : '#FFFDF9';
  const stroke = isDarkMode ? '#E8E4DE' : '#1C1917';
  const mouth =
    mood === 'happy'
      ? 'M11 20 Q15 24 19 20'
      : mood === 'sleepy'
        ? 'M12 21 Q15 21 18 21'
        : mood === 'mischief'
          ? 'M11 21 Q15 18 19 21'
          : mood === 'curious'
            ? 'M13.5 19.5 A1.5 1.5 0 1 0 16.5 19.5 A1.5 1.5 0 1 0 13.5 19.5'
            : 'M12 20 Q15 22 18 20';

  return (
    <svg viewBox="0 0 30 30" className="size-12">
      <circle cx="15" cy="15" r="13.5" fill="none" stroke={primary} strokeWidth="0.4" opacity="0.3" />
      <circle cx="15" cy="15" r="12" fill={face} stroke={primary} strokeWidth="0.8" />
      <circle cx="12" cy="15.5" r="2.8" fill={stroke} opacity="0.08" />
      <circle cx="18" cy="15.5" r="2.8" fill={stroke} opacity="0.08" />
      <circle cx="12" cy="15.5" r="1.6" fill={stroke} />
      <circle cx="18" cy="15.5" r="1.6" fill={stroke} />
      <path d={mouth} fill="none" stroke={stroke} strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

const SpiritDoll: React.FC<SpiritDollProps> = ({
  isDarkMode = false,
  isExecuting = false,
  currentStep = null,
  onAutonomousAction,
  onModeChange,
}) => {
  const [mood, setMood] = useState<SpiritMood>('idle');
  const [bubbleText, setBubbleText] = useState('');
  const [showBubble, setShowBubble] = useState(false);
  const [manualMode, setManualMode] = useState<ManualMode>('auto');
  const [showPanel, setShowPanel] = useState(false);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSpiritMessage = useCallback((nextMood: SpiritMood, text?: string) => {
    setMood(nextMood);
    setBubbleText(
      text ||
        (nextMood === 'explore' ? MODE_CONFIG.explore.desc : AUTO_STATUS[nextMood as Exclude<SpiritMood, 'explore'>]),
    );
    setShowBubble(true);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => setShowBubble(false), nextMood === 'sleepy' ? 4000 : 3000);
  }, []);

  const handleModeChange = useCallback(
    (mode: ManualMode) => {
      setManualMode(mode);
      setShowPanel(false);
      onModeChange?.(mode);
      showSpiritMessage(MODE_CONFIG[mode].mood, MODE_CONFIG[mode].desc);
    },
    [onModeChange, showSpiritMessage],
  );

  useEffect(() => {
    if (isExecuting && currentStep) {
      const actor = ACTOR_LABELS[currentStep.actor] || currentStep.actor;
      setMood(currentStep.actor === 'navigator' ? 'working' : currentStep.actor === 'planner' ? 'thinking' : 'curious');
      setBubbleText(`[${actor}] ${currentStep.content}`);
      setShowBubble(true);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      return;
    }

    if (isExecuting && !currentStep) {
      showSpiritMessage('working', t('spirit_mode_executing'));
      return;
    }

    showSpiritMessage('happy', t('spirit_mode_done'));
  }, [isExecuting, currentStep, showSpiritMessage]);

  useEffect(() => {
    autoTimerRef.current = setTimeout(() => {
      if (!isExecuting && manualMode === 'auto') {
        const moods: SpiritMood[] = ['idle', 'curious', 'thinking'];
        showSpiritMessage(moods[Math.floor(Math.random() * moods.length)]);
      }
    }, 8000);

    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    };
  }, [isExecuting, manualMode, showSpiritMessage]);

  return (
    <div className="relative">
      <div className="flex items-center gap-3 px-3 py-1.5">
        <div
          onClick={() => setShowPanel(v => !v)}
          className="relative cursor-pointer"
          title={t('spirit_avatar_toggle_a11y')}>
          <SpiritAvatar mood={mood} isDarkMode={isDarkMode} />
          {manualMode !== 'auto' && (
            <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-red-500" />
          )}
        </div>

        <div className="flex flex-col items-start">
          {showBubble && bubbleText && (
            <div className={`spirit-bubble ${mood === 'mischief' || mood === 'idle' ? 'chatting' : ''}`}>
              {truncateText(bubbleText)}
            </div>
          )}
          {!showBubble && (
            <span className="spirit-status text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {manualMode !== 'auto'
                ? `[${MODE_CONFIG[manualMode].label}${t('spirit_mode_suffix')}]`
                : AUTO_STATUS[mood as Exclude<SpiritMood, 'explore'>]}
            </span>
          )}
        </div>

        <button
          onClick={() => setShowPanel(v => !v)}
          className="ml-auto rounded-md p-1 transition-transform duration-200 hover:bg-[var(--bg-secondary)]"
          style={{ color: 'var(--text-muted)' }}
          aria-label={t('spirit_avatar_toggle_a11y')}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform duration-200 ${showPanel ? 'rotate-180' : ''}`}>
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {showPanel && (
        <div
          className="mx-2 mb-1.5 rounded-lg p-2 paper-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-md)',
          }}>
          <div
            className="mb-1.5 px-1 text-[10px] font-medium"
            style={{ color: isDarkMode ? '#95D5B2' : '#78716C', letterSpacing: '0.05em' }}>
            {t('spirit_panel_title')}
          </div>

          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(MODE_CONFIG) as ManualMode[]).map(mode => {
              const cfg = MODE_CONFIG[mode];
              const isActive = manualMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => handleModeChange(mode)}
                  className="flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 transition-all duration-200 hover:bg-[var(--bg-card-hover)]"
                  style={{
                    borderColor: isActive ? 'var(--accent-color)' : 'transparent',
                    background: isActive ? 'var(--accent-glow)' : 'transparent',
                    color: isActive ? 'var(--accent-color)' : isDarkMode ? '#A8A29E' : '#78716C',
                  }}>
                  <span className="text-sm leading-none">{cfg.icon}</span>
                  <span className="text-[9px] font-medium leading-none">{cfg.label}</span>
                </button>
              );
            })}
          </div>

          <p className="mt-1.5 px-1 text-[9px]" style={{ color: isDarkMode ? '#95D5B2' : '#A8A29E', opacity: 0.85 }}>
            {MODE_CONFIG[manualMode].desc}
          </p>

          <div className="mt-1.5 flex gap-1 px-1">
            {OVERLAY_BUTTONS.map(btn => (
              <button
                key={btn.key}
                onClick={() => onAutonomousAction?.(`overlay-${btn.key}`)}
                className="flex-1 rounded-md border px-1 py-1 text-[8px] transition-all duration-200"
                style={{
                  borderColor: 'var(--border-color)',
                  color: isDarkMode ? '#95D5B2' : '#78716C',
                  background: 'transparent',
                }}
                title={btn.title}>
                {btn.icon} {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SpiritDoll;
