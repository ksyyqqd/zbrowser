/**
 * 器灵遮罩层 - 页面注入脚本（纯 JS 版）
 * 在任意网页上覆盖 Canvas 遮罩，支持写字 + 放烟花
 */
(function () {
  'use strict';
  if (window.__spirit_overlay_inited__) return;
  window.__spirit_overlay_inited__ = true;

  var _oc = null,
    _cv = null,
    _cx = null,
    _aid = null;
  var _fws = [],
    _pts = [],
    _wts = [];
  var _active = false;
  var _CLRS = ['#D97706', '#DC2626', '#40916C', '#A78BFA', '#EC4899', '#06B6D4', '#F97316', '#FAF8F5'];

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
    _cx = _cv.getContext('2d');
    _oc.appendChild(_cv);
    document.documentElement.appendChild(_oc);
    window.addEventListener('resize', function () {
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
  function _lf(x, y) {
    if (!_active) _init();
    var sx = x !== undefined ? x : Math.random() * _cv.width * 0.6 + _cv.width * 0.2;
    var sy = _cv.height;
    var tx = x !== undefined ? x : Math.random() * _cv.width * 0.7 + _cv.width * 0.15;
    var ty = y !== undefined ? y : Math.random() * _cv.height * 0.4 + _cv.height * 0.1;
    var c = _CLTRS[Math.floor(Math.random() * _CLTRS.length)];
    _fws.push({
      x: sx,
      y: sy,
      targetX: tx,
      targetY: ty,
      speed: 3 + Math.random() * 3,
      angle: Math.atan2(ty - sy, tx - sx),
      trail: [],
      color: c,
      exploded: false,
    });
  }
  function _lmc(n) {
    n = n || 5;
    for (var i = 0; i < n; i++)
      setTimeout(
        function () {
          _lf();
        },
        i * 200 + Math.random() * 300,
      );
  }
  function _updFW() {
    for (var i = _fws.length - 1; i >= 0; i--) {
      var f = _fws[i];
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
  function _expl(f) {
    for (var i = 0; i < 50; i++) {
      var a = ((Math.PI * 2) / 50) * i + Math.random() * 0.5,
        sp = 1.5 + Math.random() * 4;
      _pts.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        alpha: 1,
        color: f.color,
        size: 1.5 + Math.random() * 2.5,
        decay: 0.012 + Math.random() * 0.015,
        gravity: 0.04 + Math.random() * 0.02,
      });
    }
    for (var i = 0; i < 12; i++) {
      var a = Math.random() * Math.PI * 2,
        sp = 0.5 + Math.random() * 1.5;
      _pts.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        alpha: 1,
        color: '#FAF8F5',
        size: 1 + Math.random(),
        decay: 0.008,
        gravity: 0.02,
      });
    }
  }
  function _updPT() {
    for (var i = _pts.length - 1; i >= 0; i--) {
      var p = _pts[i];
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
    for (var fi = 0; fi < _fws.length; fi++) {
      var f = _fws[fi];
      if (f.trail.length < 2) continue;
      _cx.beginPath();
      _cx.moveTo(f.trail[0].x, f.trail[0].y);
      for (var ti = 1; ti < f.trail.length; ti++) _cx.lineTo(f.trail[ti].x, f.trail[ti].y);
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
    for (var pi = 0; pi < _pts.length; pi++) {
      var p = _pts[pi];
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
  function _wt(t, o) {
    o = o || {};
    if (!_active) _init();
    var colorChoices = ['#D97706', '#DC2626', '#40916C'];
    var typeChoices = ['calligraphy', 'floating', 'seal'];
    _wts.push({
      text: t,
      x: o.x !== undefined ? o.x : _cv.width / 2 + (Math.random() - 0.5) * 200,
      y: o.y !== undefined ? o.y : _cv.height / 2 + (Math.random() - 0.5) * 150,
      targetAlpha: 1,
      currentAlpha: 0,
      scale: 0.3,
      rotation: (Math.random() - 0.5) * 0.15,
      color: o.color || colorChoices[Math.floor(Math.random() * colorChoices.length)],
      font: 'bold ' + (o.fontSize || 28 + Math.floor(Math.random() * 24)) + 'px "STKaiti","KaiTi",serif',
      birthTime: Date.now(),
      duration: o.duration || 3000 + Math.random() * 3000,
      type: o.type || typeChoices[Math.floor(Math.random() * typeChoices.length)],
    });
  }
  function _updWT() {
    var now = Date.now();
    for (var i = _wts.length - 1; i >= 0; i--) {
      var w = _wts[i],
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
    for (var wi = 0; wi < _wts.length; wi++) {
      var wt = _wts[wi];
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
        var sw = Math.max(40, wt.text.length * 22),
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
        var chs = wt.text.split('');
        if (chs.length <= 2) _cx.fillText(chs.join(''), 0, 0);
        else
          for (var ci = 0; ci < chs.length; ci++)
            _cx.fillText(chs[ci], 0, -sh * 0.28 + ci * ((sh * 0.56) / (chs.length - 1)));
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
    delete window.__spirit_overlay_inited__;
  }

  // 暴露 API
  window.__spirit_overlay__ = {
    launchFirework: _lf,
    launchMultipleFireworks: _lmc,
    showFireworksShow: function (d) {
      d = d || 6000;
      var e = 0,
        iv = setInterval(function () {
          _lmc(1 + Math.floor(Math.random() * 3));
          e += 250;
          if (e >= d) clearInterval(iv);
        }, 250);
      setTimeout(function () {
        clearInterval(iv);
      }, d);
    },
    writeText: _wt,
    writeBlessings: function (ts) {
      for (var i = 0; i < ts.length; i++)
        (function (t, i) {
          setTimeout(
            function () {
              _wt(t);
            },
            i * 400 + Math.random() * 300,
          );
        })(ts[i], i);
    },
    celebrate: function (msg) {
      msg = msg || '妙哉！';
      _wt(msg, { type: 'calligraphy', fontSize: 36, duration: 5000 });
      setTimeout(function () {
        window.__spirit_overlay__.showFireworksShow(4000);
      }, 800);
      setTimeout(function () {
        window.__spirit_overlay__.writeBlessings(['妙哉~', '道友吉祥', '功德圆满']);
      }, 1200);
    },
    destroy: _destroy,
    isActive: function () {
      return _active;
    },
  };
})();
