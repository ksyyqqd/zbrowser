/**
 * 球球接管遮罩 v2 — 科幻风格（纯 JS 版）
 * AI 接管时显示全屏半透明遮罩 + 光晕呼吸灯边框
 *
 * 双模式：
 *   'planning'  → 蓝青色系（AI 规划思考中）
 *   'executing' → 琥珀金系（AI 正在执行操作）
 *
 * 视觉元素：
 *   · 四边光晕呼吸（多层渐变叠加，有韵律的明暗脉动）
 *   · 能量流光粒子沿边缘流动
 *   · 脉冲波从边缘向内扩散
 */
(function () {
  'use strict';
  if (window.__spotlight_inited__) return;
  window.__spotlight_inited__ = true;

  var _overlay = null;
  var _canvas = null;
  var _ctx = null;
  var _label = null;
  var _active = false;
  var _rafId = null;
  var _mode = 'planning'; // 'planning' | 'executing'

  // ========== 颜色主题配置 ==========
  var THEMES = {
    planning: {
      name: '规划模式',
      core: '#00D4FF', // 核心高亮色 - 电光蓝
      secondary: '#06B6D4', // 辅助色 - 青色
      glow: 'rgba(0,212,255,', // 发光前缀
      particle: [0, 180, 255], // 粒子 RGB
      labelBg: 'rgba(0,150,200,0.9)',
      labelBorder: '#00D4FF',
      labelShadow: '0 0 20px rgba(0,212,255,0.5), 0 0 60px rgba(0,212,255,0.15)',
    },
    executing: {
      name: '执行模式',
      core: '#F59E0B', // 核心高亮色 - 琥珀金
      secondary: '#FB923C', // 辅助色 - 橙色
      glow: 'rgba(245,158,11,', // 发光前缀
      particle: [245, 158, 11], // 粒子 RGB
      labelBg: 'rgba(200,120,0,0.9)',
      labelBorder: '#F59E0B',
      labelShadow: '0 0 20px rgba(245,158,11,0.5), 0 0 60px rgba(245,158,11,0.15)',
    },
  };

  var T; // 当前主题引用

  var CFG = {
    maskColor: 'rgba(4, 6, 12, 0.65)', // 更深更暗的遮罩，光晕对比更强
    animDuration: 500,
    zIndex: 2147483646,
  };

  // 动画状态
  var _phase = 0; // 主呼吸相位 0~2π
  var _pulseRings = []; // 脉冲波数组 {x,y,r,alpha,edge}
  var _particles = []; // 流光粒子数组
  var _lastTime = 0;

  // ==================== 初始化 ====================

  function _create() {
    if (_overlay && _overlay.parentNode) return;

    // ---- 全屏遮罩 ----
    _overlay = document.createElement('div');
    Object.assign(_overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: String(CFG.zIndex),
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity ' + CFG.animDuration / 1000 + 's ease-in-out',
      backgroundColor: CFG.maskColor,
    });

    // ---- Canvas 层（所有科幻特效）----
    _canvas = document.createElement('canvas');
    _canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:' +
      (CFG.zIndex + 1) +
      ';pointer-events:none;' +
      'opacity:0;transition:opacity ' +
      CFG.animDuration / 1000 +
      's ease-in-out;';
    document.documentElement.appendChild(_overlay);
    document.documentElement.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    _resizeCanvas();
    _initParticles();

    window.addEventListener('resize', _resizeCanvas);

    T = THEMES[_mode] || THEMES.planning;
  }

  /** 构建网格背景 pattern (data URI) - 已废弃保留兼容 */
  function _buildGridPattern() {
    return 'none';
  }

  function _resizeCanvas() {
    if (!_canvas) return;
    var dpr = window.devicePixelRatio || 1;
    _canvas.width = window.innerWidth * dpr;
    _canvas.height = window.innerHeight * dpr;
    _canvas.style.width = '100vw';
    _canvas.style.height = '100vh';
    if (_ctx) _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function _destroyDOM() {
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
    if (_label && _label.parentNode) _label.parentNode.removeChild(_label);
    _overlay = null;
    _canvas = null;
    _ctx = null;
    _label = null;
    _active = false;
    _pulseRings = [];
    _particles = [];
    window.removeEventListener('resize', _resizeCanvas);
  }

  // ==================== 粒子系统初始化 ====================

  function _initParticles() {
    _particles = [];
    // 每条边分配多个粒子
    for (var i = 0; i < 16; i++) {
      _particles.push({
        pos: Math.random(), // 0~1 周长位置
        speed: 0.002 + Math.random() * 0.005,
        size: 2 + Math.random() * 3,
        alpha: 0.5 + Math.random() * 0.5,
        trail: [], // 尾迹点
        maxTrail: 8 + Math.floor(Math.random() * 10),
      });
    }
  }

  function _initDataDots() {
    /* 已移除 */
  }

  /**
   * 将周长位置转换为屏幕坐标
   */
  function _posToXY(pos, w, h) {
    var perimeter = w * 2 + h * 2;
    var dist = pos * perimeter;
    if (dist < w) return { x: dist, y: 0, edge: 'top' };
    dist -= w;
    if (dist < h) return { x: w, y: dist, edge: 'right' };
    dist -= h;
    if (dist < w) return { x: w - dist, y: h, edge: 'bottom' };
    dist -= w;
    return { x: 0, y: h - dist, edge: 'left' };
  }

  // ==================== 绘制函数 ====================

  function _drawFrame(timestamp) {
    if (!_ctx || !_canvas || !_active) return;

    var dpr = window.devicePixelRatio || 1;
    var w = _canvas.width / dpr;
    var h = _canvas.height / dpr;
    _ctx.clearRect(0, 0, w, h);

    // 时间增量
    var dt = _lastTime ? timestamp - _lastTime : 16;
    _lastTime = timestamp;
    dt = Math.min(dt, 50); // 防止切后台后跳帧

    // 相位推进（主周期 ~1.8s，明快呼吸节奏）
    _phase += (dt / 16.6) * ((Math.PI * 2) / 1800); // 1.8s 一完整呼吸周期
    if (_phase > Math.PI * 2) _phase -= Math.PI * 2;

    /**
     * 呼吸韵律 — 快节奏三波叠加
     *
     * 主波 (1.8s): 明快的"吸气→呼气"循环
     *   使用 pow 非对称：吸气快/呼气慢
     *
     * 快波 (~0.7s): 叠加微颤，增加能量感
     * 慢波 (~3.6s): 超慢漂移，改变呼吸深浅
     */
    var raw = Math.sin(_phase); // -1 ~ 1

    // 主呼吸：非对称（吸气快，呼气慢）
    var mainBreathe =
      raw >= 0
        ? Math.pow(raw, 0.55) // 吸气：快速上升
        : -Math.pow(-raw, 1.3); // 呼气：较慢下降
    mainBreathe = (mainBreathe + 1) / 2;

    // 快频微颤 (~0.7s)
    var microPulse = (Math.sin(_phase * 2.6 + 0.8) + 1) / 2;

    // 极慢漂移 (~3.6s)
    var drift = (Math.sin(_phase * 0.5) + 1) / 2;

    // 合成
    var breathe = mainBreathe * 0.6 + microPulse * 0.25 + drift * 0.15;
    if (breathe < 0) breathe = 0;
    if (breathe > 1) breathe = 1;

    T = THEMES[_mode] || THEMES.planning;
    var gw = 6 + breathe * 22; // 发光宽度 6~28px（大幅扩展）

    // ====== 1. 四边光晕呼吸（核心效果）======
    _drawGlowBorders(w, h, gw, breathe);

    // ====== 2. 流光粒子 ======
    _drawFlowParticles(w, h, dt, gw, breathe);

    // ====== 3. 脉冲波 ======
    _drawPulseWaves(w, h, dt);
  }

  /** 四角科技支架 — 已移除 */
  function _drawTechCorners() {}

  /**
   * 四边光晕呼吸 — 核心效果
   *
   * 呼吸韵律设计（模拟生物/能量脉动）：
   *   · 主波: 3s 慢周期 — 整体明暗起伏（如深吸气→呼出）
   *   · 快波: 1.3s 中频 — 光晕范围的快速收缩扩张
   *   · 微波: 5s 极慢频 — 亮度基线的缓慢漂移
   *   三波叠加产生"吸气-屏息-呼气"的有机节奏感
   *
   * 绘制策略：每条边独立绘制，用 linearGradient 实现从中心向两端衰减，
   * 避免角落过亮，让光晕在边上流动。
   */
  function _drawGlowBorders(w, h, gw, b) {
    _ctx.lineCap = 'round';

    // ====== L1: 白色高亮核（最亮，刺眼级）======
    _ctx.strokeStyle = '#FFFFFF';
    _ctx.lineWidth = 2;
    _ctx.shadowColor = '#FFFFFF';
    _ctx.shadowBlur = Math.max(3, gw * 1.5);
    _ctx.globalAlpha = 0.8 + b * 0.2;

    _drawFourEdges(w, h);

    // ====== L2: 主题色粗线（视觉主体，非常醒目）======
    _ctx.strokeStyle = T.core;
    _ctx.lineWidth = 3.5;
    _ctx.shadowColor = T.core;
    _ctx.shadowBlur = gw * 2.0;
    _ctx.globalAlpha = 0.9 + b * 0.1;

    _drawFourEdges(w, h);

    // ====== L3: 内层光晕（主要呼吸感，强烈发光）======
    _ctx.lineWidth = gw * 0.9; // ~6~18px 宽
    _ctx.strokeStyle = T.glow + (0.65 + b * 0.35).toFixed(2) + ')';
    _ctx.shadowColor = T.core;
    _ctx.shadowBlur = gw * 3.5; // 大面积模糊
    _ctx.globalAlpha = 0.75 + b * 0.25; // 0.75~1.00

    _drawFourEdgesRect(w, h, gw * 0.6);

    // ====== L4: 中层溢散（环境光晕，可见的泛光）======
    _ctx.lineWidth = gw * 2.2;
    _ctx.strokeStyle = T.glow + (0.25 + b * 0.2).toFixed(2) + ')';
    _ctx.shadowColor = T.core;
    _ctx.shadowBlur = gw * 6.0;
    _ctx.globalAlpha = 0.4 + b * 0.3; // 0.40~0.70

    _drawFourEdgesRect(w, h, gw * 2.5);

    // ====== L5: 外层大气辉（远处弥散光）======
    _ctx.lineWidth = gw * 4;
    _ctx.strokeStyle = T.glow + (0.1 + b * 0.1).toFixed(2) + ')';
    _ctx.shadowColor = T.core;
    _ctx.shadowBlur = gw * 12.0;
    _ctx.globalAlpha = 0.18 + b * 0.16; // 0.18~0.34

    _drawFourEdgesRect(w, h, gw * 5);

    // 清理
    _ctx.shadowBlur = 0;
    _ctx.globalAlpha = 1;
  }

  /** 绘制四条边的线段（用于细线描边）*/
  function _drawFourEdges(w, h) {
    _ctx.beginPath();
    _ctx.moveTo(0, 0);
    _ctx.lineTo(w, 0);
    _ctx.stroke(); // 上
    _ctx.beginPath();
    _ctx.moveTo(0, h);
    _ctx.lineTo(w, h);
    _ctx.stroke(); // 下
    _ctx.beginPath();
    _ctx.moveTo(0, 0);
    _ctx.lineTo(0, h);
    _ctx.stroke(); // 左
    _ctx.beginPath();
    _ctx.moveTo(w, 0);
    _ctx.lineTo(w, h);
    _ctx.stroke(); // 右
  }

  /** 用 rect 绘制四边矩形（用于粗线/发光描边） */
  function _drawFourEdgesRect(w, h, inset) {
    _ctx.beginPath();
    _ctx.rect(-inset, -inset, w + inset * 2, h + inset * 2);
    _ctx.stroke();
  }

  /** 沿四边流动的光粒子 + 拖尾效果 */
  function _drawFlowParticles(w, h, dt, gw, b) {
    for (var i = 0; i < _particles.length; i++) {
      var p = _particles[i];
      p.pos += p.speed * (dt / 16.6);
      if (p.pos > 1) p.pos -= 1;
      if (p.pos < 0) p.pos += 1;

      var xy = _posToXY(p.pos, w, h);

      // 记录尾迹
      p.trail.unshift({ x: xy.x, y: xy.y });
      if (p.trail.length > p.maxTrail) p.trail.pop();

      // 绘制尾迹（渐变衰减）
      for (var t = p.trail.length - 1; t >= 0; t--) {
        var pt = p.trail[t];
        var ratio = 1 - t / p.trail.length;
        var pr = T.particle;
        _ctx.fillStyle =
          'rgba(' + pr[0] + ',' + pr[1] + ',' + pr[2] + ',' + (ratio * p.alpha * 0.4 * b).toFixed(3) + ')';
        _ctx.beginPath();
        _ctx.arc(pt.x, pt.y, p.size * ratio * 0.7, 0, Math.PI * 2);
        _ctx.fill();
      }

      // 绘制粒子头部
      var headGrad = _ctx.createRadialGradient(xy.x, xy.y, 0, xy.x, xy.y, p.size * 3);
      var pr2 = T.particle;
      headGrad.addColorStop(0, 'rgba(255,255,255,' + (0.95 * b).toFixed(2) + ')');
      headGrad.addColorStop(0.3, 'rgba(' + pr2[0] + ',' + pr2[1] + ',' + pr2[2] + ',' + (0.85 * b).toFixed(2) + ')');
      headGrad.addColorStop(1, 'rgba(' + pr2[0] + ',' + pr2[1] + ',' + pr2[2] + ',0)');
      _ctx.globalAlpha = 0.7 + b * 0.3;
      _ctx.fillStyle = headGrad;
      _ctx.beginPath();
      _ctx.arc(xy.x, xy.y, p.size * 3, 0, Math.PI * 2);
      _ctx.fill();
    }
    _ctx.globalAlpha = 1;
  }

  /** 从四边中心向外扩散的脉冲波环 */
  function _drawPulseWaves(w, h, dt) {
    // 定时产生新脉冲波
    if (Math.random() < 0.02) {
      // ~每秒 1-2 次
      var edge = ['top', 'right', 'bottom', 'left'][Math.floor(Math.random() * 4)];
      var px, py;
      switch (edge) {
        case 'top':
          px = w / 2;
          py = 0;
          break;
        case 'right':
          px = w;
          py = h / 2;
          break;
        case 'bottom':
          px = w / 2;
          py = h;
          break;
        default:
          px = 0;
          py = h / 2;
          break;
      }
      _pulseRings.push({ x: px, y: py, r: 0, alpha: 0.6, edge: edge });
    }

    // 更新并绘制
    for (var i = _pulseRings.length - 1; i >= 0; i--) {
      var ring = _pulseRings[i];
      ring.r += dt * 0.08; // 扩散速度
      ring.alpha -= dt * 0.001; // 衰减

      if (ring.alpha <= 0 || ring.r > 300) {
        _pulseRings.splice(i, 1);
        continue;
      }

      var pr3 = T.particle;
      _ctx.strokeStyle = 'rgba(' + pr3[0] + ',' + pr3[1] + ',' + pr3[2] + ',' + ring.alpha.toFixed(3) + ')';
      _ctx.lineWidth = 1.5;
      _ctx.globalAlpha = ring.alpha;

      _ctx.beginPath();
      _ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      _ctx.stroke();
    }
    _ctx.globalAlpha = 1;
  }

  /** 水平扫描线 — 已移除，保留空函数兼容 */
  function _drawScanLine() {}

  /** 数据微粒 — 已移除 */
  function _drawDataDots() {}

  // ==================== 动画控制 ====================

  function _startAnimation() {
    if (_rafId) return;
    _lastTime = 0;
    function loop(ts) {
      if (!_active) return;
      _drawFrame(ts);
      _rafId = requestAnimationFrame(loop);
    }
    _rafId = requestAnimationFrame(loop);
  }

  function _stopAnimation() {
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _phase = 0;
    _lastTime = 0;
  }

  // ==================== 标签 ====================

  function _setLabel(text) {
    if (!text) return;
    _removeLabel();

    _label = document.createElement('div');
    var isPlanning = _mode === 'planning';

    Object.assign(_label.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%) scale(0.92)',
      zIndex: String(CFG.zIndex + 3),
      pointerEvents: 'none',
      padding: '12px 28px',
      fontSize: '13px',
      fontFamily: '"SF Mono","Consolas","Liberation Mono",monospace,"PingFang SC","Microsoft YaHei"',
      color: '#fff',
      background:
        'linear-gradient(135deg, ' +
        T.labelBg +
        ', ' +
        (isPlanning ? 'rgba(0,100,160,0.85)' : 'rgba(160,80,0,0.85)') +
        ')',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      letterSpacing: '2px',
      textTransform: 'uppercase',
      opacity: '0',
      transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.16,1,0.3,1)',
      boxShadow: T.labelShadow,
      // 科幻风格：左侧竖条装饰
      borderLeft: '3px solid ' + T.labelBorder,
    });
    _label.textContent = text;
    document.documentElement.appendChild(_label);

    // 入场动画
    requestAnimationFrame(function () {
      if (_label) {
        _label.style.opacity = '1';
        _label.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    });
  }

  function _removeLabel() {
    if (_label && _label.parentNode) {
      _label.parentNode.removeChild(_label);
      _label = null;
    }
  }

  function _updateLabel(text) {
    if (!_label && text) {
      _setLabel(text);
    } else if (_label) {
      _label.textContent = text;
      _label.style.background =
        'linear-gradient(135deg, ' +
        T.labelBg +
        ', ' +
        (_mode === 'planning' ? 'rgba(0,100,160,0.85)' : 'rgba(160,80,0,0.85)') +
        ')';
      _label.style.borderLeftColor = T.labelBorder;
      _label.style.boxShadow = T.labelShadow;
    }
  }

  // ==================== 公开 API ====================

  /**
   * 显示接管遮罩
   * @param {Object} opts
   * @param {'planning'|'executing'} [opts.mode] - 初始模式，默认 'planning'
   * @param {string} [opts.label] - 中央标签文字
   */
  function showSpotlight(opts) {
    opts = opts || {};
    try {
      if (opts.mode) _mode = opts.mode;

      _create();

      requestAnimationFrame(function () {
        if (_overlay) _overlay.style.opacity = '1';
        if (_canvas) _canvas.style.opacity = '1';
      });

      _active = true;
      _startAnimation();

      _setLabel(
        opts.label ||
          (_mode === 'planning'
            ? '\u{1F9E0} AI \u89C4\u5212\u601D\u8003\u4E2D...'
            : '\u{1F680} AI \u6267\u884C\u64CD\u4F5C\u4E2D...'),
      );
    } catch (err) {
      console.error('[\u7403\u7403\u90AE\u7F69] \u663E\u793A\u5931\u8D25:', err);
    }
  }

  /**
   * 切换显示模式（动态切换颜色）
   * @param {'planning'|'executing'} mode
   */
  function setMode(mode) {
    if (!mode || !_active) return;
    _mode = mode;
    T = THEMES[_mode] || THEMES.planning;
    _updateLabel(
      _mode === 'planning'
        ? '\u{1F9E0} AI \u89C4\u5212\u601D\u8003\u4E2D...'
        : '\u{1F680} AI \u6267\u884C\u64CD\u4F5C\u4E2D...',
    );
  }

  function hideSpotlight() {
    if (!_active) return;

    _stopAnimation();

    if (_overlay) _overlay.style.opacity = '0';
    if (_canvas) _canvas.style.opacity = '0';
    if (_label) {
      _label.style.opacity = '0';
      _label.style.transform = 'translate(-50%, -50%) scale(0.92)';
    }

    setTimeout(function () {
      _destroyDOM();
    }, CFG.animDuration);
    _active = false;
  }

  function isActive() {
    return _active;
  }
  function getMode() {
    return _mode;
  }

  function destroy() {
    hideSpotlight();
    delete window.__spotlight_inited__;
  }

  // 暴露全局 API
  window.__ball_spotlight__ = {
    show: showSpotlight,
    hide: hideSpotlight,
    setMode: setMode,
    isActive: isActive,
    getMode: getMode,
    destroy: destroy,
  };
})();
