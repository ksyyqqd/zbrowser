/* eslint-disable react/prop-types */
import { useState, useEffect, useCallback, useRef } from 'react';

/* ================================================
   宠物皮蛋 BallPet
   浏览器宠物 — 圆滚滚的小皮蛋，会蹦跳、撒娇、捣乱

   表情状态：
   idle      → 静待指令，悠闲弹跳
   thinking  → 思考主人想干嘛
   working   → 正在执行任务（翻页/点击等）
   happy     → 任务完成，开心摇尾巴
   mischief  → 捣乱模式（滚来滚去等）
   sleepy    → 等太久打瞌睡
   curious   → 好奇到处嗅

   手动模式：
   auto      → 自动（默认，空闲时自主行为）
   mischief  → 捣乱模式
   sleepy    → 休眠模式（蜷缩睡觉）
   curious   → 好奇模式（四处探索）
================================================ */

// 截断文本，最多显示 MAX_LENGTH 个字符
const MAX_BUBBLE_LENGTH = 300;
const truncateText = (text: string, maxLength: number = MAX_BUBBLE_LENGTH): string => {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
};

export type SpiritMood = 'idle' | 'thinking' | 'working' | 'happy' | 'mischief' | 'sleepy' | 'curious' | 'farmer';
export type ManualMode = 'auto' | 'mischief' | 'sleepy' | 'curious' | 'farmer';

// 当前执行步骤信息
export interface ExecutionStep {
  actor: string;
  content: string;
}

interface SpiritDollProps {
  isDarkMode?: boolean;
  isExecuting?: boolean;
  /** 当前正在执行的步骤（用于在气泡中显示） */
  currentStep?: ExecutionStep | null;
  onAutonomousAction?: (action: string, data?: string) => void;
  /** 模式变化回调，通知父组件当前模式 */
  onModeChange?: (mode: ManualMode) => void;
}

// 手动模式配置
const MODE_CONFIG: Record<ManualMode, { label: string; icon: string; desc: string; mood: SpiritMood }> = {
  auto: { label: '自动', icon: '◈', desc: '皮蛋自主玩耍~', mood: 'idle' },
  mischief: { label: '捣乱', icon: '✦', desc: '皮蛋要捣蛋啦！', mood: 'mischief' },
  sleepy: { label: '睡觉', icon: '☾', desc: '皮蛋困了想睡...', mood: 'sleepy' },
  curious: { label: '探索', icon: '◎', desc: '皮蛋到处嗅嗅~', mood: 'curious' },
  farmer: { label: '农场主', icon: '🌾', desc: '皮蛋去各个AI农场采集信息~', mood: 'farmer' },
};

// 宠物皮蛋闲聊/撒娇语料库 — 按场景分类
const SPIRIT_LINES: Record<SpiritMood, string[]> = {
  idle: [
    '主人主人，今天要带皮蛋去哪里玩呀？',
    '皮蛋已经准备好了！弹跳中~',
    '这方寸屏幕，就是皮蛋的游乐场！',
    '等主人的指令哦，皮蛋随时待命~',
    '嗯...今天的屏幕好像特别亮呢~',
  ],
  thinking: [
    '皮蛋在想...主人到底想要什么呢...',
    '让皮蛋转一转小脑袋想想...',
    '嗯...这里面一定有玄机！',
    '皮蛋思考中...咕噜咕噜转圈...',
  ],
  working: [
    '皮蛋努力干活中！💪',
    '正在滚动页面...皮蛋滚得好快！',
    '执行任务ing... ⚡',
    '莫急莫急，皮蛋手脚麻利着呢~',
    '翻山越岭只为主人所托~',
  ],
  happy: [
    '太棒啦！任务完成！🎉',
    '嘿嘿，皮蛋果然是最棒的！',
    '求摸摸！求夸奖！✨',
    '主人快看，成果出来啦！',
    '今日份的乖巧已送达~ 🐾',
  ],
  mischief: [
    '哎呀，手滑了一下~ 😜',
    '这个页面...皮蛋觉得该滚一滚了',
    '让皮蛋来点小小的"意外"~',
    '嘘...主人没看见吧？👀',
    '这个按钮看起来很好滚的样子...',
  ],
  sleepy: [
    'zzZ... 主人...还在吗...',
    '(小声) 好困啊...皮蛋眼皮打架了...',
    '...呼...皮蛋打个盹...',
    '💤 ...梦到骨头在天上飞...',
  ],
  curious: [
    '咦？这是什么有趣的地方？',
    '哦豁！皮蛋发现新大陆！',
    '让皮蛋仔细嗅嗅这里...',
    '有意思...主人可知此处有何宝藏？',
  ],
  farmer: [
    '皮蛋出发啦！去DeepSeek挖点宝藏~',
    '千问农场有好货！皮蛋去看看...',
    'GLM这块地不错，皮蛋来嗅嗅~',
    'Kimi的农场真热闹！',
    '皮蛋要把各个AI农场的精华都带回来！',
  ],
};

// SVG 器灵形象 — 根据心情变化表情和颜色
type EyeLookDir = 'center' | 'left' | 'right' | 'up' | 'down';
function SpiritAvatar({
  mood,
  isDarkMode,
  isBlinking,
  eyeLookDir,
}: {
  mood: SpiritMood;
  isDarkMode: boolean;
  isBlinking?: boolean;
  eyeLookDir?: EyeLookDir;
}) {
  // 根据心情决定颜色和眼睛状态
  const colorMap: Record<SpiritMood, { primary: string; glow: string; cheek?: string }> = {
    idle: { primary: '#40916C', glow: 'rgba(64,145,108,0.25)', cheek: '#74C69D33' },
    thinking: { primary: '#8B7355', glow: 'rgba(139,115,85,0.2)' }, // 中性墨棕色（认真）
    working: { primary: '#6B7280', glow: 'rgba(107,114,128,0.2)' }, // 中性灰（专注）
    happy: { primary: '#F59E0B', glow: 'rgba(245,158,11,0.25)', cheek: '#FCA5A555' },
    mischief: { primary: '#EF4444', glow: 'rgba(239,68,68,0.2)', cheek: '#F8717144' },
    sleepy: { primary: '#A78BFA', glow: 'rgba(167,139,250,0.18)' },
    curious: { primary: '#EC4899', glow: 'rgba(236,72,153,0.2)' },
    farmer: { primary: '#10B981', glow: 'rgba(16,185,129,0.25)', cheek: '#A7F3D033' }, // 翠绿色（农作物）
  };
  const c = colorMap[mood];

  // 眨眼：外部传入的眨眼状态 或 sleepy 固定闭眼
  const shouldCloseEyes = isBlinking || mood === 'sleepy';

  // ===== 眼球移动系统 =====
  // 左眼眶中心 (12, 15.5)，右眼眶中心 (18, 15.5)
  // 瞳孔在眼眶内偏移，模拟大眼球转动
  const lookOffset: Record<EyeLookDir, { dx: number; dy: number }> = {
    center: { dx: 0, dy: 0 },
    left: { dx: -1.3, dy: 0 },
    right: { dx: 1.3, dy: 0 },
    up: { dx: 0, dy: -1.1 },
    down: { dx: 0, dy: 1.1 },
  };
  const off = lookOffset[eyeLookDir || 'center'];

  // 嘴巴根据心情变化 — 执行中为中性认真
  const mouthPaths: Record<string, string> = {
    idle: 'M12 20 Q15 22 18 20', // 悠闲微弧
    thinking: 'M12 20.5 Q15 20.5 18 20.5', // 认真平直（中性）
    working: 'M12 20.5 Q15 20.5 18 20.5', // 专注平直（中性）
    happy: 'M11 20 Q15 24 19 20', // 微笑
    mischief: 'M11 21 Q15 18 19 21', // 坏笑
    sleepy: 'M12 21 Q15 21 18 21', // 平淡
    curious: 'M13.5 19.5 A1.5 1.5 0 1 0 16.5 19.5 A1.5 1.5 0 1 0 13.5 19.5', // 小o嘴（用椭圆弧线）
    farmer: 'M12 21 Q15 23 18 21', // 微笑带得意
  };

  return (
    <div className="spirit-container">
      {/* 光晕背景 */}
      <div
        className="absolute inset-0 rounded-full animate-[aura-spread_4s_ease-in-out_infinite]"
        style={{
          background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)`,
          transform: 'scale(2)',
        }}
      />
      {/* 器灵本体 */}
      <svg
        viewBox="0 0 30 30"
        className={`relative z-10 size-12 transition-all duration-500 ${
          mood === 'sleepy' ? 'animate-spirit-breathe opacity-80' : 'animate-spirit-float'
        }`}
        style={{ filter: `drop-shadow(0 0 10px ${c.glow})` }}>
        {/* 外圈光晕 */}
        <circle cx="15" cy="15" r="13.5" fill="none" stroke={c.primary} strokeWidth="0.4" opacity="0.3" />
        {/* 身体 — 圆润的灵体 */}
        <circle cx="15" cy="15" r="12" fill={isDarkMode ? '#1C1A17' : '#FFFDF9'} stroke={c.primary} strokeWidth="0.8" />
        {/* 腮红 — 仅非执行状态显示 */}
        {c.cheek && !['thinking', 'working'].includes(mood) && (
          <>
            <circle cx="9" cy="18" r="2.2" fill={c.cheek} />
            <circle cx="21" cy="18" r="2.2" fill={c.cheek} />
          </>
        )}

        {/* ===== 眼睛：大眼球 + 可移动瞳孔 ===== */}
        {!shouldCloseEyes ? (
          <>
            {/* --- 左眼 --- */}
            {/* 眼白（眼眶） */}
            <circle
              cx="12"
              cy="15.5"
              r="2.8"
              fill={isDarkMode ? '#E8E4DE' : '#1C1917'}
              opacity="0.06"
              stroke={isDarkMode ? '#E8E4DE' : '#1C1917'}
              strokeWidth="0.5"
            />
            {/* 瞳孔 — 跟随方向偏移 */}
            <circle cx={12 + off.dx} cy={15.5 + off.dy} r="1.6" fill={isDarkMode ? '#E8E4DE' : '#1C1917'} />
            {/* 高光点 — 跟随瞳孔偏移（略靠右上） */}
            <circle cx={12 + off.dx + 0.45} cy={15.5 + off.dy - 0.5} r="0.55" fill="#FFF" opacity="0.85" />

            {/* --- 右眼 --- */}
            {/* 眼白（眼眶） */}
            <circle
              cx="18"
              cy="15.5"
              r="2.8"
              fill={isDarkMode ? '#E8E4DE' : '#1C1917'}
              opacity="0.06"
              stroke={isDarkMode ? '#E8E4DE' : '#1C1917'}
              strokeWidth="0.5"
            />
            {/* 瞳孔 */}
            <circle cx={18 + off.dx} cy={15.5 + off.dy} r="1.6" fill={isDarkMode ? '#E8E4DE' : '#1C1917'} />
            {/* 高光点 */}
            <circle cx={18 + off.dx + 0.45} cy={15.5 + off.dy - 0.5} r="0.55" fill="#FFF" opacity="0.85" />
          </>
        ) : (
          /* 闭眼弧线 */
          <g>
            <path
              d="M9.2 16 Q12 13.5 14.8 16"
              strokeLinecap="round"
              strokeWidth="1.2"
              fill="none"
              stroke={isDarkMode ? '#E8E4DE' : '#1C1917'}
            />
            <path
              d="M15.2 16 Q18 13.5 20.8 16"
              strokeLinecap="round"
              strokeWidth="1.2"
              fill="none"
              stroke={isDarkMode ? '#E8E4DE' : '#1C1917'}
            />
          </g>
        )}

        {/* 嘴巴 */}
        <path
          d={mouthPaths[mood]}
          fill="none"
          stroke={isDarkMode ? '#E8E4DE' : '#1C1917'}
          strokeWidth="0.9"
          strokeLinecap="round"
        />

        {/* 特殊装饰 */}
        {mood === 'mischief' && (
          // 恶作剧角
          <path d="M4 8 L6 4 M26 8 L24 4" stroke="#EF4444" strokeWidth="0.7" strokeLinecap="round" opacity="0.5" />
        )}
        {mood === 'happy' && (
          // 开心星星
          <g>
            <path d="M23 6 L23.8 8.2 L26 9 L23.8 9.8 L23 12 L22.2 9.8 L20 9 L22.2 8.2 Z" fill="#FBBF24" opacity="0.8" />
            <path d="M5 7.5 L5.5 8.8 L7 9.2 L5.5 9.6 L5 11 L4.5 9.6 L3 9.2 L4.5 8.8 Z" fill="#FBBF24" opacity="0.5" />
          </g>
        )}
        {mood === 'sleepy' && (
          // Zzz
          <g>
            <text x="21" y="8" fontSize="4" fill="#A78BFA" opacity="0.6">
              z
            </text>
            <text x="24" y="5" fontSize="3" fill="#A78BFA" opacity="0.4">
              z
            </text>
          </g>
        )}
        {mood === 'curious' && (
          // 问号
          <text x="22" y="9" fontSize="5" fill="#EC4899" opacity="0.6">
            ?
          </text>
        )}
        {mood === 'farmer' && (
          // 小麦装饰
          <text x="23" y="7" fontSize="4" fill="#10B981" opacity="0.7">
            🌾
          </text>
        )}
      </svg>
    </div>
  );
}

// 主组件
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
  // 空闲动画状态
  const [isBlinking, setIsBlinking] = useState(false);
  const [eyeLookDir, setEyeLookDir] = useState<EyeLookDir>('center');
  // 手动模式
  const [manualMode, setManualMode] = useState<ManualMode>('auto');
  const [showPanel, setShowPanel] = useState(false);
  const mischiefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 定时器 refs
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autonomousEnabledRef = useRef(true);

  // Actor → 器灵心情映射
  const actorToMood = (actor: string): SpiritMood => {
    switch (actor) {
      case 'planner':
        return 'thinking'; // 规划中 → 思考形态
      case 'navigator':
        return 'working'; // 导航执行 → 行动状态
      case 'validator':
        return 'curious'; // 验证中 → 好奇观察
      default:
        return 'working';
    }
  };

  // Actor 中文名映射（用于气泡显示）
  const actorLabel: Record<string, string> = {
    planner: '规划中',
    navigator: '行动中',
    validator: '验证中',
    user: '主人',
    system: '系统',
  };

  // 显示气泡
  const showSpiritMessage = useCallback((m: SpiritMood, text?: string) => {
    setMood(m);
    if (text) {
      setBubbleText(text);
      setShowBubble(true);
    } else if (SPIRIT_LINES[m]) {
      const lines = SPIRIT_LINES[m];
      setBubbleText(lines[Math.floor(Math.random() * lines.length)]);
      setShowBubble(true);
    }
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    const duration = m === 'sleepy' ? 4000 : m === 'mischief' ? 3500 : 3000;
    bubbleTimerRef.current = setTimeout(() => setShowBubble(false), duration);
  }, []);

  // ===== 手动模式切换 =====
  const handleModeChange = useCallback(
    (mode: ManualMode) => {
      setManualMode(mode);
      setShowPanel(false);

      // 通知父组件模式变化
      onModeChange?.(mode);

      // 清理捣乱定时器
      if (mischiefTimerRef.current) {
        clearTimeout(mischiefTimerRef.current);
        mischiefTimerRef.current = null;
      }

      if (mode === 'auto') {
        // 回到自动模式，显示切换提示
        showSpiritMessage('idle', '皮蛋恢复自动玩耍~');
        return;
      }

      const config = MODE_CONFIG[mode];
      setMood(config.mood);
      setBubbleText(config.desc);
      setShowBubble(true);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);

      if (mode === 'mischief') {
        // 捣乱模式：每 4-8 秒触发一次滚动
        onAutonomousAction?.('scroll-page');
        const scheduleMischief = () => {
          const delay = 4000 + Math.random() * 4000;
          mischiefTimerRef.current = setTimeout(() => {
            if (manualMode !== 'mischief') return; // 模式已切换则停止
            onAutonomousAction?.('scroll-page');
            showSpiritMessage('mischief');
            scheduleMischief();
          }, delay);
        };
        scheduleMischief();
      } else if (mode === 'sleepy') {
        bubbleTimerRef.current = setTimeout(() => setShowBubble(false), 3000);
      } else if (mode === 'curious') {
        bubbleTimerRef.current = setTimeout(() => setShowBubble(false), 3000);
      } else if (mode === 'farmer') {
        // 农场主模式：显示提示，等待用户输入
        showSpiritMessage('farmer', '农场主模式已开启，请输入您的任务~');
        bubbleTimerRef.current = setTimeout(() => setShowBubble(false), 4000);
      }
    },
    [onAutonomousAction, showSpiritMessage, onModeChange],
  );

  // 自主行为系统 — 仅在非执行状态 + 自动模式下触发
  const triggerAutonomousBehavior = useCallback(() => {
    if (!autonomousEnabledRef.current || isExecuting || currentStep || manualMode !== 'auto') return;

    // 自动模式：仅做表情/气泡动画，不发射皮蛋实体（实体仅在捣乱模式下触发）
    const actions = [
      () => showSpiritMessage('idle'),
      () => showSpiritMessage('curious'),
      () => showSpiritMessage('mischief'), // 只显示捣乱表情，不发 scroll-page
      () => showSpiritMessage('sleepy'),
    ];
    const weights = [48, 32, 12, 8]; // 调整权重（去掉 scroll-page 后 idle 分配多余权重）
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;
    let actionIdx = 0;
    for (let i = 0; i < weights.length; i++) {
      rand -= weights[i];
      if (rand <= 0) {
        actionIdx = i;
        break;
      }
    }
    actions[actionIdx]();
  }, [isExecuting, currentStep, manualMode, onAutonomousAction, showSpiritMessage]);

  // ===== 核心：根据当前执行步骤动态更新器灵状态 =====
  useEffect(() => {
    if (isExecuting && currentStep) {
      // 有具体步骤时：根据 actor 切换心情 + 在气泡中显示步骤内容
      const stepMood = actorToMood(currentStep.actor);
      setMood(stepMood);

      // 格式化显示内容：actor标签 + 步骤描述
      const label = actorLabel[currentStep.actor] || currentStep.actor;
      const displayText = `【${label}】${currentStep.content}`;
      setBubbleText(displayText);
      setShowBubble(true);

      // 气泡持续显示，不自动消失（直到下一步到来）
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    } else if (isExecuting && !currentStep) {
      // 正在执行但还没有步骤信息
      const moods: SpiritMood[] = ['working', 'thinking'];
      setMood(moods[Math.floor(Math.random() * moods.length)]);
      setBubbleText(SPIRIT_LINES.working[Math.floor(Math.random() * SPIRIT_LINES.working.length)]);
      setShowBubble(true);
    } else {
      // 执行完成
      showSpiritMessage('happy');
    }
  }, [isExecuting, currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自主行为定时器 — 空闲时才触发
  useEffect(() => {
    autoTimerRef.current = setTimeout(() => {
      triggerAutonomousBehavior();
      const scheduleNext = () => {
        const delay = 15000 + Math.random() * 20000;
        autoTimerRef.current = setTimeout(() => {
          triggerAutonomousBehavior();
          scheduleNext();
        }, delay);
      };
      scheduleNext();
    }, 8000);

    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      if (mischiefTimerRef.current) {
        clearTimeout(mischiefTimerRef.current);
        mischiefTimerRef.current = null;
      }
    };
  }, [triggerAutonomousBehavior]);

  // ===== 空闲动画：眨眼效果 =====
  // 每 2~5 秒随机眨一次，持续 120ms
  useEffect(() => {
    const scheduleBlink = () => {
      const delay = 2000 + Math.random() * 3000;
      blinkTimerRef.current = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => setIsBlinking(false), 120);
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    };
  }, []);

  // ===== 空闲动画：眼球四处张望 =====
  // 每 3~8 秒随机换个方向，停留一段时间后回到 center
  useEffect(() => {
    const directions: EyeLookDir[] = ['left', 'right', 'up', 'down'];
    const scheduleLook = () => {
      const delay = 3000 + Math.random() * 5000;
      lookTimerRef.current = setTimeout(() => {
        // 40% 概率保持 center（不动），60% 概率看向某个方向
        if (Math.random() < 0.6) {
          const dir = directions[Math.floor(Math.random() * directions.length)];
          setEyeLookDir(dir);
          // 停留 800~2000ms 后回正
          setTimeout(() => setEyeLookDir('center'), 800 + Math.random() * 1200);
        }
        scheduleLook();
      }, delay);
    };
    scheduleLook();
    return () => {
      if (lookTimerRef.current) clearTimeout(lookTimerRef.current);
    };
  }, []);

  // 控制面板按钮样式
  const modeBtnClass = (mode: ManualMode) => {
    const isActive = manualMode === mode;
    const base =
      'flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 cursor-pointer border';
    if (isActive) {
      return `${base} spirit-mode-active`;
    }
    return `${base} hover:bg-[var(--bg-card-hover)]`;
  };

  return (
    <div className="relative">
      {/* 主栏：器灵头像 + 气泡 + 状态切换按钮 */}
      <div className="flex items-center gap-3 py-1.5 px-3">
        {/* 皮蛋头像 — 点击展开/收起面板 */}
        <div onClick={() => setShowPanel(!showPanel)} className="cursor-pointer relative" title="点击切换皮蛋状态">
          <SpiritAvatar mood={mood} isDarkMode={isDarkMode} isBlinking={isBlinking} eyeLookDir={eyeLookDir} />
          {/* 当前模式小指示点 */}
          {manualMode !== 'auto' && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-500 animate-pulse" />
          )}
        </div>

        {/* 对话气泡 + 状态 */}
        <div className="flex flex-col items-start">
          {showBubble && bubbleText && (
            <div className={`spirit-bubble ${mood === 'mischief' || mood === 'idle' ? 'chatting' : ''}`}>
              {truncateText(bubbleText)}
            </div>
          )}
          {/* 心情状态文字 / 模式标签 */}
          {!showBubble && (
            <span className="spirit-status text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {manualMode !== 'auto'
                ? `[${MODE_CONFIG[manualMode].label}模式]`
                : (mood === 'idle' && '待命中') ||
                  (mood === 'thinking' && '思考中...') ||
                  (mood === 'working' && '努力干活！') ||
                  (mood === 'happy' && '开心摇尾巴') ||
                  (mood === 'mischief' && '暗中捣蛋') ||
                  (mood === 'sleepy' && '打盹中...') ||
                  (mood === 'curious' && '到处嗅嗅')}
            </span>
          )}
        </div>

        {/* 面板展开/收起箭头 */}
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="ml-auto p-1 rounded-md transition-transform duration-200 hover:bg-[var(--bg-secondary)]"
          style={{ color: 'var(--text-muted)' }}>
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

      {/* ===== 器灵状态切换面板 ===== */}
      {showPanel && (
        <div
          className="mx-2 mb-1.5 p-2 rounded-lg paper-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-md)',
            animation: 'fade-in-up 0.25s ease-out',
          }}>
          {/* 标题 */}
          <div
            className="text-[10px] font-medium mb-1.5 px-1"
            style={{ color: isDarkMode ? '#95D5B2' : '#78716C', letterSpacing: '0.05em' }}>
            · 皮蛋状态 ·
          </div>
          {/* 模式按钮网格 */}
          <div className="grid grid-cols-4 gap-1">
            {(Object.keys(MODE_CONFIG) as ManualMode[]).map(mode => {
              const cfg = MODE_CONFIG[mode];
              const isActive = manualMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => handleModeChange(mode)}
                  className={modeBtnClass(mode)}
                  style={{
                    borderColor: isActive ? 'var(--accent-color)' : 'transparent',
                    background: isActive ? 'var(--accent-glow)' : 'transparent',
                    ...(isActive ? {} : {}),
                  }}>
                  <span
                    className="text-sm leading-none"
                    style={{ color: isActive ? 'var(--accent-color)' : isDarkMode ? '#A8A29E' : '#78716C' }}>
                    {cfg.icon}
                  </span>
                  <span
                    className="text-[9px] leading-none font-medium"
                    style={{ color: isActive ? 'var(--accent-color)' : isDarkMode ? '#A8A29E' : '#78716C' }}>
                    {cfg.label}
                  </span>
                </button>
              );
            })}
          </div>
          {/* 模式描述 */}
          <p className="mt-1.5 text-[9px] px-1" style={{ color: isDarkMode ? '#95D5B2' : '#A8A29E', opacity: 0.85 }}>
            {MODE_CONFIG[manualMode].desc}
          </p>
          {/* 遮罩效果快捷按钮 */}
          <div className="mt-1.5 flex gap-1 px-1">
            {[
              { key: 'fireworks', label: '烟花', icon: '\u{1F386}' },
              { key: 'write', label: '写字', icon: '\u270F\uFE0F' },
              { key: 'celebrate', label: '庆祝', icon: '\u{1F389}' },
            ].map(btn => (
              <button
                key={btn.key}
                onClick={() => onAutonomousAction?.(`overlay-${btn.key}`)}
                className="flex-1 rounded-md px-1 py-1 text-[8px] transition-all duration-200 cursor-pointer border"
                style={{
                  borderColor: 'var(--border-color)',
                  color: isDarkMode ? '#95D5B2' : '#78716C',
                  background: 'transparent',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--accent-glow)';
                  e.currentTarget.style.borderColor = 'var(--accent-color)';
                  e.currentTarget.style.color = 'var(--accent-color)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.color = isDarkMode ? '#95D5B2' : '#78716C';
                }}
                title={`${btn.label}效果`}>
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
