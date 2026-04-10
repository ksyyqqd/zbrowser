/**
 * 器灵遮罩层 - 页面注入脚本
 * 可在任意网页上覆盖半透明遮罩，用 Canvas 写字 + 放烟花
 * 通过 chrome.scripting.executeScript 注入页面执行
 */

// ========== 全局状态 ==========
let overlayContainer: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let animationId: number | null = null;
let fireworks: Firework[] = [];
let particles: Particle[] = [];
let writingTexts: WritingText[] = [];
let isOverlayActive = false;

// ========== 数据类型 ==========
interface Firework {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  angle: number;
  trail: { x: number; y: number }[];
  color: string;
  exploded: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
  size: number;
  decay: number;
  gravity: number;
}

interface WritingText {
  text: string;
  x: number;
  y: number;
  targetAlpha: number;
  currentAlpha: number;
  scale: number;
  rotation: number;
  color: string;
  font: string;
  birthTime: number;
  duration: number;
  type: 'calligraphy' | 'seal' | 'floating';
}

// ========== 颜色调色板（中式） ==========
const COLORS = {
  gold: '#D97706',
  red: '#DC2626',
  jade: '#40916C',
  purple: '#A78BFA',
  pink: '#EC4899',
  cyan: '#06B6D4',
  orange: '#F97316',
  white: '#FAF8F5',
};

const FIREWORK_COLORS = Object.values(COLORS);

// ========== 初始化遮罩层 ==========
function initOverlay() {
  if (overlayContainer) return overlayContainer;

  // 创建容器
  overlayContainer = document.createElement('div');
  overlayContainer.id = 'spirit-overlay-container';
  Object.assign(overlayContainer.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '2147483647', // 最大层级
    pointerEvents: 'none', // 不拦截鼠标事件（穿透）
    overflow: 'hidden',
  });

  // 创建 Canvas
  canvas = document.createElement('canvas');
  canvas.id = 'spirit-canvas';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  ctx = canvas!.getContext('2d')!;

  overlayContainer.appendChild(canvas);
  document.documentElement.appendChild(overlayContainer);

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize);

  isOverlayActive = true;
  startAnimation();

  return overlayContainer;
}

function handleResize() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ========== 动画主循环 ==========
function startAnimation() {
  if (animationId) cancelAnimationFrame(animationId);

  const loop = () => {
    if (!ctx || !canvas) return;
    // 清空画布（半透明以产生拖尾效果）
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 更新和绘制烟花
    updateFireworks();
    drawFireworks();
    updateParticles();
    drawParticles();

    // 更新和绘制文字
    updateWritingTexts();
    drawWritingTexts();

    animationId = requestAnimationFrame(loop);
  };
  loop();
}

function stopAnimation() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// ========== 烟花系统 ==========
function launchFirework(x?: number, y?: number) {
  if (!isOverlayActive) initOverlay();

  const startX = x ?? Math.random() * (canvas!.width * 0.6) + canvas!.width * 0.2;
  const startY = canvas!.height;
  const targetX = x ?? Math.random() * (canvas!.width * 0.7) + canvas!.width * 0.15;
  const targetY = y ?? Math.random() * (canvas!.height * 0.4) + canvas!.height * 0.1;
  const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];

  fireworks.push({
    x: startX,
    y: startY,
    targetX,
    targetY,
    speed: 3 + Math.random() * 3,
    angle: Math.atan2(targetY - startY, targetX - startX),
    trail: [],
    color,
    exploded: false,
  });
}

function launchMultipleFireworks(count: number = 5) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => launchFirework(), i * 200 + Math.random() * 300);
  }
}

function updateFireworks() {
  for (let i = fireworks.length - 1; i >= 0; i--) {
    const fw = fireworks[i];

    if (!fw.exploded) {
      // 上升阶段
      fw.x += Math.cos(fw.angle) * fw.speed;
      fw.y += Math.sin(fw.angle) * fw.speed;
      fw.trail.push({ x: fw.x, y: fw.y });
      if (fw.trail.length > 10) fw.trail.shift();

      // 到达目标高度，爆炸
      const dist = Math.hypot(fw.x - fw.targetX, fw.y - fw.targetY);
      if (dist < 15) {
        explode(fw);
        fireworks.splice(i, 1);
      }
    }
  }
}

function explode(fw: Firework) {
  const particleCount = 40 + Math.floor(Math.random() * 30);
  for (let i = 0; i < particleCount; i++) {
    const angle = ((Math.PI * 2) / particleCount) * i + Math.random() * 0.5;
    const speed = 1.5 + Math.random() * 4;
    particles.push({
      x: fw.x,
      y: fw.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      color: fw.color,
      size: 1.5 + Math.random() * 2.5,
      decay: 0.012 + Math.random() * 0.015,
      gravity: 0.04 + Math.random() * 0.02,
    });
  }

  // 内圈小粒子（更亮）
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 1.5;
    particles.push({
      x: fw.x,
      y: fw.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      color: COLORS.white,
      size: 1 + Math.random(),
      decay: 0.008,
      gravity: 0.02,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.alpha -= p.decay;
    p.vx *= 0.98;

    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }
}

function drawFireworks() {
  if (!ctx) return;
  for (const fw of fireworks) {
    if (fw.trail.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(fw.trail[0].x, fw.trail[0].y);
    for (let i = 1; i < fw.trail.length; i++) {
      ctx.lineTo(fw.trail[i].x, fw.trail[i].y);
    }
    ctx.strokeStyle = fw.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawParticles() {
  if (!ctx) return;
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.alpha;
    ctx.fill();

    // 发光效果
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

// ========== 写字系统（中式书法风格） ==========
function writeText(
  text: string,
  options: Partial<{
    x: number;
    y: number;
    color: string;
    fontSize: number;
    type: 'calligraphy' | 'seal' | 'floating';
    duration: number;
  }> = {},
) {
  if (!isOverlayActive) initOverlay();
  if (!canvas) return;

  const o = {
    x: options.x ?? canvas.width / 2 + (Math.random() - 0.5) * 200,
    y: options.y ?? canvas.height / 2 + (Math.random() - 0.5) * 150,
    color: options.color ?? [COLORS.gold, COLORS.red, COLORS.jade][Math.floor(Math.random() * 3)],
    fontSize: options.fontSize ?? 28 + Math.floor(Math.random() * 24),
    type: options.type ?? (['calligraphy', 'floating', 'seal'] as const)[Math.floor(Math.random() * 3)],
    duration: options.duration ?? 3000 + Math.random() * 3000,
  };

  writingTexts.push({
    text,
    x: o.x,
    y: o.y,
    targetAlpha: 1,
    currentAlpha: 0,
    scale: 0.3,
    rotation: (Math.random() - 0.5) * 0.15,
    color: o.color,
    font: `bold ${o.fontSize}px "Ma Shan Zheng", "STKaiti", "KaiTi", serif`,
    birthTime: Date.now(),
    duration: o.duration,
    type: o.type,
  });
}

function updateWritingTexts() {
  const now = Date.now();
  for (let i = writingTexts.length - 1; i >= 0; i--) {
    const wt = writingTexts[i];
    const age = now - wt.birthTime;

    if (age > wt.duration) {
      // 淡出
      wt.targetAlpha = 0;
      if (wt.currentAlpha <= 0.01) {
        writingTexts.splice(i, 1);
        continue;
      }
    } else if (age < 500) {
      // 淡入
      wt.currentAlpha = age / 500;
      wt.scale = 0.3 + (age / 500) * 0.7;
    }

    // 浮动文字的微动
    if (wt.type === 'floating') {
      wt.y += Math.sin(age * 0.002) * 0.3;
    }
  }
}

function drawWritingTexts() {
  if (!ctx || !canvas) return;

  for (const wt of writingTexts) {
    ctx.save();
    ctx.translate(wt.x, wt.y);
    ctx.rotate(wt.rotation);
    ctx.scale(wt.scale, wt.scale);
    ctx.globalAlpha = wt.currentAlpha;

    // 根据类型选择渲染方式
    switch (wt.type) {
      case 'calligraphy':
        // 书法风格：深色描边 + 墨迹填充
        ctx.font = wt.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 描边
        ctx.strokeStyle = 'rgba(28, 25, 23, 0.3)';
        ctx.lineWidth = 3;
        ctx.strokeText(wt.text, 0, 0);
        // 填充
        ctx.fillStyle = wt.color;
        ctx.fillText(wt.text, 0, 0);
        // 印章点缀（随机位置小方框）
        if (wt.text.length <= 4 && Math.random() > 0.5) {
          const sealSize = wt.fontSize * 0.35;
          ctx.save();
          ctx.rotate(-Math.PI / 6);
          ctx.fillStyle = COLORS.red;
          ctx.globalAlpha = wt.currentAlpha * 0.7;
          roundRect(ctx, wt.text.length * wt.fontSize * 0.35 + 8, sealSize * 0.5, sealSize, sealSize, 2);
          ctx.strokeStyle = COLORS.red;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.font = `${sealSize * 0.55}px serif`;
          ctx.fillStyle = COLORS.red;
          ctx.fillText('灵', wt.text.length * wt.fontSize * 0.35 + 8 + sealSize / 2, sealSize * 0.5 + sealSize * 0.68);
          ctx.restore();
        }
        break;

      case 'seal':
        // 篆章风格：红色印章方块
        const sealW = Math.max(40, wt.text.length * 22);
        const sealH = sealW;
        roundRect(ctx, -sealW / 2, -sealH / 2, sealW, sealH, 4);
        ctx.strokeStyle = COLORS.red;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.font = `bold ${Math.min(sealW * 0.55, 20)}px "STKaiti", "SimSun", serif`;
        ctx.fillStyle = COLORS.red;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 竖排或横排
        const chars = wt.text.split('');
        if (chars.length <= 2) {
          ctx.fillText(chars.join(''), 0, 0);
        } else {
          chars.forEach((ch, idx) => {
            ctx.fillText(ch, 0, -sealH * 0.28 + idx * ((sealH * 0.56) / (chars.length - 1)));
          });
        }
        break;

      case 'floating':
        // 漂浮文字：发光效果
        ctx.font = wt.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 外发光
        ctx.shadowColor = wt.color;
        ctx.shadowBlur = 15;
        ctx.fillStyle = wt.color;
        ctx.fillText(wt.text, 0, 0);
        // 内亮
        ctx.shadowBlur = 0;
        ctx.globalAlpha = wt.currentAlpha * 0.5;
        ctx.fillStyle = COLORS.white;
        ctx.font = wt.font.replace('bold ', '');
        ctx.fillText(wt.text, 0, 0);
        break;
    }

    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// 辅助函数：圆角矩形
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

// ========== 预设场景 ==========
/** 庆祝烟花秀 */
function showFireworksShow(duration: number = 6000) {
  if (!isOverlayActive) initOverlay();
  let elapsed = 0;
  const interval = setInterval(() => {
    const count = 1 + Math.floor(Math.random() * 3);
    launchMultipleFireworks(count);
    elapsed += 300;
    if (elapsed >= duration) clearInterval(interval);
  }, 250);
  setTimeout(() => clearInterval(interval), duration);
}

/** 写祝福语 */
function writeBlessings(texts: string[]) {
  if (!isOverlayActive) initOverlay();
  texts.forEach((text, i) => {
    setTimeout(() => writeText(text), i * 400 + Math.random() * 300);
  });
}

/** 组合效果：写字 + 烟花 */
function celebrate(message: string) {
  if (!isOverlayActive) initOverlay();
  // 先写字
  writeText(message, { type: 'calligraphy', fontSize: 36, duration: 5000 });
  // 同时放烟花
  setTimeout(() => showFireworksShow(4000), 800);
  // 额外漂浮文字
  setTimeout(() => writeBlessings(['妙哉~', '道友吉祥', '功德圆满']), 1200);
}

// ========== 清理 ====
function destroyOverlay() {
  stopAnimation();
  window.removeEventListener('resize', handleResize);
  if (overlayContainer?.parentNode) {
    overlayContainer.parentNode.removeChild(overlayContainer);
  }
  overlayContainer = null;
  canvas = null;
  ctx = null;
  fireworks = [];
  particles = [];
  writingTexts = [];
  isOverlayActive = false;
}

// ========== API 导出 ==========
declare global {
  interface Window {
    __spirit_overlay__?: {
      launchFirework: (x?: number, y?: number) => void;
      launchMultipleFireworks: (count?: number) => void;
      showFireworksShow: (duration?: number) => void;
      writeText: (text: string, options?: any) => void;
      writeBlessings: (texts: string[]) => void;
      celebrate: (message: string) => void;
      destroy: () => void;
      isActive: () => boolean;
    };
  }
}

// 暴露到全局供外部调用
window.__spirit_overlay__ = {
  launchFirework,
  launchMultipleFireworks,
  showFireworksShow,
  writeText,
  writeBlessings,
  celebrate,
  destroy: destroyOverlay,
  isActive: () => isOverlayActive,
};
