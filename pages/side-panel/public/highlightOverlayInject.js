/**
 * 元素高亮覆盖层 - 页面注入脚本（纯 JS 版）
 *
 * 接收 selector / xpath / duration，在目标元素位置画一个红色脉冲框，
 * duration 毫秒后自动消失。Side-panel 的 TeachingDialog 里
 * 「在页面上看」按钮触发：background → chrome.scripting.executeScript 注入本脚本
 * → 调用 window.__nb_highlight_element__(selector, xpath, duration)。
 *
 * 设计要点：
 *  - 优先 querySelector(selector)，找不到再 XPath evaluate
 *  - 元素若在 viewport 外，自动 scrollIntoView (smooth, center)
 *  - z-index 极大 (2147483647)，绕过页面 z-index 战争
 *  - pointer-events: none，不影响用户与页面交互
 */
(function () {
  'use strict';
  if (window.__nb_highlight_inited__) return;
  window.__nb_highlight_inited__ = true;

  /**
   * @param {string|undefined} selector
   * @param {string|undefined} xpath
   * @param {number} duration  毫秒
   */
  window.__nb_highlight_element__ = function (selector, xpath, duration) {
    duration = typeof duration === 'number' && duration > 0 ? duration : 2000;
    let el = null;

    if (selector) {
      try {
        el = document.querySelector(selector);
      } catch {
        /* selector 非法 → 落到 xpath */
      }
    }
    if (!el && xpath) {
      try {
        const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (r && r.singleNodeValue && r.singleNodeValue.nodeType === 1) {
          el = r.singleNodeValue;
        }
      } catch {
        /* xpath 非法 */
      }
    }
    if (!el) {
      console.warn('[nb_highlight] element not found:', { selector: selector, xpath: xpath });
      return;
    }

    // 滚到视口内
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch {
      /* 老内核不支持 options */
    }

    const rect = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;' +
      'border:3px solid #dc2626;border-radius:4px;' +
      'box-shadow:0 0 0 4px rgba(220,38,38,0.25), 0 0 18px rgba(220,38,38,0.55);' +
      'transition:opacity 0.3s ease;animation:nb-hl-pulse 0.9s ease-in-out infinite;' +
      'box-sizing:border-box;background:transparent;';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';

    // 注入一次脉冲动画样式（重复注入也无害）
    if (!document.getElementById('nb-hl-style')) {
      const style = document.createElement('style');
      style.id = 'nb-hl-style';
      style.textContent =
        '@keyframes nb-hl-pulse {' +
        '  0%, 100% { box-shadow: 0 0 0 4px rgba(220,38,38,0.25), 0 0 18px rgba(220,38,38,0.55); }' +
        '  50% { box-shadow: 0 0 0 8px rgba(220,38,38,0.10), 0 0 28px rgba(220,38,38,0.80); }' +
        '}';
      document.documentElement.appendChild(style);
    }

    document.documentElement.appendChild(box);

    setTimeout(function () {
      box.style.opacity = '0';
      setTimeout(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      }, 300);
    }, duration);
  };
})();
