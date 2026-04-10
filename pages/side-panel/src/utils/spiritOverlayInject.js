/**
 * 器灵遮罩层 - 页面注入脚本（内联版，用于 chrome.scripting.executeScript）
 * 在任意网页上覆盖半透明 Canvas 遮罩，支持写字 + 放烟花
 */
(function () {
  'use strict';

  // 防止重复注入
  if ((window as any).__spirit_overlay_inited__) return;
  (window as any).__spirit_overlay_inited__ = true;

  let _oc: HTMLDivElement | null = null;
  let _cv: HTMLCanvasElement | null = null;
  let _cx: CanvasRenderingContext2D | null = null;
  let _aid: number | null = null;
  let _fws: any[] = [];
  let _pts: any[] = [];
  let _wts: any[] = [];
  let _active = false;
  const _CLRS = ['#D97706', '#DC2626', '#40916C', '#A78BFA', '#EC4899', '#06B6D4', '#F97316', '#FAF8F5'];

  function _init() {
    if (_oc) return;
    _oc = document.createElement('div');
    Object.assign(_oc.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483647',
      pointerEvents: 'none',
      overflow: 'hidden',
    });
    _cv = document.createElement('canvas');
    _cv.width = window.innerWidth;
    _cv.height = window.innerHeight;
    _cv.style.width = '100%';
    _cv.style.height = '100%';
    _cx = _cv.getContext('2d')!;
    _oc.appendChild(_cv);
    document.documentElement.appendChild(_oc);
    window.addEventListener('resize', () => {
      if (_cv) {
        _cv.width = window.innerWidth;
        _cv.height = window.innerHeight;
      }
    });
    _active = true;
    _loop();
  }

  function _loop() {
    if (!_cx || !_cv) return;
    _cx.clearRect(0, 0, _cv.width, _cv.height);
    _updFW();
    _drawFW();
    _updPT();
    _drawPT();
    _updWT();
    _drawWT();
    _aid = requestAnimationFrame(_loop);
  }

  // ---- 烟花 ----
  function _lf(x?: number, y?: number) {
    if (!_active) _init();
    const sx = x ?? Math.random()! * _cv!.width * 0.6 + _cv!.width * 0.2;
    const sy = _cv!.height;
    const tx = x ?? Math.random()! * _cv!.width * 0.7 + _cv!.width * 0.15;
    const ty = y ?? Math.random()! * _cv!.height * 0.4 + _cv!.height * 0.1;
    const c = _CLTRS[Math.floor(Math.random()! * _CLTRS.length)];
    _fws.push({
      x: sx,
      y: sy,
      targetX: tx,
      targetY: ty,
      speed: 3 + Math.random()! * 3,
      angle: Math.atan2(ty - sy, tx - sx),
      trail: [],
      color: c,
      exploded: false,
    });
  }
  function _lmc(n = 5) {
    for (let i = 0; i < n; i++) setTimeout(() => _lf(), i * 200 + Math.random()! * 300);
  }
  function _updFW() {
    for (let i = _fws.length - 1; i >= 0; i--) {
      const f = _fws[i];
      if (!f.exploded) {
        f.x += Math.cos(f.angle) * f.speed;
        f.y += Math.sin(f.angle) * f.speed;
        f.trail.push({ x: f.x, y: f.y });
        if (f.trail.length > 10) f.trail.shift();
        if (Math.hypot(f.x - f.targetX, f.y - f.targetY) < 15) {
          _expl(f);
          _fws.splice(i, 1);
        }
      }
    }
  }
  function _expl(f: any) {
    for (let i = 0; i < 50; i++) {
      const a = ((Math.PI * 2) / 50) * i + Math.random()! * 0.5,
        sp = 1.5 + Math.random()! * 4;
      _pts.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        alpha: 1,
        color: f.color,
        size: 1.5 + Math.random()! * 2.5,
        decay: 0.012 + Math.random()! * 0.015,
        gravity: 0.04 + Math.random()! * 0.02,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random()! * Math.PI * 2,
        sp = 0.5 + Math.random()! * 1.5;
      _pts.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        alpha: 1,
        color: '#FAF8F5',
        size: 1 + Math.random()!,
        decay: 0.008,
        gravity: 0.02,
      });
    }
  }
  function _updPT() {
    for (let i = _pts.length - 1; i >= 0; i--) {
      const p = _pts[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.alpha -= p.decay;
      p.vx *= 0.98;
      if (p.alpha <= 0) _pts.splice(i, 1);
    }
  }
  function _drawFW() {
    if (!_cx) return;
    for (const f of _fws) {
      if (f.trail.length < 2) continue;
      _cx.beginPath();
      _cx.moveTo(f.trail[0].x, f.trail[0].y);
      for (let i = 1; i < f.trail.length; i++) _cx.lineTo(f.trail[i].x, f.trail[i].y);
      _cx.strokeStyle = f.color;
      _cx.lineWidth = 2;
      _cx.lineCap = 'round';
      _cx.globalAlpha = 0.8;
      _cx.stroke();
    }
    _cx.globalAlpha = 1;
  }
  function _drawPT() {
    if (!_cx) return;
    for (const p of _pts) {
      _cx.beginPath();
      _cx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      _cx.fillStyle = p.color;
      _cx.globalAlpha = p.alpha;
      _cx.fill();
      _cx.shadowColor = p.color;
      _cx.shadowBlur = 6;
      _cx.fill();
      _cx.shadowBlur = 0;
    }
    _cx.globalAlpha = 1;
  }

  // ---- 写字 ----
  function _wt(t: string, o: any = {}) {
    if (!_active) _init();
    _wts.push({
      text: t,
      x: o.x ?? _cv!.width / 2 + (Math.random()! - 0.5) * 200,
      y: o.y ?? _cv!.height / 2 + (Math.random()! - 0.5) * 150,
      targetAlpha: 1,
      currentAlpha: 0,
      scale: 0.3,
      rotation: (Math.random()! - 0.5) * 0.15,
      color: o.color || ['#D97706', '#DC2626', '#40916C'][Math.floor(Math.random()! * 3)],
      font: 'bold ' + (o.fontSize ?? 28 + Math.floor(Math.random()! * 24)) + 'px "STKaiti","KaiTi",serif',
      birthTime: Date.now(),
      duration: o.duration ?? 3000 + Math.random()! * 3000,
      type: o.type || (['calligraphy', 'floating', 'seal'] as const)[Math.floor(Math.random()! * 3)],
    });
  }
  function _updWT() {
    const now = Date.now();
    for (let i = _wts.length - 1; i >= 0; i--) {
      const w = _wts[i],
        age = now - w.birthTime;
      if (age > w.duration) {
        w.targetAlpha = 0;
        if (w.currentAlpha <= 0.01) {
          _wts.splice(i, 1);
          continue;
        }
      } else if (age < 500) {
        w.currentAlpha = age / 500;
        w.scale = 0.3 + (age / 500) * 0.7;
      }
      if (w.type === 'floating') w.y += Math.sin(age * 0.002) * 0.3;
    }
  }

  function _drawWT() {
    if (!_cx || !_cv) return;
    for (const wt of _wts) {
      _cx.save();
      _cx.translate(wt.x, wt.y);
      _cx.rotate(wt.rotation);
      _cx.scale(wt.scale, wt.scale);
      _cx.globalAlpha = wt.currentAlpha;
      if (wt.type === 'calligraphy') {
        _cx.font = wt.font;
        _cx.textAlign = 'center';
        _cx.textBaseline = 'middle';
        _cx.strokeStyle = 'rgba(28,25,23,0.3)';
        _cx.lineWidth = 3;
        _cx.strokeText(wt.text, 0, 0);
        _cx.fillStyle = wt.color;
        _cx.fillText(wt.text, 0, 0);
      } else if (wt.type === 'seal') {
        const sw = Math.max(40, wt.text.length * 22),
          sh = sw;
        _cx.beginPath();
        _cx.roundRect(-sw / 2, -sh / 2, sw, sh, 4);
        _cx.strokeStyle = '#DC2626';
        _cx.lineWidth = 2.5;
        _cx.stroke();
        _cx.font = 'bold ' + Math.min(sw * 0.55, 20) + 'px serif';
        _cx.fillStyle = '#DC2626';
        _cx.textAlign = 'center';
        _cx.textBaseline = 'middle';
        const chs = wt.text.split('');
        if (chs.length <= 2) _cx.fillText(chs.join(''), 0, 0);
        else
          chs.forEach((ch: string, idx: number) =>
            _cx.fillText(ch, 0, -sh * 0.28 + idx * ((sh * 0.56) / (chs.length - 1))),
          );
      } else {
        _cx.font = wt.font;
        _cx.textAlign = 'center';
        _cx.textBaseline = 'middle';
        _cx.shadowColor = wt.color;
        _cx.shadowBlur = 15;
        _cx.fillStyle = wt.color;
        _cx.fillText(wt.text, 0, 0);
        _cx.shadowBlur = 0;
        _cx.globalAlpha = wt.currentAlpha * 0.5;
        _cx.fillStyle = '#FAF8F5';
        _cx.fillText(wt.text, 0, 0);
      }
      _cx.restore();
    }
    _cx.globalAlpha = 1;
  }

  function _destroy() {
    if (_aid) {
      cancelAnimationFrame(_aid);
      _aid = null;
    }
    if (_oc && _oc.parentNode) _oc.parentNode.removeChild(_oc);
    _oc = null;
    _cv = null;
    _cx = null;
    _fws = [];
    _pts = [];
    _wts = [];
    _active = false;
    delete (window as any).__spirit_overlay_inited__;
  }

  // 暴露 API
  (window as any).__spirit_overlay__ = {
    launchFirework: _lf,
    launchMultipleFireworks: _lmc,
    showFireworksShow: (d = 6000) => {
      let e = 0;
      const iv = setInterval(() => {
        _lmc(1 + Math.floor(Math.random()! * 3));
        e += 250;
        if (e >= d) clearInterval(iv);
      }, 250);
      setTimeout(() => clearInterval(iv), d);
    },
    writeText: _wt,
    writeBlessings: (ts: string[]) => ts.forEach((t, i) => setTimeout(() => _wt(t), i * 400 + Math.random()! * 300)),
    celebrate: (msg: string) => {
      _wt(msg, { type: 'calligraphy', fontSize: 36, duration: 5000 });
      setTimeout(() => {
        (window as any).__spirit_overlay__?.showFireworksShow?.(4000);
      }, 800);
      setTimeout(() => {
        (window as any).__spirit_overlay__?.writeBlessings?.(['妙哉~', '道友吉祥', '功德圆满']);
      }, 1200);
    },
    destroy: _destroy,
    isActive: () => _active,
  };
})();
