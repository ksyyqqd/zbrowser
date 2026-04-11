/**
 * 球球网页实体 v1 — 页面注入脚本（纯 JS 版）
 *
 * 将球球的 SVG 形象注入到目标网页中，带物理引擎和碰撞系统。
 * 捣乱模式：球球从侧边飞入，撞向按钮后弹开，触发按钮悬浮效果。
 *
 * 通过 chrome.scripting.executeScript({ files: [...] }) 注入，符合 CSP 规范
 */
(function () {
  'use strict';
  if (window.__ball_entity_inited__) return;
  window.__ball_entity_inited__ = true;

  var _container = null; // 球球 DOM 容器
  var _svgNS = 'http://www.w3.org/2000/svg';
  var _active = false;
  var _rafId = null;
  var _lastTime = 0;

  // ===== 物理状态 =====
  var _x = 0,
    _y = 0; // 位置 (px)
  var _vx = 0,
    _vy = 0; // 速度 (px/s)
  var _ax = 0,
    _ay = 400; // 加速度 — 重力向下
  var _radius = 30; // 球球半径 (px)
  var _scale = 1.2; // 渲染缩放 (比面板中的大一点)
  var _rotation = 0; // 旋转角度 (rad)
  var _rotationSpeed = 0; // 角速度

  // ===== 碰撞状态 =====
  var _collidedEl = null; // 当前碰撞的元素
  var _collisionCooldown = 0; // 碰撞冷却时间
  var _hoverDuration = 0; // 悬浮效果剩余时长
  var _hoverTarget = null; // 正在悬浮的目标元素

  // ===== 配置 =====
  var CFG = {
    zIndex: 2147483645, // 比 spotlight 低一级
    bounceRestitution: 0.65, // 弹性系数 (0~1)
    airDrag: 0.995, // 空气阻力
    groundFriction: 0.85, // 地面摩擦
    hoverDuration: 1200, // 悬浮持续时间 ms
    maxSpeed: 800, // 最大速度 px/s
    lifetime: 6000, // 存活总时长 ms
    spawnSide: 'random', // 随机选择入场边: left/right/top/bottom
  };

  // ===== 球球颜色配置 =====
  var BALL_COLORS = {
    bodyFill: '#FFFDF9', // 身体填充 (浅白)
    bodyStroke: '#F59E0B', // 边框色 (琥珀金)
    eyeWhite: '#E8E4DE',
    pupil: '#1C1917',
    cheek: '#FCA5A544', // 腮红
    mouthColor: '#1C1917',
    glowColor: 'rgba(245,158,11,0.3)',
  };

  // ==================== 初始化 / 销毁 ====================

  function _create() {
    if (_container) return;

    // 创建容器 div
    _container = document.createElement('div');
    _container.id = '__ball_entity_container__';
    Object.assign(_container.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex),
      pointerEvents: 'none', // 关键：不拦截鼠标事件，否则 elementFromPoint 会返回自身
      width: _radius * 2 * _scale + 'px',
      height: _radius * 2 * _scale + 'px',
      transition: 'none', // 不用 CSS 过渡，用物理驱动
      willChange: 'transform, left, top',
    });

    // 构建 SVG 内容
    _buildSVG();

    document.documentElement.appendChild(_container);

    // 初始化位置 — 从屏幕边缘飞入
    _spawnFromEdge();
  }

  function _destroy() {
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    if (_hoverTarget) {
      _endHoverEffect();
    }
    if (_container && _container.parentNode) {
      _container.parentNode.removeChild(_container);
    }
    _container = null;
    _active = false;
  }

  // ==================== 球球 SVG 构建 ====================

  function _buildSVG() {
    var size = _radius * 2 * _scale;
    var svg = document.createElementNS(_svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 30 30');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.overflow = 'visible';

    // 光晕滤镜定义
    var defs = document.createElementNS(_svgNS, 'defs');
    defs.innerHTML =
      '<filter id="__ball_glow__" x="-50%" y="-50%" width="200%" height="200%">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter>' +
      '<radialGradient id="__ball_body_grad__" cx="40%" cy="35%" r="65%">' +
      '<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.8"/>' +
      '<stop offset="70%" stop-color="' +
      BALL_COLORS.bodyFill +
      '" stop-opacity="1"/>' +
      '<stop offset="100%" stop-color="#F5E6D3" stop-opacity="1"/>' +
      '</radialGradient>';
    svg.appendChild(defs);

    // 外圈光晕
    var outerGlow = document.createElementNS(_svgNS, 'circle');
    outerGlow.setAttribute('cx', '15');
    outerGlow.setAttribute('cy', '15');
    outerGlow.setAttribute('r', '14');
    outerGlow.setAttribute('fill', 'none');
    outerGlow.setAttribute('stroke', BALL_COLORS.glowColor);
    outerGlow.setAttribute('stroke-width', '1');
    outerGlow.setAttribute('opacity', '0.5');
    svg.appendChild(outerGlow);

    // 身体主体组 (应用发光滤镜)
    var gBody = document.createElementNS(_svgNS, 'g');
    gBody.setAttribute('filter', 'url(#__ball_glow__)');

    // 身体圆
    var body = document.createElementNS(_svgNS, 'circle');
    body.setAttribute('cx', '15');
    body.setAttribute('cy', '15');
    body.setAttribute('r', '12');
    body.setAttribute('fill', 'url(#__ball_body_grad__)');
    body.setAttribute('stroke', BALL_COLORS.bodyStroke);
    body.setAttribute('stroke-width', '0.8');
    gBody.appendChild(body);

    // 左腮红
    var cheekL = document.createElementNS(_svgNS, 'circle');
    cheekL.setAttribute('cx', '9');
    cheekL.setAttribute('cy', '18');
    cheekL.setAttribute('r', '2.2');
    cheekL.setAttribute('fill', BALL_COLORS.cheek);
    gBody.appendChild(cheekL);

    // 右腮红
    var cheekR = document.createElementNS(_svgNS, 'circle');
    cheekR.setAttribute('cx', '21');
    cheekR.setAttribute('cy', '18');
    cheekR.setAttribute('r', '2.2');
    cheekR.setAttribute('fill', BALL_COLORS.cheek);
    gBody.appendChild(cheekR);

    // ===== 眼睛：嬉皮笑脸 — 左眼眯眼（wink），右眼睁大 =====
    // 左眼（眯成弯月 — 坏笑 wink）
    var winkL = document.createElementNS(_svgNS, 'path');
    winkL.setAttribute('d', 'M9.5 15.5 Q11.8 13.5 14.2 15.5');
    winkL.setAttribute('fill', 'none');
    winkL.setAttribute('stroke', BALL_COLORS.pupil);
    winkL.setAttribute('stroke-width', '1.4');
    winkL.setAttribute('stroke-linecap', 'round');
    gBody.appendChild(winkL);

    // 右眼（睁大 + 高光，显得更调皮）
    var eyeWR = document.createElementNS(_svgNS, 'circle');
    eyeWR.setAttribute('cx', '18.2');
    eyeWR.setAttribute('cy', '15');
    eyeWR.setAttribute('r', '3');
    eyeWR.setAttribute('fill', '#FFF');
    eyeWR.setAttribute('stroke', BALL_COLORS.eyeWhite);
    eyeWR.setAttribute('stroke-width', '0.4');
    gBody.appendChild(eyeWR);

    var pupilR = document.createElementNS(_svgNS, 'circle');
    pupilR.setAttribute('cx', '18.5');
    pupilR.setAttribute('cy', '14.6');
    pupilR.setAttribute('r', '1.8');
    pupilR.setAttribute('fill', BALL_COLORS.pupil);
    gBody.appendChild(pupilR);

    var highlightR = document.createElementNS(_svgNS, 'circle');
    highlightR.setAttribute('cx', '19');
    highlightR.setAttribute('cy', '14');
    highlightR.setAttribute('r', '0.7');
    highlightR.setAttribute('fill', '#FFFFFF');
    highlightR.setAttribute('opacity', '0.9');
    gBody.appendChild(highlightR);

    // 嘴巴：大大的嬉皮笑脸（露齿坏笑）
    var mouth = document.createElementNS(_svgNS, 'path');
    mouth.setAttribute('d', 'M10 20 Q15 24 20 20 Q15 27 10 20');
    mouth.setAttribute('fill', '#FF6B6B'); // 舌头红色
    mouth.setAttribute('stroke', BALL_COLORS.mouthColor);
    mouth.setAttribute('stroke-width', '1');
    mouth.setAttribute('stroke-linecap', 'round');
    gBody.appendChild(mouth);

    // 上嘴唇线
    var upperLip = document.createElementNS(_svgNS, 'path');
    upperLip.setAttribute('d', 'M10.5 19.8 Q15 16.5 19.5 19.8');
    upperLip.setAttribute('fill', 'none');
    upperLip.setAttribute('stroke', BALL_COLORS.mouthColor);
    upperLip.setAttribute('stroke-width', '1.0');
    upperLip.setAttribute('stroke-linecap', 'round');
    gBody.appendChild(upperLip);

    // 小牙齿
    var tooth1 = document.createElementNS(_svgNS, 'rect');
    tooth1.setAttribute('x', '13');
    tooth1.setAttribute('y', '18.5');
    tooth1.setAttribute('width', '1.5');
    tooth1.setAttribute('height', '1.8');
    tooth1.setAttribute('fill', '#FFFFFF');
    tooth1.setAttribute('rx', '0.3');
    gBody.appendChild(tooth1);

    var tooth2 = document.createElementNS(_svgNS, 'rect');
    tooth2.setAttribute('x', '15.5');
    tooth2.setAttribute('y', '18.3');
    tooth2.setAttribute('width', '1.5');
    tooth2.setAttribute('height', '2');
    tooth2.setAttribute('fill', '#FFFFFF');
    tooth2.setAttribute('rx', '0.3');
    gBody.appendChild(tooth2);

    // 腮红加强
    var cheekLX = document.createElementNS(_svgNS, 'ellipse');
    cheekLX.setAttribute('cx', '8.5');
    cheekLX.setAttribute('cy', '18.5');
    cheekLX.setAttribute('rx', '2.8');
    cheekLX.setAttribute('ry', '1.8');
    cheekLX.setAttribute('fill', '#FF8A8A66');
    gBody.appendChild(cheekLX);

    var cheekRX = document.createElementNS(_svgNS, 'ellipse');
    cheekRX.setAttribute('cx', '21.5');
    cheekRX.setAttribute('cy', '18.5');
    cheekRX.setAttribute('rx', '2.8');
    cheekRX.setAttribute('ry', '1.8');
    cheekRX.setAttribute('fill', '#FF8A8A66');
    gBody.appendChild(cheekRX);

    // 小恶魔角
    var hornL = document.createElementNS(_svgNS, 'path');
    hornL.setAttribute('d', 'M7 7 L9 12 L5 11 Z');
    hornL.setAttribute('fill', '#F59E0B');
    hornL.setAttribute('opacity', '0.6');
    gBody.appendChild(hornL);

    var hornR = document.createElementNS(_svgNS, 'path');
    hornR.setAttribute('d', 'M23 7 L21 12 L25 11 Z');
    hornR.setAttribute('fill', '#F59E0B');
    hornR.setAttribute('opacity', '0.6');
    gBody.appendChild(hornR);

    svg.appendChild(gBody);
    _container.appendChild(svg);
  }

  // ==================== 物理引擎 ====================

  /** 固定从右上角飞入 */
  function _spawnFromEdge() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var r = _radius * _scale;

    // 固定右上角入场
    _x = w + r * 2; // 屏幕右侧外
    _y = -r * 2; // 屏幕上方外（右上角方向）
    _vx = -(280 + Math.random() * 200); // 向左下方飞入
    _vy = 180 + Math.random() * 200; // 向下

    // 逆时针旋转（更调皮的感觉）
    _rotationSpeed = -(4 + Math.random() * 6);
  }

  /** 更新物理模拟 */
  function _updatePhysics(dtSec) {
    dtSec = Math.min(dtSec, 0.05); // 防止大跳帧

    // 应用重力
    _vy += _ay * dtSec;

    // 速度限制
    var speed = Math.sqrt(_vx * _vx + _vy * _vy);
    if (speed > CFG.maxSpeed) {
      var ratio = CFG.maxSpeed / speed;
      _vx *= ratio;
      _vy *= ratio;
    }

    // 空气阻力
    _vx *= Math.pow(CFG.airDrag, dtSec * 60);
    _vy *= Math.pow(CFG.airDrag, dtSec * 60);

    // 更新位置
    _x += _vx * dtSec;
    _y += _vy * dtSec;

    // 旋转
    _rotation += _rotationSpeed * dtSec;
    _rotationSpeed *= 0.98; // 角速度衰减

    // 屏幕边界碰撞 (墙壁反弹)
    var r = _radius * _scale;
    var w = window.innerWidth;
    var h = window.innerHeight;

    if (_x - r < 0) {
      _x = r;
      _vx = Math.abs(_vx) * CFG.bounceRestitution;
      _rotationSpeed += (Math.random() - 0.5) * 3;
    }
    if (_x + r > w) {
      _x = w - r;
      _vx = -Math.abs(_vx) * CFG.bounceRestitution;
      _rotationSpeed += (Math.random() - 0.5) * 3;
    }
    if (_y - r < 0) {
      _y = r;
      _vy = Math.abs(_vy) * CFG.bounceRestitution;
      _rotationSpeed += (Math.random() - 0.5) * 3;
    }
    if (_y + r > h) {
      _y = h - r;
      _vy = -Math.abs(_vy) * CFG.bounceRestitution;
      _rotationSpeed *= 0.7;
      _vx *= CFG.groundFriction;
    }

    // 元素碰撞检测
    _checkElementCollision(r);
  }

  /**
   * 检测与页面可交互元素的碰撞
   * 策略：
   *  A. 多点 elementFromPoint 探测（球边缘8个方向 + 中心）
   *  B. 回退：全页查询所有可交互元素做距离检测
   */
  function _checkElementCollision(ballR) {
    // 冷却中不检测
    if (_collisionCooldown > 0 || _hoverDuration > 0) return;

    var cx = _x;
    var cy = _y;

    // ===== 策略A：多点探测（快速路径）=====
    // 在球的边缘和中心取多个采样点
    var samplePoints = [
      { x: cx, y: cy }, // 中心
      { x: cx + ballR * 0.7, y: cy }, // 右
      { x: cx - ballR * 0.7, y: cy }, // 左
      { x: cx, y: cy + ballR * 0.7 }, // 下
      { x: cx, y: cy - ballR * 0.7 }, // 上
      { x: cx + ballR * 0.5, y: cy + ballR * 0.5 }, // 右下
      { x: cx - ballR * 0.5, y: cy + ballR * 0.5 }, // 左下
      { x: cx + ballR * 0.5, y: cy - ballR * 0.5 }, // 右上
      { x: cx - ballR * 0.5, y: cy - ballR * 0.5 }, // 左上
    ];

    var w = window.innerWidth;
    var h = window.innerHeight;

    for (var si = 0; si < samplePoints.length; si++) {
      var sp = samplePoints[si];
      var sx = Math.max(0, Math.min(sp.x, w));
      var sy = Math.max(0, Math.min(sp.y, h));

      try {
        var el = document.elementFromPoint(sx, sy);
        if (!el) continue;

        el = _findInteractiveAncestor(el);
        if (el) {
          var rect = el.getBoundingClientRect();
          if (rect && rect.width >= 8 && rect.height >= 8) {
            // 计算距离确认碰撞
            var clX = Math.max(rect.left, Math.min(cx, rect.right));
            var clY = Math.max(rect.top, Math.min(cy, rect.bottom));
            var dX = cx - clX;
            var dY = cy - clY;
            var dist = Math.sqrt(dX * dX + dY * dY);

            if (dist < ballR + 10) {
              // 给一点余量
              _handleCollision(el, rect, dX, dY, dist, ballR);
              return; // 碰撞成功，退出
            }
          }
        }
      } catch (e) {
        /* 跨域 iframe 可能报错，忽略 */
      }
    }

    // ===== 策略B：全量回退 — 遍历所有可交互元素做距离检测 =====
    // 当 elementFromPoint 无法命中时使用（如被 canvas/iframe 遮挡）
    var candidates = document.querySelectorAll(
      'a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"],' +
        '[role="checkbox"], [role="menuitem"], [role="option"], [role="treeitem"], [role="slider"],' +
        '[onclick], [onmouseenter], [tabindex]:not([tabindex="-1"]),' +
        '[href], [contenteditable="true"], [draggable="true"],' +
        '[data-action], [data-toggle], [data-target],' +
        '.btn, .button, .clickable, .interactive, [class*="-btn"], [class*="button"], [class*="action"],' +
        ' [class*="click"], [class*="hover"], [class*="nav-"], [class*="menu-"], [class*="tab-"],' +
        ' [class*="card"], [class*="chip"], [class*="tag"], [class*="toggle"], [class*="switch"]',
    );

    var nearestDist = Infinity;
    var nearestEl = null;
    var nearestRect = null;

    for (var ci = 0; ci < candidates.length; ci++) {
      var cel = candidates[ci];
      if (!cel || cel === _container) continue;

      // 再次排除自身相关元素
      if (
        cel.id &&
        (cel.id.indexOf('__spotlight') >= 0 || cel.id.indexOf('__ball') >= 0 || cel.id.indexOf('__entity') >= 0)
      )
        continue;

      var crect = cel.getBoundingClientRect();
      if (!crect || crect.width < 8 || crect.height < 8) continue;

      // 找到最近点
      var cclX = Math.max(crect.left, Math.min(cx, crect.right));
      var cclY = Math.max(crect.top, Math.min(cy, crect.bottom));
      var cdx = cx - cclX;
      var cdy = cy - cclY;
      var cdist = Math.sqrt(cdx * cdx + cdy * cdy);

      // 只关注在球附近（2倍半径内）的元素
      if (cdist < ballR * 2 && cdist < nearestDist) {
        nearestDist = cdist;
        nearestEl = cel;
        nearestRect = crect;
      }
    }

    // 如果找到足够近的元素，触发碰撞
    if (nearestEl && nearestDist < ballR) {
      var ndX = cx - Math.max(nearestRect.left, Math.min(cx, nearestRect.right));
      var ndY = cy - Math.max(nearestRect.top, Math.min(cy, nearestRect.bottom));
      _handleCollision(nearestEl, nearestRect, ndX, ndY, nearestDist, ballR);
    }
  }

  /** 向上查找可交互元素 */
  function _findInteractiveAncestor(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    // 如果当前元素本身就是可交互的，返回它
    if (_isInteractive(el)) return el;

    // 向上查找最多 3 层
    var current = el.parentElement;
    for (var i = 0; i < 3 && current; i++) {
      if (current === document.body || current === document.documentElement) break;
      if (_isInteractive(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  /** 判断元素是否值得碰撞（全面覆盖所有可 hover 元素） */
  function _isInteractive(el) {
    if (!el) return false;
    var tag = el.tagName.toLowerCase();

    // ===== 1. 排除非交互/容器元素 =====
    if (
      [
        'html',
        'head',
        'body',
        'script',
        'style',
        'meta',
        'link',
        'br',
        'hr',
        'noscript',
        'template',
        'source',
        'track',
        'col',
        'colgroup',
      ].indexOf(tag) !== -1
    )
      return false;

    // 排除遮罩层自身及内部元素
    if (el.id && (el.id.indexOf('__spotlight') >= 0 || el.id.indexOf('__ball') >= 0 || el.id.indexOf('__entity') >= 0))
      return false;
    // 排除球球自己的 DOM 子树
    var n = el;
    while (n && n !== document.body) {
      if (n.id && n.id.indexOf('__ball_entity_container__') >= 0) return false;
      n = n.parentElement;
    }

    // 排除不可见或极小的元素（不可见的不可能有 hover）
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width < 8 || rect.height < 8) return false;

    // ===== 2. 明确可交互的 HTML 标签 =====
    var interactiveTags = [
      'a',
      'button',
      'input',
      'select',
      'textarea', // 表单/链接
      'summary',
      'details',
      'label', // 折叠/表单关联
      'option',
      'optgroup', // 下拉选项
      'menuitem', // 菜单
      'video',
      'audio', // 媒体控件
      'canvas', // 画布
      'iframe', // 嵌入内容
      'embed',
      'object', // 外部对象
    ];
    if (interactiveTags.indexOf(tag) !== -1) return true;

    // ===== 3. ARIA 交互角色（全覆盖） =====
    var role = el.getAttribute('role');
    if (role) {
      var interactiveRoles = [
        'button',
        'link',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'tab',
        'tablist',
        'tabpanel',
        'checkbox',
        'radio',
        'switch',
        'toggle',
        'combobox',
        'listbox',
        'option',
        'treeitem',
        'slider',
        'spinbutton',
        'textbox',
        'searchbox',
        'gridcell',
        'rowheader',
        'columnheader',
        'dialog',
        'alertdialog',
        'tooltip',
        'progressbar',
        'scrollbar',
        'separator',
        'navigation',
        'main',
        'banner',
        'contentinfo',
        'application',
        'article',
        'region',
        'group',
      ];
      if (interactiveRoles.indexOf(role) !== -1) return true;
      // 任何非 presentation/none 的 role 都算潜在可交互
      if (role !== 'presentation' && role !== 'none') return true;
    }

    // ===== 4. 显式交互属性 =====
    if (el.onclick || el.onmouseenter || el.onmouseover || el.onmousedown || el.onfocus) return true;
    if (el.tabIndex >= 0) return true;
    if (el.getAttribute('href')) return true;
    if (el.getAttribute('contenteditable')) return true;
    if (el.getAttribute('draggable') === 'true') return true;
    if (el.hasAttribute('data-action') || el.hasAttribute('data-clickable')) return true;

    // ===== 5. cursor 检测（内联 + 计算样式） =====
    if (
      el.style.cursor === 'pointer' ||
      getComputedStyle(el).cursor === 'pointer' ||
      getComputedStyle(el).cursor === 'grab' ||
      getComputedStyle(el).cursor === 'zoom-in' ||
      getComputedStyle(el).cursor === 'zoom-out'
    )
      return true;

    // ===== 6. CSS :hover 规则检测（核心改进）=====
    // 检查该元素是否有 CSS transition / transform / animation 属性
    // 这些通常是配合 :hover 使用的视觉反馈信号
    var cs = getComputedStyle(el);
    if (cs.transition && cs.transition !== 'all 0s ease 0s' && cs.transition !== 'none 0s ease 0s') {
      // 有过渡动画 → 很可能是 hover 目标
      // 额外确认：不是纯布局元素
      var d = el.getAttribute('data-testid'); // 测试 ID 通常标记可交互组件
      if (d) return true;
      // 如果有 box-shadow / transform 过渡，几乎确定是 hover 目标
      if (cs.transition.indexOf('transform') >= 0 || cs.transition.indexOf('box-shadow') >= 0) return true;
      if (cs.transition.indexOf('background') >= 0 || cs.transition.indexOf('color') >= 0) return true;
      if (cs.transition.indexOf('opacity') >= 0) return true;
      // 有任何非 all 0s 的过渡且元素不是大块文本容器
      if (rect.width < 600 && rect.height < 400) {
        // 排除大块内容区，保留小组件级元素
        return true;
      }
    }
    // 检查 animation 属性
    if (cs.animation && cs.animation !== 'none 0s ease 0s 1 normal none running none') {
      if (rect.width < 400 && rect.height < 300) return true;
    }

    // ===== 7. 常见的可点击模式检测 =====
    // React/Vue/Angular 等框架绑定的事件（通过 __reactProps / __vue__ 等检测）
    var keys = Object.keys(el);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (
        key.indexOf('__reactFiber') >= 0 ||
        key.indexOf('__reactInternalInstance') >= 0 ||
        key.indexOf('__vue') >= 0 ||
        key.indexOf('__ngContext__') >= 0
      ) {
        // 框架管理的元素 → 大概率是组件节点，可能是可交互的
        // 进一步检查是否有 onClick/onMouseEnter 等 prop
        try {
          var propsKey = key.replace('Instance$', '$').replace('Fiber$', '');
          var fiber = el[key];
          if (fiber && fiber.memoizedProps) {
            var mp = fiber.memoizedProps;
            if (
              mp.onClick ||
              mp.onMouseEnter ||
              mp.onHover ||
              mp.onPointerEnter ||
              mp.onMouseDown ||
              mp.onTap ||
              mp.onClickCapture ||
              (mp.className &&
                typeof mp.className === 'string' &&
                (mp.className.indexOf('btn') >= 0 ||
                  mp.className.indexOf('click') >= 0 ||
                  mp.className.indexOf('hover') >= 0 ||
                  mp.className.indexOf('active') >= 0 ||
                  mp.className.indexOf('interactive') >= 0 ||
                  mp.className.indexOf('action') >= 0))
            ) {
              return true;
            }
          }
          // Vue: 检查 __vue__ 组件实例的事件
          if (el.__vue__) {
            var vc = el.__vue__;
            if (vc.$options && vc.$options.methods) {
              var vms = Object.keys(vc.$options.methods);
              for (var vi = 0; vi < vms.length; vi++) {
                if (
                  vms[vi].indexOf('click') >= 0 ||
                  vms[vi].indexOf('hover') >= 0 ||
                  vms[vi].indexOf('tap') >= 0 ||
                  vms[vi].indexOf('handle') >= 0
                )
                  return true;
              }
            }
            if (vc.$listeners) {
              var vlKeys = Object.keys(vc.$listeners);
              for (var vli = 0; vli < vlKeys.length; vli++)
                if (
                  vlKeys[vli].indexOf('click') >= 0 ||
                  vlKeys[vli].indexOf('mouse') >= 0 ||
                  vlKeys[vli].indexOf('touch') >= 0
                )
                  return true;
            }
          }
        } catch (e2) {
          /* 框架内部结构可能无法安全访问 */
        }
      }
    }

    // ===== 8. 类名启发式检测（常见 UI 库命名）=====
    var cls = el.className && typeof el.className === 'string' ? el.className : '';
    if (cls) {
      var interactiveClassPatterns = [
        'btn',
        'button',
        'click',
        'tap',
        'action',
        'trigger',
        'link',
        'nav',
        'card',
        'tile',
        'chip',
        'badge',
        'tag',
        'pill',
        'tab',
        'menu',
        'dropdown',
        'popover',
        'tooltip',
        'modal',
        'dialog',
        'drawer',
        'sheet',
        'panel',
        'item',
        'row',
        'cell',
        'option',
        'select',
        'choice',
        'input',
        'control',
        'toggle',
        'switch',
        'checkbox',
        'radio',
        'slider',
        'stepper',
        'icon-btn',
        'fab',
        'cta',
        'submit',
        'cancel',
        'close',
        'dismiss',
        'hoverable',
        'interactive',
        'clickable',
        'focusable',
        'pressable',
      ];
      var clsLower = cls.toLowerCase();
      for (var p = 0; p < interactiveClassPatterns.length; p++) {
        // 匹配 btn-xxx, xxx-button, isClickable 等
        if (clsLower.indexOf(interactiveClassPatterns[p]) !== -1) {
          // 排除纯展示性用法（如 "disabled"、"readonly"）
          if (clsLower.indexOf('disabled') === -1 && clsLower.indexOf('readonly') === -1) {
            return true;
          }
        }
      }
    }

    // ===== 9. data-* 属性检测 =====
    if (
      el.hasAttribute('data-toggle') ||
      el.hasAttribute('data-target') ||
      el.hasAttribute('data-dismiss') ||
      el.hasAttribute('data-modal') ||
      el.hasAttribute('data-tab') ||
      el.hasAttribute('data-nav') ||
      el.hasAttribute('data-tooltip') ||
      el.hasAttribute('data-popover') ||
      el.hasAttribute('data-href') ||
      el.hasAttribute('data-url') ||
      el.hasAttribute('data-command') ||
      el.hasAttribute('data-handler')
    )
      return true;

    // ===== 10. SVG 交互元素 =====
    if (el instanceof SVGElement) {
      var svgTag = tag;
      if (
        [
          'svg',
          'g',
          'path',
          'rect',
          'circle',
          'ellipse',
          'line',
          'polyline',
          'polygon',
          'text',
          'tspan',
          'image',
          'use',
        ].indexOf(svgTag) !== -1
      ) {
        // SVG 内的可点击图形
        if (el.getAttribute('onclick') || el.style.cursor === 'pointer' || getComputedStyle(el).cursor === 'pointer')
          return true;
      }
    }

    return false;
  }

  /** 处理碰撞事件 */
  function _handleCollision(el, rect, distX, distY, dist, ballR) {
    _collidedEl = el;

    // 1. 计算反弹方向（沿碰撞法线方向弹开）
    if (dist > 0.01) {
      var nx = distX / dist; // 法线 x
      var ny = distY / dist; // 法线 y

      // 反射速度向量
      var dotProduct = _vx * nx + _vy * ny;
      if (dotProduct < 0) {
        // 只有朝向元素时才反弹
        _vx -= 2 * dotProduct * nx * CFG.bounceRestitution;
        _vy -= 2 * dotProduct * ny * CFG.bounceRestitution;

        // 添加随机扰动，让弹开更有趣
        _vx += (Math.random() - 0.5) * 120;
        _vy += (Math.random() - 0.5) * 120;

        // 弹开时旋转加速
        _rotationSpeed += (Math.random() - 0.5) * 10;
      }

      // 将球推出元素范围
      var overlap = ballR - dist;
      if (overlap > 0) {
        _x += nx * overlap * 1.1;
        _y += ny * overlap * 1.1;
      }
    } else {
      // 球心在元素内部，强制弹出
      _vx = (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random() * 200);
      _vy = -(150 + Math.random() * 150); // 主要向上弹
    }

    // 2. 设置冷却（防止同一元素连续碰撞）
    _collisionCooldown = 500; // 500ms 冷却

    // 3. 触发悬浮效果！
    _triggerHoverEffect(el);
  }

  // ==================== 悬浮效果 ====================

  /** 触发鼠标悬浮效果 */
  function _triggerHoverEffect(el) {
    _hoverTarget = el;
    _hoverDuration = CFG.hoverDuration;

    try {
      // 触发 mouseenter
      var enterEvt = new MouseEvent('mouseenter', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2,
        clientY: el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2,
      });
      el.dispatchEvent(enterEvt);

      // 触发 mouseover
      var overEvt = new MouseEvent('mouseover', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: enterEvt.clientX,
        clientY: enterEvt.clientY,
      });
      el.dispatchEvent(overEvt);

      // 触发 mousemove（模拟在按钮上移动）
      for (var i = 0; i < 3; i++) {
        (function (idx) {
          setTimeout(function () {
            if (!_hoverTarget) return;
            var moveEvt = new MouseEvent('mousemove', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: enterEvt.clientX + (idx - 1) * 5,
              clientY: enterEvt.clientY + (Math.random() - 0.5) * 4,
            });
            el.dispatchEvent(moveEvt);
          }, idx * 80);
        })(i);
      }

      // 可选：给被碰撞元素加一个临时高亮样式
      el.style.transition = 'box-shadow 0.2s ease, transform 0.15s ease';
      el.style.boxShadow = '0 0 20px rgba(245,158,11,0.6), 0 0 40px rgba(245,158,11,0.25)';
      el.style.transform = 'scale(1.03)';
      el.setAttribute('__ball_hit__', 'true');
    } catch (err) {
      console.warn('[球球] 悬浮效果触发失败:', err);
    }
  }

  /** 结束悬浮效果 */
  function _endHoverEffect() {
    if (!_hoverTarget) return;

    try {
      // 触发 mouseleave
      var leaveEvt = new MouseEvent('mouseleave', {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      _hoverTarget.dispatchEvent(leaveEvt);

      // 移除临时高亮
      if (_hoverTarget.getAttribute('__ball_hit__') === 'true') {
        _hoverTarget.style.boxShadow = '';
        _hoverTarget.style.transform = '';
        _hoverTarget.removeAttribute('__ball_hit__');
        _hoverTarget.style.transition = '';
      }
    } catch (e) {
      /* ignore */
    }

    _hoverTarget = null;
    _hoverDuration = 0;
  }

  // ==================== 渲染 ====================

  function _render() {
    if (!_container) return;
    var r = _radius * _scale;
    _container.style.left = _x - r + 'px';
    _container.style.top = _y - r + 'px';
    _container.style.transform = 'rotate(' + (_rotation * 180) / Math.PI + 'deg)';
  }

  // ==================== 主循环 ====================

  var _age = 0; // 存活时长 ms

  function _gameLoop(timestamp) {
    if (!_active) return;

    var dt = _lastTime ? timestamp - _lastTime : 16;
    _lastTime = timestamp;
    dt = Math.min(dt, 50); // 防止跳帧

    // 物理更新
    _updatePhysics(dt / 1000);

    // 冷却计时器
    if (_collisionCooldown > 0) _collisionCooldown -= dt;
    if (_hoverDuration > 0) {
      _hoverDuration -= dt;
      if (_hoverDuration <= 0) {
        _endHoverEffect();
      }
    }

    // 存活时间
    _age += dt;
    if (_age > CFG.lifetime) {
      // 时间到了，淡出消失
      if (_container) {
        _container.style.opacity = '0';
        _container.style.transition = 'opacity 0.5s ease-out';
      }
      setTimeout(function () {
        destroy();
      }, 500);
      return;
    }

    // 渲染
    _render();

    _rafId = requestAnimationFrame(_gameLoop);
  }

  // ==================== 公开 API ====================

  /**
   * 让球球进入网页捣乱
   * @param {Object} [opts]
   * @param {string} [opts.targetSelector] - 目标选择器（可选，指定则优先撞向该元素）
   * @param {number} [opts.duration] - 存活时长 ms
   */
  function launch(opts) {
    opts = opts || {};
    try {
      // 清理之前可能存在的实例
      _destroy();

      if (opts.duration) CFG.lifetime = opts.duration;

      _create();
      _active = true;
      _age = 0;
      _lastTime = 0;
      _collisionCooldown = 0;

      // 入场动画
      if (_container) {
        _container.style.opacity = '0';
        _container.style.transform = 'scale(0.3)';
        requestAnimationFrame(function () {
          if (_container) {
            _container.style.transition = 'opacity 0.3s ease-out, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            _container.style.opacity = '1';
            _container.style.transform = 'rotate(0deg) scale(1)';
          }
        });
      }

      // 启动物理循环
      _rafId = requestAnimationFrame(_gameLoop);
    } catch (err) {
      console.error('[球球实体] 启动失败:', err);
    }
  }

  function isActive() {
    return _active;
  }
  function getPosition() {
    return { x: _x, y: _y };
  }
  function getVelocity() {
    return { vx: _vx, vy: _vy };
  }

  function destroy() {
    _endHoverEffect();
    _destroy();
  }

  // 暴露全局 API
  window.__ball_entity__ = {
    launch: launch,
    isActive: isActive,
    getPosition: getPosition,
    getVelocity: getVelocity,
    destroy: destroy,
  };
})();
