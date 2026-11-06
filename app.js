/* ==========================================================================
   系统之美 · 互动研习室
   Vanilla JS. No dependencies, no build step.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STORAGE_KEY = 'system-beauty-v1';
  const SANDBOX_KEY = 'system-beauty-sandbox-v1';
  const MODULE_IDS = ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06', 'ch07', 'ch08', 'ch09', 'ch10', 'ch11'];

  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  };
  const writeJSON = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { return false; }
  };

  const savedState = readJSON(STORAGE_KEY, {});
  const state = {
    progress: savedState.progress && typeof savedState.progress === 'object' ? savedState.progress : {},
    quizBest: Number(savedState.quizBest) || 0,
    theme: savedState.theme === 'dark' ? 'dark' : 'light',
    sound: Boolean(savedState.sound),
    loopCount: Number(savedState.loopCount) || 0,
    chapterQuizzes: savedState.chapterQuizzes && typeof savedState.chapterQuizzes === 'object' ? savedState.chapterQuizzes : {}
  };
  const saveState = () => writeJSON(STORAGE_KEY, state);

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const formatNumber = (n, digits = 0) => {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  };
  const formatCompact = (n) => {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return `${Math.round(n)}`;
  };
  const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const escapeHTML = (str) => String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  let activeChapter = 'ch00';

  /* ------------------------------------------------------------------ audio */
  class SoundEngine {
    constructor() {
      this.enabled = state.sound;
      this.ctx = null;
      this.lastTick = 0;
    }
    ensure() {
      if (!this.enabled) return false;
      try {
        if (!this.ctx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return false;
          this.ctx = new Ctx();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      } catch (err) {
        return false;
      }
    }
    note(freq, duration = .12, opts = {}) {
      if (!this.ensure()) return;
      const { type = 'sine', gain = .035, delay = 0, slide = 0 } = opts;
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      const start = ctx.currentTime + delay;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), start + duration);
      amp.gain.setValueAtTime(.0001, start);
      amp.gain.exponentialRampToValueAtTime(gain, start + .012);
      amp.gain.exponentialRampToValueAtTime(.0001, start + duration);
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + .03);
    }
    click() { this.note(420, .06, { type: 'triangle', gain: .018, slide: 80 }); }
    open() { this.note(320, .1, { type: 'sine', gain: .022 }); this.note(540, .12, { type: 'sine', gain: .018, delay: .04 }); }
    tick() {
      const now = performance.now();
      if (now - this.lastTick < 70) return;
      this.lastTick = now;
      this.note(660, .035, { type: 'sine', gain: .008 });
    }
    success() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.note(f, .35, { type: 'sine', gain: .028, delay: i * .07 }));
    }
    error() {
      this.note(150, .18, { type: 'sine', gain: .03, slide: -35 });
      this.note(120, .2, { type: 'triangle', gain: .012, delay: .03 });
    }
    complete() {
      [392, 523.25, 659.25, 783.99].forEach((f, i) => this.note(f, .5, { type: 'sine', gain: .026, delay: i * .075 }));
    }
    toggleOn() {
      this.note(440, .16, { type: 'sine', gain: .025 });
      this.note(660, .22, { type: 'sine', gain: .022, delay: .09 });
    }
  }
  const audio = new SoundEngine();

  /* ------------------------------------------------------------------ chart */
  class MiniChart {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.last = null;
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.ro = null;
      if ('ResizeObserver' in window) {
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas);
      }
      this.resize();
    }
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.w === rect.width && this.h === rect.height && this.dpr === dpr) return;
      this.w = rect.width;
      this.h = rect.height;
      this.dpr = dpr;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.last) this.draw(this.last);
    }
    draw(config) {
      this.last = config;
      if (!this.ctx || !this.w || !this.h) return;
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;
      const accent = cssVar('--accent');
      const gold = cssVar('--gold');
      const coral = cssVar('--coral');
      const line = cssVar('--line');
      const lineStrong = cssVar('--line-strong');
      const muted = cssVar('--muted');
      const panel = cssVar('--panel');
      const ink = cssVar('--ink');
      const pad = config.pad || { l: 38, r: 15, t: 14, b: 23 };
      const pw = w - pad.l - pad.r;
      const ph = h - pad.t - pad.b;
      if (pw <= 0 || ph <= 0) return;
      ctx.clearRect(0, 0, w, h);

      let xMin = Number.isFinite(config.xMin) ? config.xMin : 0;
      let xMax = Number.isFinite(config.xMax) ? config.xMax : 1;
      if (xMax <= xMin) xMax = xMin + 1;
      const allY = [];
      (config.series || []).forEach((s) => (s.values || []).forEach((p) => {
        if (Number.isFinite(p.y)) allY.push(p.y);
      }));
      if (config.markers) config.markers.forEach((m) => { if (Number.isFinite(m.y)) allY.push(m.y); });
      let yMin = Number.isFinite(config.yMin) ? config.yMin : Math.min(...allY, 0);
      let yMax = Number.isFinite(config.yMax) ? config.yMax : Math.max(...allY, 1);
      if (allY.length === 0) { yMin = 0; yMax = 1; }
      if (yMax <= yMin) yMax = yMin + 1;
      const yPad = (yMax - yMin) * .08;
      if (!Number.isFinite(config.yMin)) yMin -= yPad;
      if (!Number.isFinite(config.yMax)) yMax += yPad;
      if (yMin === yMax) yMax += 1;

      const sx = (x) => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
      const sy = (y) => pad.t + ph - ((y - yMin) / (yMax - yMin)) * ph;
      const xFormat = config.xFormat || ((v) => Math.round(v));
      const yFormat = config.yFormat || ((v) => formatCompact(v));

      ctx.font = '9px "SFMono-Regular", Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const v = yMin + (yMax - yMin) * (i / yTicks);
        const y = sy(v);
        ctx.beginPath();
        ctx.strokeStyle = i === 0 ? lineStrong : line;
        ctx.lineWidth = 1;
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
        ctx.fillStyle = muted;
        ctx.textAlign = 'right';
        ctx.fillText(yFormat(v), pad.l - 7, y);
      }
      const xTicks = 4;
      for (let i = 0; i <= xTicks; i++) {
        const v = xMin + (xMax - xMin) * (i / xTicks);
        const x = sx(v);
        ctx.beginPath();
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, pad.t + ph);
        ctx.stroke();
        ctx.fillStyle = muted;
        ctx.textAlign = i === 0 ? 'left' : i === xTicks ? 'right' : 'center';
        ctx.fillText(xFormat(v), x, pad.t + ph + 14);
      }

      if (config.target && Number.isFinite(config.target.y)) {
        const y = sy(config.target.y);
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = config.target.color || gold;
        ctx.lineWidth = 1.1;
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, pad.t - 1, pw, ph + 2);
      ctx.clip();

      (config.series || []).forEach((s) => {
        const points = (s.values || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (!points.length) return;
        const color = s.color || accent;
        if (s.fill) {
          ctx.save();
          ctx.globalAlpha = s.fillAlpha == null ? .08 : s.fillAlpha;
          ctx.beginPath();
          ctx.moveTo(sx(points[0].x), pad.t + ph);
          points.forEach((p) => ctx.lineTo(sx(p.x), sy(p.y)));
          ctx.lineTo(sx(points[points.length - 1].x), pad.t + ph);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          ctx.restore();
        }
        ctx.beginPath();
        points.forEach((p, i) => {
          const px = sx(p.x);
          const py = sy(p.y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = s.width || 1.7;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (s.dash) ctx.setLineDash(s.dash);
        else ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (s.dot && points.length) {
          const last = points[points.length - 1];
          ctx.beginPath();
          ctx.arc(sx(last.x), sy(last.y), 3.2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx(last.x), sy(last.y), 6.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = .13;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      });

      (config.markers || []).forEach((m) => {
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
        const color = m.color || gold;
        const px = sx(m.x);
        const py = sy(m.y);
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = .12;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(px, py, 3.7, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 4.6, 0, Math.PI * 2);
        ctx.strokeStyle = panel;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
      ctx.restore();

      if (config.yLabel) {
        ctx.save();
        ctx.translate(11, pad.t + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = muted;
        ctx.textAlign = 'center';
        ctx.font = '8px "SFMono-Regular", Menlo, Consolas, monospace';
        ctx.fillText(config.yLabel, 0, 0);
        ctx.restore();
      }
    }
  }

  /* --------------------------------------------------------------- progress */
  function completedCount() {
    return MODULE_IDS.filter((id) => state.progress[id]).length;
  }

  function chapterQuizIsComplete(id) {
    const questions = chapterQuizData?.[id];
    if (!questions) return false;
    return getChapterAnswers(id).every((answer) => answer !== null);
  }

  function updateCompleteHints() {
    $$('[data-complete]').forEach((btn) => {
      const id = btn.dataset.complete;
      const small = $('.complete-copy small', btn);
      if (!small) return;
      if (state.progress[id]) {
        small.textContent = '点击取消完成状态';
      } else if (chapterQuizIsComplete(id)) {
        small.textContent = '自测完成 · 可以点亮本章';
      } else {
        small.textContent = '建议先完成上方自测';
      }
    });
  }

  function updateProgressUI() {
    const done = completedCount();
    const pct = Math.round((done / MODULE_IDS.length) * 100);
    $('#sidePct').textContent = pct;
    $('#progressOrbit').style.setProperty('--p', pct);
    $('#sideDone').textContent = `${done} / ${MODULE_IDS.length} 模块`;
    $$('[data-complete]').forEach((btn) => {
      const id = btn.dataset.complete;
      const isDone = Boolean(state.progress[id]);
      btn.classList.toggle('is-complete', isDone);
      btn.setAttribute('aria-pressed', String(isDone));
      const copy = $('.complete-copy b', btn);
      if (copy) copy.textContent = isDone ? '本章已点亮' : (id === 'ch11' ? '标记全书完成' : '标记本章完成');
      const small = $('.complete-copy small', btn);
      if (small) small.textContent = isDone ? '点击取消完成状态' : '点亮你的学习轨迹';
    });
    updateCompleteHints();
    $$('.nav-item[data-go]').forEach((item) => {
      item.classList.toggle('is-complete', Boolean(state.progress[item.dataset.go]));
    });
    $$('[data-map-node]').forEach((node) => {
      node.classList.toggle('is-done', Boolean(state.progress[node.dataset.mapNode]));
    });
    updateReport();
  }

  function toggleComplete(id) {
    state.progress[id] = !state.progress[id];
    saveState();
    updateProgressUI();
    if (state.progress[id]) {
      audio.complete();
      celebrate();
      toast(`已点亮 ${id.replace('ch', '')} · ${$(`#${id}`).dataset.title}`);
    } else {
      audio.click();
      toast('已取消本章完成状态');
    }
  }

  function updateReport() {
    if (!$('#reportPct')) return;
    const done = completedCount();
    const pct = Math.round((done / MODULE_IDS.length) * 100);
    $('#reportPct').textContent = pct;
    $('#reportRing').style.setProperty('--p', pct);
    $('#reportModules').textContent = `${done} / ${MODULE_IDS.length}`;
    $('#reportBest').textContent = state.quizBest ? `${state.quizBest} / 10` : '—';
    $('#reportLoops').textContent = state.loopCount || 0;
    const quizStats = chapterQuizStats();
    if ($('#reportQuizzes')) $('#reportQuizzes').textContent = `${quizStats.answered} / ${quizStats.total}`;
    const messages = [
      '从任何一个模块开始都可以。系统思考不要求一条直线，它更像反复回到同一张地图。',
      '已经开始看见结构了。继续往下走，留意那些让你感到意外的反馈。',
      '你的系统地图正在成形。试着把最近的工程问题放进回路里想一想。',
      '大半程了。现在回到任何一章，你可能会看到第一次没看见的东西。',
      '几乎走完了。最后一件事：把系统思考从概念变成下次复盘时的第一个问题。'
    ];
    $('#reportMessage').textContent = messages[Math.min(messages.length - 1, Math.floor(pct / 22))];
  }

  /* ------------------------------------------------------------------ toast */
  let toastTimer = 0;
  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  /* --------------------------------------------------------------- confetti */
  function celebrate() {
    if (prefersReducedMotion()) return;
    const canvas = $('#confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = [cssVar('--accent'), cssVar('--gold'), cssVar('--coral'), cssVar('--blue')];
    const bits = Array.from({ length: 54 }, () => ({
      x: w * (.2 + Math.random() * .6),
      y: h * (.34 + Math.random() * .1),
      vx: (Math.random() - .5) * 7,
      vy: -Math.random() * 8 - 2,
      size: 3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - .5) * .25,
      life: 1
    }));
    let frame = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, w, h);
      bits.forEach((b) => {
        b.vy += .22;
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= .995;
        b.rot += b.vr;
        b.life -= .009;
        ctx.save();
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * .55);
        ctx.restore();
      });
      if (frame < 130) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    tick();
  }

  /* ------------------------------------------------------------------ modals */
  let lastFocused = null;
  function openModal(layer, focusTarget) {
    if (!layer) return;
    closeModals(false);
    lastFocused = document.activeElement;
    layer.hidden = false;
    document.body.classList.add('modal-open');
    const target = focusTarget || layer.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (target) setTimeout(() => target.focus({ preventScroll: true }), 30);
    audio.open();
  }
  function closeModals(restoreFocus = true) {
    const openLayers = $$('.modal-layer:not([hidden])');
    if (!openLayers.length) return;
    openLayers.forEach((layer) => { layer.hidden = true; });
    if (!$$('.modal-layer:not([hidden])').length) document.body.classList.remove('modal-open');
    if (restoreFocus && lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------------ theme */
  function applyTheme(theme, silent = false) {
    document.documentElement.dataset.theme = theme;
    const isDark = theme === 'dark';
    const use = $('#themeIconUse');
    if (use) use.setAttribute('href', isDark ? '#i-sun' : '#i-moon');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#0a120f' : '#f2efe6');
    $('#themeBtn')?.setAttribute('aria-label', isDark ? '切换到明亮主题' : '切换到暗色主题');
    if (!silent) {
      state.theme = theme;
      saveState();
      requestAnimationFrame(() => {
        refreshCharts();
        audio.open();
      });
    }
  }

  function initTheme() {
    applyTheme(state.theme, true);
    $('#themeBtn').addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
  }

  function initSound() {
    const btn = $('#soundBtn');
    const icon = $('#soundIconUse');
    const sync = () => {
      const on = audio.enabled;
      if (icon) icon.setAttribute('href', on ? '#i-sound' : '#i-mute');
      btn.setAttribute('aria-label', on ? '关闭音效' : '打开音效');
      btn.classList.toggle('is-on', on);
      btn.title = on ? '音效已开启' : '音效已关闭';
    };
    sync();
    btn.addEventListener('click', () => {
      audio.enabled = !audio.enabled;
      state.sound = audio.enabled;
      saveState();
      sync();
      if (audio.enabled) {
        audio.ensure();
        audio.toggleOn();
        toast('音效已开启 · 交互会发出轻微声音');
      } else {
        toast('音效已关闭');
      }
    });
    document.addEventListener('pointerdown', () => { if (audio.enabled) audio.ensure(); }, { once: true });
  }

  /* ------------------------------------------------------------- navigation */
  const chapterIds = ['ch00', 'ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06', 'ch07', 'ch08', 'ch09', 'ch10', 'ch11'];
  let revealObserver = null;

  function setupReveal() {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal').forEach((el) => el.classList.add('is-in'));
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: .06, rootMargin: '0px 0px -24px 0px' });
    $$('.reveal').forEach((el) => revealObserver.observe(el));
  }

  function closeSidebar() {
    document.body.classList.remove('nav-open');
    $('#scrim').hidden = true;
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  }

  function openSidebar() {
    document.body.classList.add('nav-open');
    $('#scrim').hidden = false;
    $('#menuBtn').setAttribute('aria-expanded', 'true');
  }

  function updateMapActive() {
    $$('[data-map-node]').forEach((n) => n.classList.toggle('is-active', n.dataset.mapNode === activeChapter));
  }

  function showChapter(id, opts = {}) {
    if (!chapterIds.includes(id)) id = 'ch00';
    const section = $(`#${id}`);
    if (!section) id = 'ch00';
    activeChapter = id;
    $$('.chapter').forEach((ch) => ch.classList.toggle('is-active', ch.id === id));
    $$('.nav-item[data-go]').forEach((item) => item.classList.toggle('is-active', item.dataset.go === id));
    const title = $(`#${id}`).dataset.title || '';
    $('#currentCrumb').textContent = title;
    document.title = `${title} · 系统之美`;
    closeSidebar();
    closeModals(false);
    updateMapActive();
    const readBar = $('#readBar');
    if (readBar) readBar.style.width = '0%';
    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    requestAnimationFrame(() => {
      if (id === 'ch05') resizeLife();
      if (id === 'ch02') { stockChart?.resize(); drawStockChart(); }
      if (id === 'ch03') { tempChart?.resize(); drawTempChart(); compoundChart?.resize(); renderCompound(); }
      if (id === 'ch04') { zooChart?.resize(); renderZoo(); drawAllSparks(); }
      if (id === 'ch06') { nlChart?.resize(); drawNonlinear(); }
      if (id === 'ch07') renderTrapCards();
      if (id === 'ch08') renderLeverage();
      if (id === 'ch09') renderPrinciples();
      if (id === 'ch10') { renderSandbox(); }
      if (id === 'ch11') { updateReport(); }
    });
  }

  function goTo(id, opts = {}) {
    if (!chapterIds.includes(id)) return;
    if (activeChapter === id && !opts.force) {
      closeSidebar();
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    try {
      if (opts.replace) history.replaceState(null, '', `#${id}`);
      else history.pushState(null, '', `#${id}`);
    } catch (err) {
      location.hash = id;
    }
    showChapter(id);
  }

  function initNavigation() {
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) {
        e.preventDefault();
        const id = go.dataset.go;
        const trap = go.dataset.openTrap;
        goTo(id);
        if (trap) setTimeout(() => openTrap(trap), 260);
        return;
      }
      const complete = e.target.closest('[data-complete]');
      if (complete) {
        e.preventDefault();
        toggleComplete(complete.dataset.complete);
        return;
      }
    });
    $('#menuBtn').addEventListener('click', () => {
      if (document.body.classList.contains('nav-open')) closeSidebar();
      else openSidebar();
    });
    $('#sidebarClose').addEventListener('click', closeSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    $('#mapBtn').addEventListener('click', () => {
      updateMapActive();
      updateProgressUI();
      openModal($('#mapModal'), $('#mapModal [data-close-modal]'));
    });
    $$('[data-close-modal]').forEach((el) => el.addEventListener('click', () => closeModals()));
    window.addEventListener('popstate', () => {
      const id = location.hash.replace('#', '') || 'ch00';
      if (chapterIds.includes(id)) showChapter(id, { scroll: false });
    });
    window.addEventListener('scroll', () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? clamp((window.scrollY / max) * 100, 0, 100) : 0;
      $('#readBar').style.width = `${pct}%`;
    }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if ($$('.modal-layer:not([hidden])').length) closeModals();
        else if (document.body.classList.contains('nav-open')) closeSidebar();
      }
    });
  }

  function bootChapter() {
    const hash = location.hash.replace('#', '');
    const initial = chapterIds.includes(hash) ? hash : 'ch00';
    if (!location.hash) {
      try { history.replaceState(null, '', '#ch00'); } catch (err) {}
    }
    showChapter(initial, { scroll: false });
    if (initial === 'ch00') window.scrollTo(0, 0);
  }

  /* --------------------------------------------------------------- range UI */
  function paintRange(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const val = Number(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--val', `${clamp(pct, 0, 100)}%`);
  }
  function initRanges() {
    $$('input[type="range"]').forEach((input) => {
      paintRange(input);
      input.addEventListener('input', () => {
        paintRange(input);
        audio.tick();
      });
    });
  }

  /* ================================================================== CH01 */
  function initAssembly() {
    const stage = $('#assemblyStage');
    const els = $('#asmElements');
    const conns = $('#asmConnections');
    const goal = $('#asmGoal');
    const verdictTitle = $('#asmVerdict strong');
    const verdictBody = $('#asmVerdict p');
    const status = $('#asmStatus span:last-child');
    if (!stage) return;

    const update = () => {
      stage.classList.toggle('no-elements', !els.checked);
      stage.classList.toggle('no-connections', !conns.checked);
      stage.classList.toggle('no-goal', !goal.checked);
      let title = '一个完整的系统';
      let body = '连接把要素组织起来，目标让它们的行为有了方向。';
      let statusHTML = '<strong>系统成立。</strong> 要素通过连接协作，朝一个目标持续运行。';
      if (!els.checked) {
        title = '一套没有要素的空规则';
        body = '连接和目标还在，但没有任何东西被组织起来。规则无法自己运转。';
        statusHTML = '<strong>系统解体。</strong> 没有要素，连接和目标只是抽象的想法。';
      } else if (!conns.checked) {
        title = '一堆互不相干的资产';
        body = '单车、用户、运维都还在，但扫码、调度、计费断开了。整体不再大于部分之和。';
        statusHTML = '<strong>只剩集合。</strong> 没有连接，要素之间不会产生协作与涌现。';
      } else if (!goal.checked) {
        title = '一台没有方向的机器';
        body = '要素和连接都在，却不知道为谁、为什么而运转。行为会漂移，优先级会打架。';
        statusHTML = '<strong>方向缺失。</strong> 没有目标，系统仍然在动，但不知道要往哪里去。';
      }
      verdictTitle.textContent = title;
      verdictBody.textContent = body;
      status.innerHTML = statusHTML;
      if (audio.enabled) audio.click();
    };
    [els, conns, goal].forEach((input) => input.addEventListener('change', update));
    $('#asmRandom').addEventListener('click', () => {
      const inputs = [els, conns, goal];
      const allOff = inputs.every((i) => !i.checked);
      if (allOff) inputs.forEach((i) => { i.checked = true; });
      else {
        const pick = inputs[Math.floor(Math.random() * inputs.length)];
        pick.checked = false;
      }
      update();
    });
    update();
  }

  const boundaryData = {
    narrow: {
      label: '当前边界：只看代码',
      title: '把边界画在代码内部',
      p1: '你能看见服务、依赖和数据库之间的关系。但需求压力、值班疲劳、用户信任都被留在了外面。',
      p2: '代码不是孤岛。边界外的事件仍会穿过监控、告警和用户投诉回来。'
    },
    team: {
      label: '当前边界：团队内部',
      title: '把边界画在团队内部',
      p1: '你能看见研发、需求、数据库之间的互动。但值班压力、用户信任和云成本被留在外面，它们的反馈仍会穿过边界影响你。',
      p2: '边界不是为了把世界切开，而是为了对“哪些反馈与我有关”做出选择。'
    },
    wide: {
      label: '当前边界：服务生态',
      title: '把边界扩展到服务生态',
      p1: '运维、用户信任、云成本和团队士气都进入了系统。你能看见更多反馈，也必须承担更多变量与责任。',
      p2: '扩大边界不是要把所有东西都建模，而是让关键的外部性进入决策视野。'
    }
  };
  function initBoundary() {
    const stage = $('#boundaryStage');
    if (!stage) return;
    const label = $('#boundaryLabel');
    const copy = $('#boundaryCopy');
    const buttons = $$('#boundaryToggle [data-scope]');
    const update = (scope) => {
      const data = boundaryData[scope];
      stage.dataset.scope = scope;
      label.textContent = data.label;
      copy.innerHTML = `<h3>${data.title}</h3><p>${data.p1}</p><p class="aside-note">${data.p2}</p>`;
      buttons.forEach((b) => {
        const on = b.dataset.scope === scope;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      audio.click();
    };
    buttons.forEach((b) => b.addEventListener('click', () => update(b.dataset.scope)));
    update('team');
  }

  function initFlipCards() {
    $$('[data-flip]').forEach((card) => {
      card.addEventListener('click', () => {
        const open = card.getAttribute('aria-pressed') === 'true';
        card.setAttribute('aria-pressed', String(!open));
        audio.click();
      });
    });
  }

  /* ================================================================== CH02 */
  const stock = {
    level: 28,
    inflow: 5,
    outflow: 2,
    running: false,
    success: false,
    hold: 0,
    t: 0,
    history: [{ x: 0, y: 28 }],
    chart: null
  };
  const stockChart = new MiniChart($('#stockChart'));
  stock.chart = stockChart;

  function renderStock() {
    const level = stock.level;
    const net = stock.inflow - stock.outflow;
    $('#stockLevel').textContent = level.toFixed(1);
    $('#stockNet').textContent = `净流量 ${net >= 0 ? '+' : ''}${net.toFixed(1)} L/s`;
    $('#inflowOut').textContent = `${stock.inflow.toFixed(1)} L/s`;
    $('#outflowOut').textContent = `${stock.outflow.toFixed(1)} L/s`;
    $('#statIn').textContent = stock.inflow.toFixed(1);
    $('#statOut').textContent = stock.outflow.toFixed(1);
    $('#statNet').textContent = `${net >= 0 ? '+' : ''}${net.toFixed(1)}`;
    const pct = clamp(level, 0, 100);
    $('#waterFill').style.height = `${pct}%`;
    $('#waterFill').style.setProperty('--level', `${pct}%`);
    const wave = $('.water-wave');
    if (wave) wave.style.height = `${pct}%`;
    $('#inTap').classList.toggle('is-flowing', stock.inflow > .05);
    $('#outTap').classList.toggle('is-flowing', stock.outflow > .05);
    const badge = $('#stockChallenge');
    const hint = $('#stockHint span');
    if (stock.success) {
      badge.className = 'challenge-badge is-success';
      badge.querySelector('span:last-child').textContent = '平衡达成 · 存量稳定在目标附近';
      hint.textContent = '你找到了平衡：净流量为 0，存量不再变化。系统的记忆被保持在 50 L。';
    } else if (!stock.running) {
      badge.className = 'challenge-badge';
      badge.querySelector('span:last-child').textContent = '挑战：让水位稳定在 50 L，保持 1.5 秒';
      hint.textContent = '先让进水大于出水，等水位接近 50 L 时，再把两者调成相等。';
    } else if (Math.abs(level - 50) < 4) {
      badge.className = 'challenge-badge is-close';
      badge.querySelector('span:last-child').textContent = '接近目标 · 把净流量调成 0，保持住';
      hint.textContent = '接近目标了。让进水等于出水，净流量为 0，水位就会停住。';
    } else if (net > .05) {
      badge.className = 'challenge-badge';
      badge.querySelector('span:last-child').textContent = '挑战：让水位稳定在 50 L，保持 1.5 秒';
      hint.textContent = '水位在上升。等接近 50 L 时，减小进水或增大出水。';
    } else if (net < -.05) {
      badge.className = 'challenge-badge';
      badge.querySelector('span:last-child').textContent = '挑战：让水位稳定在 50 L，保持 1.5 秒';
      hint.textContent = '水位在下降。想让它停住，需要让进水与出水相等。';
    } else {
      badge.className = 'challenge-badge';
      badge.querySelector('span:last-child').textContent = '净流量为 0 · 水位被保持';
      hint.textContent = '净流量为 0，水位会保持。只要它在 50 L 附近，就能完成挑战。';
    }
    drawStockChart();
  }

  function drawStockChart() {
    if (!stockChart) return;
    const xMax = Math.max(40, stock.t);
    const xMin = Math.max(0, xMax - 40);
    const points = stock.history.filter((p) => p.x >= xMin - .5);
    stockChart.draw({
      xMin, xMax, yMin: 0, yMax: 100,
      series: [{ values: points, color: cssVar('--accent'), width: 1.8, dot: true, fill: true, fillAlpha: .07 }],
      target: { y: 50, color: cssVar('--gold') },
      yFormat: (v) => `${Math.round(v)}`,
      xFormat: (v) => `${Math.round(v)}s`,
      yLabel: '水位 / L'
    });
  }

  function stepStock(dt) {
    if (!stock.running) return;
    stock.t += dt;
    stock.level = clamp(stock.level + (stock.inflow - stock.outflow) * dt, 0, 100);
    stock.history.push({ x: stock.t, y: stock.level });
    if (stock.history.length > 2400) stock.history.shift();
    const near = Math.abs(stock.level - 50) <= 2;
    const balanced = Math.abs(stock.inflow - stock.outflow) < .01;
    if (!stock.success && near && balanced) {
      stock.hold += dt;
      if (stock.hold >= 1.5) {
        stock.success = true;
        audio.success();
        toast('平衡达成：水位 50 L，净流量为 0');
      }
    } else if (!stock.success) {
      stock.hold = 0;
    }
    renderStock();
  }

  function initStockLab() {
    if (!$('#stockLab')) return;
    const play = $('#stockPlay');
    const reset = $('#stockReset');
    const setPlayButton = () => {
      const use = play.querySelector('use');
      const label = play.querySelector('span');
      if (use) use.setAttribute('href', stock.running ? '#i-pause' : '#i-play');
      if (label) label.textContent = stock.running ? '暂停' : stock.success ? '再观察' : '开始';
      play.setAttribute('aria-label', stock.running ? '暂停模拟' : '开始模拟');
    };
    const updateFlows = () => {
      stock.inflow = Number($('#inflow').value);
      stock.outflow = Number($('#outflow').value);
      if (!stock.running) renderStock();
    };
    $('#inflow').addEventListener('input', updateFlows);
    $('#outflow').addEventListener('input', updateFlows);
    play.addEventListener('click', () => {
      stock.running = !stock.running;
      if (stock.running && stock.success) {
        stock.success = false;
        stock.hold = 0;
      }
      setPlayButton();
      renderStock();
      audio.open();
    });
    reset.addEventListener('click', () => {
      stock.running = false;
      stock.success = false;
      stock.hold = 0;
      stock.t = 0;
      stock.level = 28;
      stock.history = [{ x: 0, y: 28 }];
      $('#inflow').value = 5;
      $('#outflow').value = 2;
      paintRange($('#inflow'));
      paintRange($('#outflow'));
      stock.inflow = 5;
      stock.outflow = 2;
      setPlayButton();
      renderStock();
      audio.click();
    });
    $$('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        let inFlow = 5, outFlow = 2;
        if (preset === 'balance') { inFlow = 3; outFlow = 3; }
        if (preset === 'drain') { inFlow = 1; outFlow = 5; }
        $('#inflow').value = inFlow;
        $('#outflow').value = outFlow;
        paintRange($('#inflow'));
        paintRange($('#outflow'));
        stock.inflow = inFlow;
        stock.outflow = outFlow;
        if (!stock.running) renderStock();
        audio.click();
      });
    });
    setPlayButton();
    renderStock();
    window.setInterval(() => {
      if (activeChapter === 'ch02' && stock.running) stepStock(.1);
    }, 100);
  }

  /* ================================================================== CH03 */
  const thermo = {
    temp: 16,
    sensor: 16,
    target: 22,
    delay: 1.5,
    feedback: true,
    heater: true,
    t: 0,
    history: [{ x: 0, temp: 16, sensor: 16 }],
    tempHistory: [{ t: 0, v: 16 }]
  };
  const tempChart = new MiniChart($('#tempChart'));

  function tempAtTime(time) {
    const list = thermo.tempHistory;
    if (!list.length) return thermo.temp;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].t <= time) return list[i].v;
    }
    return list[0].v;
  }

  function tempPercent(value) {
    return clamp((value / 40) * 100, 1, 99);
  }

  function renderThermo() {
    if (!$('#thermoLab')) return;
    const temp = thermo.temp;
    const sensor = thermo.sensor;
    $('#tempNow').textContent = temp.toFixed(1);
    $('#sensorNow').textContent = `${sensor.toFixed(1)}°`;
    $('#heaterState').textContent = !thermo.feedback ? '全功率' : thermo.heater ? '开启' : '关闭';
    $('#heaterPower').textContent = !thermo.feedback ? '反馈已断开' : thermo.heater ? '正在补热' : '等待温差';
    $('#thermoMercury').style.setProperty('--temp', `${tempPercent(temp)}%`);
    $('#thermoTargetMark').style.setProperty('--target', `${tempPercent(thermo.target)}%`);
    $('#thermoTargetMark span').textContent = `目标 ${thermo.target.toFixed(1)}°`;
    const cooling = temp > thermo.target + .1 && !thermo.heater;
    const status = $('#thermoStatus');
    if (!thermo.feedback) {
      status.className = 'thermo-status is-off';
      status.innerHTML = '<span class="status-dot"></span> 反馈断开 · 持续加热';
    } else if (thermo.heater) {
      status.className = 'thermo-status';
      status.innerHTML = '<span class="status-dot"></span> 加热中';
    } else if (cooling) {
      status.className = 'thermo-status is-cooling';
      status.innerHTML = '<span class="status-dot"></span> 降温中';
    } else {
      status.className = 'thermo-status is-off';
      status.innerHTML = '<span class="status-dot"></span> 接近目标';
    }
    const insight = $('#thermoInsight');
    if (!thermo.feedback) insight.textContent = '反馈断开：没有信息回到加热器，系统只会一直加热。';
    else if (Math.abs(temp - thermo.target) < .35) insight.textContent = '温差缩小，系统接近目标。延迟仍在影响下一次判断。';
    else if (thermo.delay >= 4) insight.textContent = '延迟很大：加热器的决策基于过时信息，容易冲过头。';
    else if (thermo.heater) insight.textContent = '传感器报告偏冷，加热器启动，反馈回路正在缩小温差。';
    else insight.textContent = '室温已越过目标，加热器关闭；存量的惯性让温度继续变化。';
    $('#thermoClock').textContent = `t = ${thermo.t.toFixed(1)}s`;
    $('#loopDelayLabel').textContent = `${thermo.delay.toFixed(1)}s`;
    $('#targetOut').textContent = `${thermo.target.toFixed(1)}°C`;
    $('#delayOut').textContent = `${thermo.delay.toFixed(1)} s`;
    drawTempChart();
  }

  function drawTempChart() {
    if (!tempChart) return;
    const xMax = Math.max(45, thermo.t);
    const xMin = Math.max(0, xMax - 45);
    const values = thermo.history.filter((p) => p.x >= xMin - .5);
    tempChart.draw({
      xMin, xMax, yMin: 8, yMax: 36,
      series: [
        { values: values.map((p) => ({ x: p.x, y: p.temp })), color: cssVar('--accent'), width: 1.8, dot: true, fill: true, fillAlpha: .055 },
        { values: values.map((p) => ({ x: p.x, y: p.sensor })), color: cssVar('--gold'), width: 1.05, dash: [3, 4] }
      ],
      target: { y: thermo.target, color: cssVar('--coral') },
      yFormat: (v) => `${Math.round(v)}°`,
      xFormat: (v) => `${Math.round(v)}s`,
      yLabel: '温度 / °C'
    });
  }

  function stepThermo(dt) {
    thermo.t += dt;
    thermo.sensor = tempAtTime(thermo.t - thermo.delay);
    thermo.heater = thermo.feedback ? thermo.sensor < thermo.target - .15 : true;
    const gain = thermo.heater ? 1.7 : 0;
    const loss = .062 * (thermo.temp - 6);
    thermo.temp = clamp(thermo.temp + (gain - loss) * dt, 0, 40);
    thermo.tempHistory.push({ t: thermo.t, v: thermo.temp });
    if (thermo.tempHistory.length > 2600) thermo.tempHistory.shift();
    thermo.history.push({ x: thermo.t, temp: thermo.temp, sensor: thermo.sensor });
    if (thermo.history.length > 2200) thermo.history.shift();
    renderThermo();
  }

  function initThermoLab() {
    if (!$('#thermoLab')) return;
    $('#targetTemp').addEventListener('input', (e) => {
      thermo.target = Number(e.target.value);
      renderThermo();
    });
    $('#sensorDelay').addEventListener('input', (e) => {
      thermo.delay = Number(e.target.value);
      renderThermo();
    });
    $('#feedbackToggle').addEventListener('change', (e) => {
      thermo.feedback = e.target.checked;
      audio.click();
      renderThermo();
    });
    $('#thermoReset').addEventListener('click', () => {
      thermo.temp = 16;
      thermo.sensor = 16;
      thermo.target = 22;
      thermo.delay = 1.5;
      thermo.feedback = true;
      thermo.heater = true;
      thermo.t = 0;
      thermo.history = [{ x: 0, temp: 16, sensor: 16 }];
      thermo.tempHistory = [{ t: 0, v: 16 }];
      $('#targetTemp').value = 22;
      $('#sensorDelay').value = 1.5;
      $('#feedbackToggle').checked = true;
      paintRange($('#targetTemp'));
      paintRange($('#sensorDelay'));
      renderThermo();
      audio.click();
    });
    renderThermo();
    window.setInterval(() => {
      if (activeChapter === 'ch03') stepThermo(.1);
    }, 100);
  }

  /* ---------------------------------------------------------- compound loop */
  const compoundChart = new MiniChart($('#compoundChart'));
  function renderCompound() {
    if (!$('#compoundLab')) return;
    const principal = Number($('#principal').value);
    const rate = Number($('#growthRate').value) / 100;
    const years = Number($('#years').value);
    const showLinear = $('#showLinear').checked;
    const future = principal * Math.pow(1 + rate, years);
    const gain = ((future - principal) / principal) * 100;
    const doubling = 70 / (rate * 100);
    $('#compoundFuture').textContent = future >= 10000 ? formatCompact(future) : formatNumber(future, 0);
    $('#compoundDouble').textContent = doubling.toFixed(1);
    $('#compoundGain').textContent = `+${formatNumber(gain, 0)}%`;
    $('#principalOut').textContent = `${principal} 元`;
    $('#rateOut').textContent = `${(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}%`;
    $('#yearsOut').textContent = `${years} 年`;
    const series = [];
    const compVals = [];
    const linVals = [];
    for (let i = 0; i <= years; i++) {
      compVals.push({ x: i, y: principal * Math.pow(1 + rate, i) });
      linVals.push({ x: i, y: principal + principal * rate * i });
    }
    series.push({ values: compVals, color: cssVar('--accent'), width: 2, fill: true, fillAlpha: .06, dot: true });
    if (showLinear) series.push({ values: linVals, color: cssVar('--gold'), width: 1.1, dash: [4, 4] });
    compoundChart.draw({
      xMin: 0, xMax: years, yMin: 0,
      series,
      yFormat: (v) => formatCompact(v),
      xFormat: (v) => `${Math.round(v)}年`,
      yLabel: '余额 / 元'
    });
  }
  function initCompoundLab() {
    if (!$('#compoundLab')) return;
    ['#principal', '#growthRate', '#years', '#showLinear'].forEach((sel) => {
      $(sel).addEventListener('input', renderCompound);
      $(sel).addEventListener('change', renderCompound);
    });
    renderCompound();
  }

  /* ================================================================== CH04 */
  const zooData = {
    exp: {
      index: '01 / 04', title: '指数增长', tab: '指数增长',
      chartTitle: '指数增长', chartLabel: 'STOCK OVER TIME',
      tag: 'R 增强回路主导',
      desc: '没有明显上限时，存量按当前比例扩张。增长越快，曲线上扬越陡。',
      facts: [['回路', '增长 → 更多增长'], ['典型现场', '病毒传播、复利、技术债'], ['工程翻译', '未加限制的告警噪声']],
      insight: '指数增长最容易被低估：早期看起来平缓，后期变化快得来不及反应。',
      param: { min: 2, max: 18, step: 1, value: 8, label: '增长率', suffix: '%' },
      axis: '横轴：时间 / 年', xMax: 30, yMax: null
    },
    s: {
      index: '02 / 04', title: 'S 曲线', tab: 'S 曲线',
      chartTitle: 'S 曲线', chartLabel: 'STOCK OVER TIME',
      tag: 'R → B 主导切换',
      desc: '增强回路先把系统推起来，接近承载上限时，调节回路接管，增长逐渐放缓。',
      facts: [['回路', '先增强，后限制'], ['典型现场', '产品渗透、平台迁移、团队扩张'], ['工程翻译', '市场容量与交付能力']],
      insight: 'S 曲线不是两种系统，而是同一个系统在途中换了主导回路。',
      param: { min: 10, max: 60, step: 5, value: 30, label: '增长速率', suffix: '%' },
      axis: '横轴：时间 / 年', xMax: 40, yMax: 100
    },
    osc: {
      index: '03 / 04', title: '振荡', tab: '振荡',
      chartTitle: '振荡', chartLabel: 'STOCK OVER TIME',
      tag: 'B + τ 延迟',
      desc: '调节回路加上时间延迟。系统在目标两侧来回修正，甚至越修越晃。',
      facts: [['回路', '调节 + 延迟'], ['典型现场', '库存、恒温器、招聘与裁员'], ['工程翻译', '发布节奏与告警抖动']],
      insight: '延迟越大，系统越容易基于过时信息行动。反应快，不等于反应准。',
      param: { min: 1, max: 5, step: .5, value: 4, label: '反馈延迟', suffix: ' 期' },
      axis: '横轴：时间 / 期', xMax: 40, yMax: 110
    },
    collapse: {
      index: '04 / 04', title: '过度与崩溃', tab: '过度与崩溃',
      chartTitle: '过度与崩溃', chartLabel: 'RESOURCE & POPULATION',
      tag: '增长撞上承载力',
      desc: '增长冲过承载上限，资源被耗尽，支撑增长的回路反向运转，存量骤降。',
      facts: [['回路', 'R 增长 + B 资源约束'], ['典型现场', '渔业、地下水、信任透支'], ['工程翻译', '容量耗尽与核心人依赖']],
      insight: '崩溃往往发生在“看起来还在增长”的时候。限制已经在收紧，只是反馈还没到。',
      param: { min: .08, max: .20, step: .01, value: .12, label: '开采强度', suffix: '' },
      axis: '横轴：时间 / 期', xMax: 90, yMax: 100
    }
  };
  const zooState = { current: 'exp', params: { exp: 8, s: 30, osc: 4, collapse: .12 } };
  const zooChart = new MiniChart($('#zooChart'));

  function simulateSeries(x0, tMax, dt, deriv) {
    let x = x0;
    let t = 0;
    const points = [{ x: 0, y: x }];
    let nextSample = 0;
    while (t < tMax - 1e-9) {
      x += deriv(t, x) * dt;
      t += dt;
      if (t >= nextSample) {
        points.push({ x: t, y: x });
        nextSample += .2;
      }
    }
    points.push({ x: tMax, y: x });
    return points;
  }

  function zooSeries(key) {
    const param = zooState.params[key];
    if (key === 'exp') {
      const r = param / 100;
      const pts = [];
      for (let t = 0; t <= 30; t += .2) pts.push({ x: t, y: 5 * Math.exp(r * t) });
      return {
        series: [{ values: pts, color: cssVar('--accent'), width: 2, fill: true, fillAlpha: .07 }],
        xMax: 30, yMin: 0, yMax: null, target: null
      };
    }
    if (key === 's') {
      const r = param / 100;
      const pts = simulateSeries(2, 40, .1, (t, x) => r * x * (1 - x / 100));
      return {
        series: [
          { values: pts, color: cssVar('--accent'), width: 2, fill: true, fillAlpha: .07 },
          { values: [{ x: 0, y: 100 }, { x: 40, y: 100 }], color: cssVar('--gold'), width: 1, dash: [4, 4] }
        ],
        xMax: 40, yMin: 0, yMax: 105, target: null
      };
    }
    if (key === 'osc') {
      const delay = param;
      const gain = .28;
      const target = 60;
      let x = 15;
      let t = 0;
      const dt = .05;
      const history = [{ t: 0, x }];
      const pts = [{ x: 0, y: x }];
      let nextSample = 0;
      while (t < 40) {
        const wanted = t - delay;
        let delayed = history[0].x;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].t <= wanted) { delayed = history[i].x; break; }
        }
        x += gain * (target - delayed) * dt;
        x = clamp(x, 0, 120);
        t += dt;
        history.push({ t, x });
        if (t >= nextSample) {
          pts.push({ x: t, y: x });
          nextSample += .2;
        }
      }
      return {
        series: [{ values: pts, color: cssVar('--accent'), width: 2, fill: true, fillAlpha: .055 }],
        xMax: 40, yMin: 0, yMax: 110, target: { y: 60, color: cssVar('--gold') }
      };
    }
    const harvest = param;
    let R = 88;
    let P = 5;
    let t = 0;
    const dt = .05;
    const rPts = [{ x: 0, y: R }];
    const pPts = [{ x: 0, y: P }];
    let nextSample = 0;
    while (t < 90) {
      const dR = .08 * R * (1 - R / 100) - harvest * P;
      const dP = .15 * P * (R / 100) - .05 * P;
      R = clamp(R + dR * dt, 0, 100);
      P = Math.max(0, P + dP * dt);
      t += dt;
      if (t >= nextSample) {
        rPts.push({ x: t, y: R });
        pPts.push({ x: t, y: P });
        nextSample += .2;
      }
    }
    return {
      series: [
        { values: rPts, color: cssVar('--accent'), width: 2, fill: true, fillAlpha: .06 },
        { values: pPts, color: cssVar('--coral'), width: 2 }
      ],
      xMax: 90, yMin: 0, yMax: 100, target: null
    };
  }

  function renderZoo() {
    if (!$('#zooLab')) return;
    const key = zooState.current;
    const data = zooData[key];
    const param = zooState.params[key];
    const cfg = zooSeries(key);
    $$('#zooLab [data-zoo]').forEach((btn) => {
      const on = btn.dataset.zoo === key;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    $('#zooIndex').textContent = data.index;
    $('#zooTitle').textContent = data.title;
    $('#zooDesc').textContent = data.desc;
    $('#zooChartTitle').textContent = data.chartTitle;
    $('#zooChartLabel').textContent = data.chartLabel;
    const loopBadge = key === 'osc' ? 'B' : 'R';
    const loopText = key === 'exp' ? '增强回路主导' : key === 's' ? '增强 → 调节主导切换' : key === 'osc' ? '调节 + 时间延迟' : '增长 + 资源约束';
    $('#zooLoopTag').innerHTML = `<b>${loopBadge}</b> ${loopText}`;
    $('#zooAxisHint').textContent = data.axis;
    $('#zooFacts').innerHTML = data.facts.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
    $('#zooInsight span').textContent = data.insight;
    $('#zooParamLabel').textContent = data.param.label;
    const suffix = data.param.suffix === '%' ? '%' : data.param.suffix;
    $('#zooParamOut').textContent = key === 'collapse' ? param.toFixed(2) : `${key === 'osc' ? param.toFixed(1) : param}${suffix}`;
    const input = $('#zooParam');
    input.min = data.param.min;
    input.max = data.param.max;
    input.step = data.param.step;
    input.value = param;
    paintRange(input);
    const labels = key === 'collapse' ? ['资源存量', '种群'] : key === 'osc' ? ['存量'] : ['存量'];
    const colors = key === 'collapse' ? [cssVar('--accent'), cssVar('--coral')] : [cssVar('--accent')];
    $('#zooLegend').innerHTML = labels.map((label, i) => `<span><i class="legend-line" style="background:${colors[i]}"></i>${label}</span>`).join('');
    zooChart.draw({
      xMin: 0, xMax: cfg.xMax, yMin: cfg.yMin, yMax: cfg.yMax,
      series: cfg.series,
      target: cfg.target,
      yFormat: (v) => formatCompact(v),
      xFormat: (v) => `${Math.round(v)}`,
      yLabel: key === 'collapse' ? '指数（0–100）' : '存量',
      pad: { l: 39, r: 16, t: 16, b: 26 }
    });
  }

  function drawSpark(canvas, key) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = rect.width;
    const h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cfg = zooSeries(key);
    const series = cfg.series;
    const all = series.flatMap((s) => s.values.map((p) => p.y));
    let min = Math.min(...all, 0);
    let max = Math.max(...all, 1);
    if (max === min) max = min + 1;
    const pad = 5;
    series.forEach((s, si) => {
      const pts = s.values;
      if (!pts.length) return;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = pad + (p.x / cfg.xMax) * (w - pad * 2);
        const y = h - pad - ((p.y - min) / (max - min)) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = si === 0 ? cssVar('--accent') : cssVar('--coral');
      ctx.lineWidth = si === 0 ? 1.55 : 1.2;
      ctx.globalAlpha = si === 0 ? 1 : .7;
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }
  function drawAllSparks() {
    $$('[data-spark]').forEach((canvas) => drawSpark(canvas, canvas.dataset.spark));
  }
  function initZooLab() {
    if (!$('#zooLab')) return;
    $$('#zooLab [data-zoo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        zooState.current = btn.dataset.zoo;
        renderZoo();
        audio.click();
      });
    });
    $('#zooParam').addEventListener('input', (e) => {
      zooState.params[zooState.current] = Number(e.target.value);
      renderZoo();
    });
    renderZoo();
  }

  /* ================================================================== CH05 */
  const resilience = {
    score: 86,
    redundancy: true,
    down: new Set(),
    labels: {
      soil: '土壤', plant: '植物', pollinator: '传粉者', water: '水源',
      microbe: '微生物', seed: '种子库', people: '人类'
    }
  };

  function renderResilience() {
    if (!$('#resilienceLab')) return;
    $('#resScore').textContent = Math.max(0, Math.round(resilience.score));
    const status = $('#resStatus');
    const label = status.querySelector('.status-copy');
    $('#resilienceLab').classList.toggle('is-brittle', !resilience.redundancy);
    if (resilience.score <= 25) {
      status.className = 'resilience-status is-critical';
      label.textContent = '网络正在级联失效';
    } else if (resilience.score <= 55 || !resilience.redundancy) {
      status.className = 'resilience-status is-warning';
      label.textContent = '系统仍能运转，但缓冲很薄';
    } else {
      status.className = 'resilience-status';
      label.textContent = '网络健康，存在备用路径';
    }
    $$('#resSvg .res-node').forEach((node) => {
      node.classList.toggle('is-down', resilience.down.has(node.dataset.node));
    });
  }

  function resilienceLog(message) {
    const log = $('#resLog');
    if (!log) return;
    log.innerHTML = `<span class="mono">EVENT LOG</span><p>${message}</p>`;
  }

  function initResilience() {
    if (!$('#resilienceLab')) return;
    const toggle = $('#resRedundancy');
    const shockBtn = $('#resShock');
    const resetBtn = $('#resReset');
    const applyRedundancy = () => {
      resilience.redundancy = toggle.checked;
      if (!resilience.redundancy) {
        resilience.score = Math.min(resilience.score, 52);
        resilienceLog('<b>效率优化：</b>移除了 5 条备用路径。系统更精简了，但冲击不再有替代通路。');
      } else {
        resilience.score = Math.min(86, resilience.score + 15);
        resilienceLog('<b>恢复冗余：</b>备用路径回来了。系统的峰值效率下降，但抗冲击能力恢复。');
      }
      renderResilience();
      audio.click();
    };
    toggle.addEventListener('change', applyRedundancy);
    shockBtn.addEventListener('click', () => {
      const groups = $$('#resSvg .res-node').filter((g) => !resilience.down.has(g.dataset.node));
      if (!groups.length) {
        resilienceLog('<b>没有可用的节点。</b>点击“恢复网络”重新开始。');
        return;
      }
      const chosen = groups[Math.floor(Math.random() * groups.length)];
      const key = chosen.dataset.node;
      chosen.classList.add('is-hit');
      audio.note(190, .15, { type: 'triangle', gain: .018, slide: -40 });
      setTimeout(() => {
        chosen.classList.remove('is-hit');
        if (resilience.redundancy && resilience.score > 28) {
          resilience.score = Math.max(32, resilience.score - 6 - Math.random() * 3);
          chosen.classList.add('is-recovering');
          setTimeout(() => chosen.classList.remove('is-recovering'), 900);
          resilienceLog(`<b>扰动：${resilience.labels[key]}受损。</b>备用路径接住了功能，系统正在恢复。适应力是你为意外支付的保险。`);
        } else {
          resilience.score = Math.max(0, resilience.score - 21 - Math.random() * 4);
          resilience.down.add(key);
          resilienceLog(`<b>扰动：${resilience.labels[key]}失效。</b>没有备用路径，影响开始级联。效率优化省下的成本，正在以脆弱性的形式回来。`);
          if (resilience.score <= 25) {
            audio.error();
            toast('系统进入级联失效 · 试试恢复冗余连接');
          }
        }
        renderResilience();
      }, 680);
    });
    resetBtn.addEventListener('click', () => {
      resilience.score = resilience.redundancy ? 86 : 52;
      resilience.down.clear();
      $$('#resSvg .res-node').forEach((g) => g.classList.remove('is-down', 'is-hit', 'is-recovering'));
      resilienceLog('网络已恢复。等待下一次扰动。试试连续点击，观察系统如何接住冲击。');
      renderResilience();
      audio.click();
    });
    renderResilience();
  }

  const life = {
    canvas: null, ctx: null, cols: 0, rows: 0, cell: 8,
    grid: null, next: null, running: true, timer: 0, w: 0, h: 0
  };
  function randomLife(reset = true) {
    const total = life.cols * life.rows;
    if (reset || !life.grid || life.grid.length !== total) {
      life.grid = new Uint8Array(total);
      for (let i = 0; i < total; i++) life.grid[i] = Math.random() < .18 ? 1 : 0;
      life.next = new Uint8Array(total);
    }
  }
  function resizeLife() {
    if (!life.canvas) return;
    const rect = life.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = rect.width;
    const h = rect.height;
    if (Math.abs(w - life.w) < 2 && Math.abs(h - life.h) < 2 && life.grid) return;
    life.w = w;
    life.h = h;
    life.canvas.width = Math.round(w * dpr);
    life.canvas.height = Math.round(h * dpr);
    life.ctx = life.canvas.getContext('2d');
    life.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = w < 440 ? 7 : 9;
    life.cell = cell;
    life.cols = Math.floor(w / cell);
    life.rows = Math.floor(h / cell);
    randomLife(true);
    drawLife();
  }
  function drawLife() {
    if (!life.ctx || !life.grid) return;
    const ctx = life.ctx;
    const w = life.w;
    const h = life.h;
    ctx.clearRect(0, 0, w, h);
    const accent = cssVar('--accent');
    const line = cssVar('--line');
    ctx.fillStyle = line;
    for (let c = 1; c < life.cols; c++) {
      ctx.fillRect(c * life.cell, 0, .4, h);
    }
    for (let r = 1; r < life.rows; r++) {
      ctx.fillRect(0, r * life.cell, w, .4);
    }
    for (let r = 0; r < life.rows; r++) {
      for (let c = 0; c < life.cols; c++) {
        if (!life.grid[r * life.cols + c]) continue;
        const x = c * life.cell;
        const y = r * life.cell;
        ctx.fillStyle = accent;
        ctx.globalAlpha = .82;
        ctx.fillRect(x + 1, y + 1, life.cell - 2, life.cell - 2);
      }
    }
    ctx.globalAlpha = 1;
  }
  function stepLife() {
    if (!life.grid) return;
    const cols = life.cols;
    const rows = life.rows;
    const grid = life.grid;
    const next = life.next;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const rr = (r + dr + rows) % rows;
            const cc = (c + dc + cols) % cols;
            n += grid[rr * cols + cc];
          }
        }
        const alive = grid[r * cols + c];
        next[r * cols + c] = alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    life.grid = next;
    life.next = grid;
    drawLife();
  }
  function initLife() {
    life.canvas = $('#lifeCanvas');
    if (!life.canvas) return;
    resizeLife();
    life.timer = window.setInterval(() => {
      if (activeChapter === 'ch05' && life.running) stepLife();
    }, 150);
    $('#lifeMutate').addEventListener('click', () => {
      if (!life.grid) return;
      for (let i = 0; i < 28; i++) {
        const idx = Math.floor(Math.random() * life.grid.length);
        life.grid[idx] = life.grid[idx] ? 0 : 1;
      }
      drawLife();
      audio.open();
      toast('变异已注入 · 观察结构如何重组');
    });
    $('#lifePause').addEventListener('click', () => {
      life.running = !life.running;
      const btn = $('#lifePause');
      btn.querySelector('use').setAttribute('href', life.running ? '#i-pause' : '#i-play');
      btn.querySelector('span').textContent = life.running ? '暂停' : '继续';
      audio.click();
    });
    $('#lifeReset').addEventListener('click', () => {
      randomLife(true);
      drawLife();
      audio.click();
    });
    life.canvas.addEventListener('click', (e) => {
      const rect = life.canvas.getBoundingClientRect();
      const c = Math.floor((e.clientX - rect.left) / (rect.width / life.cols));
      const r = Math.floor((e.clientY - rect.top) / (rect.height / life.rows));
      if (c >= 0 && c < life.cols && r >= 0 && r < life.rows) {
        const idx = r * life.cols + c;
        life.grid[idx] = life.grid[idx] ? 0 : 1;
        drawLife();
      }
    });
  }

  const hierarchyData = [
    {
      index: 'L0 · 目的层', title: '产品系统',
      p: '整体层面的目标和边界。它决定什么算“有价值”，也决定其他层级为什么存在。',
      good: '各层目标一致，信息向上流动，局部优化不会伤害整体。',
      bad: '次优化：子系统赢了，整体输了；或者中央控制过强，局部失去适应力。'
    },
    {
      index: 'L1 · 协作层', title: '团队',
      p: '负责把目标翻译成持续交付。团队需要边界、自主权和清晰的接口，而不是每件事都向上请示。',
      good: '团队知道“为什么做”，也能对“怎么做”负责；跨团队反馈能及时到达。',
      bad: '目标被拆成互不相干的 KPI，团队开始优化自己的数字，而不是用户结果。'
    },
    {
      index: 'L2 · 契约层', title: '服务',
      p: '一个可独立部署、承担明确职责的系统单元。它用接口与外部世界签订契约。',
      good: '职责清晰、失败可隔离、可观测；依赖关系与延迟被看见。',
      bad: '共享数据库、隐式耦合、没有负责人，局部故障扩散成全局故障。'
    },
    {
      index: 'L3 · 实现层', title: '模块 / 函数',
      p: '最小粒度的实现单元。它应该只关心正确完成一件事，并隐藏内部复杂度。',
      good: '命名清晰、测试充分、改动局部化；向上提供稳定抽象。',
      bad: '过度抽象、循环依赖、把业务规则撒得到处都是。'
    }
  ];
  function initHierarchy() {
    if (!$('#hierStack')) return;
    $$('#hierStack [data-hier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.hier);
        const data = hierarchyData[index];
        $$('#hierStack [data-hier]').forEach((b) => b.classList.toggle('is-active', b === btn));
        $('#hierDetail').innerHTML = `<span class="hier-detail-index">${data.index}</span><h3>${data.title}</h3><p>${data.p}</p><div class="hier-rule"><b>健康信号</b><span>${data.good}</span></div><div class="hier-rule"><b>常见病</b><span>${data.bad}</span></div>`;
        audio.click();
      });
    });
  }

  /* ================================================================== CH06 */
  const icebergData = {
    event: {
      index: '01 / 04 · 事件', title: '事件层：看见浪花',
      desc: '线上又发生了一次故障。事件层最显眼，也最容易引发情绪和追责。',
      example: '“为什么又挂了？”——这句话通常只能得到一个人名，得不到一个结构。'
    },
    pattern: {
      index: '02 / 04 · 模式', title: '模式层：看见节律',
      desc: '故障总在发布后第二天出现；每次大促前，值班压力都会飙升。把时间轴拉长，重复的形状出现了。',
      example: '“过去三个月，每次大版本后都有一波故障。”——开始从事件走向趋势。'
    },
    structure: {
      index: '03 / 04 · 结构', title: '结构层：看见回路',
      desc: '发布压力让评审被跳过，缺陷进入生产，故障又制造更多发布压力。存量、流量和反馈回路解释了这个模式。',
      example: '“发布压力 → 跳过评审 → 缺陷 → 故障 → 更多压力。”——因果链闭合了。'
    },
    mental: {
      index: '04 / 04 · 心智模型', title: '心智模型层：看见假设',
      desc: '“快就是竞争力”“停下来修质量会输”。这些默认假设，决定了我们如何设计结构，也决定了什么被视为“合理”。',
      example: '“我们相信交付速度比稳定性更重要。”——这是更深一层的设计前提。'
    }
  };
  function initIceberg() {
    if (!$('#icebergLab')) return;
    $$('#icebergLab [data-ice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const data = icebergData[btn.dataset.ice];
        $$('#icebergLab [data-ice]').forEach((b) => b.classList.toggle('is-active', b === btn));
        $('#iceIndex').textContent = data.index;
        $('#iceTitle').textContent = data.title;
        $('#iceDesc').textContent = data.desc;
        $('#iceExample').innerHTML = `<b>工程师视角</b><span>${data.example}</span>`;
        audio.click();
      });
    });
    $('[data-ice="event"]').classList.add('is-active');
  }

  const nlChart = new MiniChart($('#nonlinearChart'));
  function nonlinearY(x) {
    return 100 / (1 + Math.exp(-(x - 55) / 9));
  }
  function drawNonlinear() {
    if (!$('#nonlinearChart')) return;
    const x = Number($('#nonlinearRange').value);
    const y = nonlinearY(x);
    $('#nlInput').textContent = x;
    $('#nlOutput').textContent = Math.round(y);
    const series = [];
    const pts = [];
    for (let i = 0; i <= 100; i += 2) pts.push({ x: i, y: nonlinearY(i) });
    series.push({ values: pts, color: cssVar('--accent'), width: 2, fill: true, fillAlpha: .06 });
    if ($('#nonlinearLinear').checked) {
      series.push({ values: [{ x: 0, y: 0 }, { x: 100, y: 100 }], color: cssVar('--gold'), width: 1, dash: [4, 4] });
    }
    nlChart.draw({
      xMin: 0, xMax: 100, yMin: 0, yMax: 100,
      series,
      markers: [{ x, y, color: cssVar('--coral') }],
      xFormat: (v) => `${Math.round(v)}`,
      yFormat: (v) => `${Math.round(v)}`,
      yLabel: '结果', pad: { l: 34, r: 12, t: 12, b: 22 }
    });
  }
  function initNonlinear() {
    if (!$('#nonlinearLab')) return;
    $('#nonlinearRange').addEventListener('input', drawNonlinear);
    $('#nonlinearLinear').addEventListener('change', drawNonlinear);
    drawNonlinear();
  }

  function initDelayCalc() {
    if (!$('#delayEstimate')) return;
    const update = () => {
      const days = Number($('#delayEstimate').value);
      $('#delayEstimateOut').textContent = `${days} 天`;
      $('#delayOne').textContent = `${days} 天`;
      $('#delayThree').textContent = `${days * 3} 天`;
      const one = 22 + (days / 30) * 26;
      const three = 50 + (days / 30) * 48;
      $('#delayOne').parentElement.style.setProperty('--one', `${one}%`);
      $('#delayThree').parentElement.style.setProperty('--three', `${three}%`);
    };
    $('#delayEstimate').addEventListener('input', update);
    update();
  }

  const boundedData = {
    local: {
      kicker: 'LOCAL RATIONALITY',
      title: '“从我的位置看，这是最合理的选择。”',
      p1: '我只知道自己的订单延迟了。催单能让我获得更多关注，所以我催。每个客户都掌握有限的信息，也都做了理性选择。',
      p2: '有限理性不是愚蠢。它是个体在局部信息下做出的合理反应，累加起来却产生集体不想看到的结果。'
    },
    global: {
      kicker: 'WHOLE SYSTEM',
      title: '“每个人都在催，于是所有人更慢。”',
      p1: '当所有人的催单同时涌入，供应商产能被挤满，处理时间上升；更慢又制造更多催单，形成增强回路。',
      p2: '解法通常不在“让大家更聪明”，而在重构信息流、目标或激励，让局部理性与整体利益对齐。'
    }
  };
  function initBounded() {
    if (!$('#boundedLab')) return;
    const stage = $('#brStage');
    const copy = $('#boundedCopy');
    const update = (view) => {
      const data = boundedData[view];
      stage.classList.toggle('is-global', view === 'global');
      copy.innerHTML = `<span class="kicker">${data.kicker}</span><h3>${data.title}</h3><p>${data.p1}</p><p class="aside-note">${data.p2}</p>`;
      $$('#boundedToggle [data-bounded]').forEach((b) => {
        const on = b.dataset.bounded === view;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      audio.click();
    };
    $$('#boundedToggle [data-bounded]').forEach((b) => b.addEventListener('click', () => update(b.dataset.bounded)));
  }

  /* ================================================================== CH07 */
  const trapIcon = {
    policy: '<svg viewBox="0 0 32 32"><path d="M6 16h8M18 16h8M8 10l-4 6 4 6M24 10l4 6-4 6"/><circle cx="16" cy="16" r="2"/></svg>',
    commons: '<svg viewBox="0 0 32 32"><circle cx="16" cy="9" r="3"/><circle cx="7" cy="22" r="3"/><circle cx="25" cy="22" r="3"/><path d="M16 12v5M10 20l4-3M22 20l-4-3"/><path d="M16 17a5 5 0 0 0-5 5M16 17a5 5 0 0 1 5 5"/></svg>',
    drift: '<svg viewBox="0 0 32 32"><path d="M5 9h12M7 15h12M9 21h12M12 27h11"/><path d="m25 7-3 5M25 7l3 5"/></svg>',
    escalation: '<svg viewBox="0 0 32 32"><path d="M7 25 15 9l4 8 3-5 4 13"/><path d="M5 25h22"/><path d="m12 10 3-1 1 3M23 12l3 1-2 3"/></svg>',
    success: '<svg viewBox="0 0 32 32"><path d="M7 27V17M13 27V13M19 27V9M25 27V5"/><path d="m5 9 7-4 5 3 8-5"/></svg>',
    shifting: '<svg viewBox="0 0 32 32"><path d="M16 4v7M8 11h16l2 8H6l2-8Z"/><path d="M10 19v6M22 19v6M6 25h6M20 25h6"/><path d="M16 11v8"/></svg>',
    rule: '<svg viewBox="0 0 32 32"><path d="M6 26V6h20v20H6Z"/><path d="M10 21h5v-5h4v-4h4"/><path d="M24 20v4h-4"/></svg>',
    goal: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="5"/><path d="m16 16 10-9M22 7h4v4"/></svg>'
  };

  const traps = [
    {
      id: 'policy', name: '政策阻力', en: 'POLICY RESISTANCE', icon: trapIcon.policy,
      line: '所有人都在用力，系统却纹丝不动。',
      symptoms: '每推出一项政策，相关方就发展出抵消它的对策；投入越来越大，存量还是停在原地。',
      structure: '多个行动者把同一个存量拉向各自的目标。每一方的努力都会触发另一方的补偿，形成相互抵消的回路。',
      loop: ['A 方拉向目标', '存量偏离', 'B 方加倍拉回', '存量回到原地'],
      software: '产品要快、安全要稳、财务要省、运维要少中断。每个部门都在做正确的事，发布窗口却越来越难排。',
      escape: '不要加大力度，先找共同的高层目标，让所有行动者参与规则设计。改变信息与激励，而不是继续拔河。',
      color: 'var(--accent)', soft: 'var(--accent-soft)'
    },
    {
      id: 'commons', name: '公地悲剧', en: 'TRAGEDY OF THE COMMONS', icon: trapIcon.commons,
      line: '短期归自己，长期归大家。',
      symptoms: '共享资源被过度使用；每个使用者都觉得自己只多拿了一点，直到资源枯竭。',
      structure: '使用收益归个体，过度使用的成本由所有人分摊。资源状态与个体使用行为之间的反馈非常弱。',
      loop: ['个人多使用', '个人收益增加', '资源存量下降', '成本由所有人分摊'],
      software: '共享测试环境、发布窗口、值班注意力、云预算。每个团队都多占一点，最后所有人都变慢。',
      escape: '恢复反馈：监控、配额、价格、准入；或者把资源切分、私有化，让使用者直接承担后果。',
      color: 'var(--gold)', soft: 'var(--gold-soft)'
    },
    {
      id: 'drift', name: '目标侵蚀', en: 'DRIFT TO LOW PERFORMANCE', icon: trapIcon.drift,
      line: '标准不是突然崩塌的，是一次次“这次先这样”。',
      symptoms: '绩效持续下滑，但每一次下滑都被新的“现实标准”合理化；大家逐渐适应更差的结果。',
      structure: '目标依据过去的绩效调整。绩效差导致目标下降，目标下降又让差绩效显得可以接受，形成向下的增强回路。',
      loop: ['绩效下滑', '目标被下调', '差距看起来缩小', '下一次更容易接受更低标准'],
      software: 'SLA 一点点下调；技术债阈值一点点放宽；“这次先上线，下次再补测试”变成默认流程。',
      escape: '锚定绝对标准或历史最佳表现，引入外部基准。不要让目标跟着绩效一起漂移。',
      color: 'var(--blue)', soft: 'var(--blue-soft)'
    },
    {
      id: 'escalation', name: '竞争升级', en: 'ESCALATION', icon: trapIcon.escalation,
      line: '你加码，我就加得更多。',
      symptoms: '双方不断升级行动，成本持续上升，相对位置却没有改变；停下来的一方似乎立刻吃亏。',
      structure: '每一方根据对方的行动决定自己的下一步，构成增强回路。行动—反应—更大行动，螺旋上升。',
      loop: ['A 加码', 'B 感到威胁', 'B 加更多码', 'A 再加码'],
      software: '两个团队争夺同一发布窗口，各自加急；招聘薪资竞赛；告警阈值和监控规则不断加码。',
      escape: '单方面降级、协商规则、设置上限，或改变比较维度。最有效的是避免进入这个结构。',
      color: 'var(--coral)', soft: 'var(--coral-soft)'
    },
    {
      id: 'success', name: '富者愈富', en: 'SUCCESS TO THE SUCCESSFUL', icon: trapIcon.success,
      line: '赢家拿到下一轮的入场券。',
      symptoms: '赢家获得更多资源、注意力和机会，下一轮更容易获胜；弱者逐渐失去参与资格。',
      structure: '成功 → 更多资源 → 更大成功，形成增强回路。竞争本身会逐渐消灭竞争。',
      loop: ['项目成功', '获得更多资源', '下一轮更易成功', '其他项目更难竞争'],
      software: '明星项目吸走最好的工程师和数据；平台团队只服务大客户；核心服务获得全部预算。',
      escape: '反垄断、资源再分配、轮换机制、为新芽保留独立赛道。不要只用同一把尺子比较所有项目。',
      color: 'var(--gold)', soft: 'var(--gold-soft)'
    },
    {
      id: 'shifting', name: '转嫁负担', en: 'SHIFTING THE BURDEN', icon: trapIcon.shifting,
      line: '症状被按住了，能力却萎缩了。',
      symptoms: '外部干预能快速缓解症状，大家越来越依赖它；根本问题没人处理，系统自身能力持续下降。',
      structure: '症状 → 外部干预缓解；同时，根本能力被侵蚀，导致未来更需要干预。症状解与根本解在争夺同一份注意力。',
      loop: ['问题出现', '外部干预缓解症状', '根本能力萎缩', '更依赖外部干预'],
      software: '救火英雄越强，监控和根因修复越弱；核心系统外包；容量不够就无脑扩容；告警太多就整体屏蔽。',
      escape: '区分症状解与根本解；恢复系统自身能力；为外部干预设置退出条件，防止依赖。',
      color: 'var(--coral)', soft: 'var(--coral-soft)'
    },
    {
      id: 'rule', name: '规避规则', en: 'RULE BEATING', icon: trapIcon.rule,
      line: '字面上遵守，实质上绕开。',
      symptoms: '规则越来越细，规避方式越来越巧；合规指标好看，真实目标却没有改善。',
      structure: '规则与真实目的脱节，参与者会寻找成本最低的合规路径。规则越僵化，规避越有创造力。',
      loop: ['规则收紧', '参与者寻找漏洞', '表面合规', '真实问题继续', '规则再收紧'],
      software: '为覆盖率写无意义测试；安全扫描前临时豁免；故事点注水；变更审批变成盖章。',
      escape: '让规则目的透明，让被监管者参与设计；用结果与反馈修正规则，而不是继续增加检查。',
      color: 'var(--blue)', soft: 'var(--blue-soft)'
    },
    {
      id: 'goal', name: '目标错位', en: 'SEEKING THE WRONG GOAL', icon: trapIcon.goal,
      line: '系统高效地产出了你并不想要的东西。',
      symptoms: '指标持续改善，真实体验却变差；团队很忙，价值没有增加。',
      structure: '反馈回路忠实地追求一个代理指标，而不是系统的真实目标。测量越精确，偏离可能越严重。',
      loop: ['设定代理指标', '系统优化指标', '指标变好', '真实目标被忽略'],
      software: '用代码行数衡量生产力，用故事点衡量价值，用点击率衡量用户幸福。',
      escape: '重新定义目标与指标，直接测量真正关心的福利；小心把“努力”当成“结果”。',
      color: 'var(--accent)', soft: 'var(--accent-soft)'
    }
  ];

  const trapCases = [
    {
      tag: 'TECH TEAM · 线上故障',
      title: '每次故障都靠同一个英雄救火',
      text: '团队里最资深的工程师总能在深夜修复故障。大家越来越依赖他，监控、演练和根因修复却一直排不上优先级。',
      answer: 'shifting',
      options: ['shifting', 'escalation', 'commons', 'goal'],
      explain: '救火是症状解。它快速缓解了疼痛，却让团队更依赖英雄，系统性修复能力持续萎缩，最终更离不开救火。'
    },
    {
      tag: 'DELIVERY · 发布窗口',
      title: '两个团队都在加急，发布反而更慢',
      text: 'A 团队发现 B 团队抢占了发布窗口，于是提前锁资源；B 团队看到后也提前更多，双方不断加码，整体交付越来越慢。',
      answer: 'escalation',
      options: ['policy', 'escalation', 'drift', 'rule'],
      explain: '每一方都在对另一方的行动做出反应，形成升级螺旋。继续加码只会推高成本，需要协商规则或改变竞争维度。'
    },
    {
      tag: 'QUALITY · 标准',
      title: '连续延期后，“大概准时”变成了新标准',
      text: '前几个迭代都延期，团队把“可接受的延期范围”从 1 天放宽到 1 周。现在延期一周已经不算问题。',
      answer: 'drift',
      options: ['drift', 'commons', 'shifting', 'goal'],
      explain: '绩效标准被过去的绩效拖低，形成向下的增强回路。需要锚定绝对标准或历史最佳，而不是跟着现实一起下沉。'
    },
    {
      tag: 'PLATFORM · 共享资源',
      title: '共享测试环境越来越不稳定',
      text: '所有团队共用一套预发环境。每个团队都觉得自己只多跑了一点测试，环境却越来越慢，最后所有人都无法验证。',
      answer: 'commons',
      options: ['commons', 'success', 'policy', 'rule'],
      explain: '使用收益归团队，拥堵成本由所有人分摊，资源状态与个体使用行为之间的反馈很弱。需要配额、隔离或治理规则。'
    },
    {
      tag: 'ORG · 资源分配',
      title: '明星项目拿走了所有工程师',
      text: '最成功的项目获得了更多预算和最好的工程师，于是下一轮更容易成功；新项目始终招不到人，逐渐消失。',
      answer: 'success',
      options: ['success', 'escalation', 'drift', 'shifting'],
      explain: '成功带来资源，资源带来更大成功。需要反垄断式的资源规则，或为早期探索保留独立赛道。'
    },
    {
      tag: 'SECURITY · 合规',
      title: '安全流程被“合规地”绕开了',
      text: '团队为了赶进度，把高风险服务拆成几个小变更，每次都不触发安全评审。扫描通过率很好，真实风险却没有下降。',
      answer: 'rule',
      options: ['rule', 'goal', 'commons', 'policy'],
      explain: '参与者找到了成本最低的合规路径，表面遵守、实质绕开。继续加检查只会催生更巧的规避。'
    },
    {
      tag: 'METRICS · 生产力',
      title: '代码行数上升了，交付价值下降了',
      text: '公司用代码行数衡量工程师产出。代码量明显增长，评审时间变长，重复实现和无效抽象也越来越多。',
      answer: 'goal',
      options: ['goal', 'drift', 'success', 'escalation'],
      explain: '系统忠实优化了代理指标，却偏离了真实目标。要重新定义指标，直接衡量用户价值或可交付结果。'
    },
    {
      tag: 'PRODUCT · 目标冲突',
      title: '产品要快，风控要零风险，项目停住了',
      text: '产品团队要求两周上线，风控团队要求完成三轮评估。双方都不肯让步，每个需求都在评审会上被拉回原点。',
      answer: 'policy',
      options: ['policy', 'escalation', 'rule', 'shifting'],
      explain: '两个子系统把项目拉向相反目标，彼此抵消。需要更高层的共同目标与联合决策机制，而不是继续拔河。'
    }
  ];

  const trapGame = { index: 0, score: 0, answered: false, done: false };

  function renderTrapGame() {
    if (!$('#trapLab')) return;
    const c = trapCases[trapGame.index];
    $('#trapCaseNo').textContent = `CASE ${String(trapGame.index + 1).padStart(2, '0')} / ${String(trapCases.length).padStart(2, '0')}`;
    $('#trapScore').textContent = trapGame.score;
    $('#trapProgressBar').style.width = `${((trapGame.index + (trapGame.answered ? 1 : 0)) / trapCases.length) * 100}%`;
    $('#trapCaseTag').textContent = c.tag;
    $('#trapCaseTitle').textContent = c.title;
    $('#trapCaseText').textContent = c.text;
    $('#trapResult').hidden = true;
    $('#trapNext').hidden = true;
    $('#trapHint').textContent = '选择一个最符合的结构。';
    const options = $('#trapOptions');
    const shuffled = [...c.options];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    options.innerHTML = shuffled.map((id, i) => {
      const trap = traps.find((t) => t.id === id);
      return `<button class="trap-option" data-option="${id}" type="button"><span>${String.fromCharCode(65 + i)}</span>${trap.name}</button>`;
    }).join('');
    $$('#trapOptions .trap-option').forEach((btn) => {
      btn.addEventListener('click', () => answerTrap(btn.dataset.option));
    });
  }

  function answerTrap(option) {
    if (trapGame.answered) return;
    const c = trapCases[trapGame.index];
    trapGame.answered = true;
    const correct = option === c.answer;
    if (correct) trapGame.score++;
    $('#trapScore').textContent = trapGame.score;
    $$('#trapOptions .trap-option').forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.option === c.answer) btn.classList.add('is-correct');
      if (btn.dataset.option === option && !correct) btn.classList.add('is-wrong');
    });
    const result = $('#trapResult');
    result.hidden = false;
    $('#trapResultMark').textContent = correct ? '✓' : '×';
    $('#trapResultTitle').textContent = correct ? '诊断正确' : `这个病例更像：${traps.find((t) => t.id === c.answer).name}`;
    $('#trapResultText').textContent = c.explain;
    $('#trapHint').textContent = trapGame.index === trapCases.length - 1 ? '你已完成全部病例。' : '读完解释，继续下一个病例。';
    $('#trapNext').hidden = false;
    $('#trapNext').innerHTML = trapGame.index === trapCases.length - 1
      ? '查看诊断结果 <svg class="icon"><use href="#i-arrow"></use></svg>'
      : '下一个病例 <svg class="icon"><use href="#i-arrow"></use></svg>';
    $('#trapProgressBar').style.width = `${((trapGame.index + 1) / trapCases.length) * 100}%`;
    if (correct) audio.success(); else audio.error();
  }

  const trapGridRendered = { value: false };
  function renderTrapCards() {
    if (!$('#trapGrid') || trapGridRendered.value) return;
    trapGridRendered.value = true;
    $('#trapGrid').innerHTML = traps.map((t) => `
      <button class="trap-card" data-trap="${t.id}" style="--trap-color:${t.color};--trap-soft:${t.soft}" type="button">
        <span class="trap-icon">${t.icon}</span>
        <h3>${t.name}</h3>
        <p>${t.line}</p>
        <span class="trap-card-en">${t.en}</span>
        <span class="trap-card-arrow"><svg class="icon"><use href="#i-chevron"></use></svg></span>
      </button>
    `).join('');
    $$('#trapGrid [data-trap]').forEach((btn) => {
      btn.addEventListener('click', () => openTrap(btn.dataset.trap));
    });
  }

  function openTrap(id) {
    const t = traps.find((x) => x.id === id);
    if (!t) return;
    $('#trapModalTitle').textContent = t.name;
    $('#trapModalEn').textContent = t.en;
    const icon = $('#trapModalIcon');
    icon.innerHTML = t.icon;
    icon.style.background = t.soft;
    icon.style.color = t.color;
    $('#trapModalBody').innerHTML = `
      <p class="trap-modal-line">${t.line}</p>
      <div class="trap-modal-section"><h3>症状</h3><p>${t.symptoms}</p></div>
      <div class="trap-modal-section"><h3>结构</h3><p>${t.structure}</p></div>
      <div class="trap-modal-loop">${t.loop.map((s, i) => `${i ? '<i>→</i>' : ''}<span>${s}</span>`).join('')}</div>
      <div class="trap-modal-section"><h3>软件工程现场</h3><p>${t.software}</p></div>
      <div class="trap-modal-section trap-escape"><h3>破局线索</h3><p>${t.escape}</p></div>
    `;
    openModal($('#trapModal'), $('#trapModal [data-close-modal]'));
  }

  function initTrapGame() {
    if (!$('#trapLab')) return;
    renderTrapGame();
    if (!trapGame.bound) {
      trapGame.bound = true;
      bindTrapNext();
    }
  }

  /* ================================================================== CH08 */
  const leveragePoints = [
    {
      num: 12, name: '数字', en: 'NUMBERS', tier: '参数层', strength: 8,
      desc: '调整税率、补贴、工资、利率、KPI 阈值。它们是系统中最显眼、也最容易改的部分，但通常只能改变行为的量，难以改变行为的方向。',
      software: '调高告警阈值、增加预算、调整迭代长度。有用，但很少触及问题为什么反复发生。',
      warn: '只改数字，容易把结构性矛盾伪装成“参数没调好”。'
    },
    {
      num: 11, name: '缓冲器', en: 'BUFFERS', tier: '物理结构', strength: 16,
      desc: '比流量更大、更稳定的存量。库存、现金、备用容量能吸收冲击，让系统有时间反应。',
      software: '容量余量、熔断阈值、现金储备、团队空闲时间。缓冲越大越稳，但维护成本也越高。',
      warn: '缓冲过大可能掩盖问题、拖慢反馈，让人误以为系统很健康。'
    },
    {
      num: 10, name: '存量—流量结构', en: 'STOCK-AND-FLOW STRUCTURE', tier: '物理结构', strength: 24,
      desc: '管线、道路、网络拓扑、组织架构。改变实体连接方式，比调整参数更接近行为本身。',
      software: '服务拆分、消息队列、数据管道、部署拓扑。结构决定了延迟、耦合与故障传播路径。',
      warn: '重构成本高、周期长，且容易在迁移过程中制造新的脆弱点。'
    },
    {
      num: 9, name: '时间延迟', en: 'DELAYS', tier: '反馈设计', strength: 33,
      desc: '系统对变化做出反应的速度。延迟无法被消除，只能被理解、缩短或有意拉长。',
      software: '构建反馈时间、发布间隔、招聘到产出的周期、告警到修复的时间。加快反馈通常比催促更有效。',
      warn: '缩短延迟并不总是更好；有时放慢增长、给系统留出反应时间，反而更稳。'
    },
    {
      num: 8, name: '调节回路', en: 'BALANCING LOOPS', tier: '反馈设计', strength: 43,
      desc: '试图修正外界影响、把存量拉回目标的反馈力量。加强它，系统更能自我纠正。',
      software: 'SLO 与错误预算、自动回滚、测试、容量自动扩缩、代码评审。关键是反馈要足够快、足够强。',
      warn: '回路太强会导致过度反应；目标定错时，它会非常高效地稳定在错误的位置。'
    },
    {
      num: 7, name: '增强回路', en: 'REINFORCING LOOPS', tier: '反馈设计', strength: 52,
      desc: '驱动收益或损失持续放大的反馈力量。降低失控增强回路的增益，往往比加强调节回路更有效。',
      software: '病毒增长、技术债利息、告警噪声、平台网络效应。控制增益，比事后救火更根本。',
      warn: '增强回路也可能是系统最重要的增长引擎，不能一概压制。'
    },
    {
      num: 6, name: '信息流', en: 'INFORMATION FLOWS', tier: '信息与规则', strength: 62,
      desc: '谁能获得什么信息、在什么时候获得。恢复一段缺失的反馈，往往能改变整个系统的行为。',
      software: '可观测性、用户反馈、公开的构建状态、跨团队看板、让决策者直接看到后果。',
      warn: '信息透明会挑战既有权力结构，因此常遇到组织性阻力。'
    },
    {
      num: 5, name: '规则', en: 'RULES', tier: '信息与规则', strength: 71,
      desc: '激励、惩罚、限制与权限。规则决定谁能做什么、什么被奖励、什么被禁止。',
      software: '发布权限、审批流程、值班制度、预算规则、晋升标准。规则比口号更能塑造行为。',
      warn: '规则会催生规避行为；只加规则而不改目的，往往制造“上有政策，下有对策”。'
    },
    {
      num: 4, name: '自组织', en: 'SELF-ORGANIZATION', tier: '系统能力', strength: 79,
      desc: '系统增加、变化或进化自身结构的能力。多样性、实验和容错，是自组织的燃料。',
      software: '自治团队、插件生态、开源社区、内部创新机制。允许局部试错，系统才能长出新能力。',
      warn: '自组织会产生不可预测性，现有权力结构常常本能地压制它。'
    },
    {
      num: 3, name: '目标', en: 'GOALS', tier: '目的与范式', strength: 87,
      desc: '系统的目的或功能。目标一变，规则、信息和结构的意义都会跟着改变。',
      software: '从“最大化交付数量”转向“最大化用户价值”；从“零故障”转向“快速恢复与学习”。',
      warn: '改目标会触碰既得利益与身份认同，口号容易改，真实奖励很难改。'
    },
    {
      num: 2, name: '社会范式', en: 'PARADIGM', tier: '目的与范式', strength: 95,
      desc: '决定系统为何如此的心智模式与共享假设。范式是目标、规则和结构的上游。',
      software: '“增长就是好”“人必须被管理”“效率高于适应力”“技术可以解决一切”。',
      warn: '范式通常被视为常识，身处其中的人很难看见它，更难质疑它。'
    },
    {
      num: 1, name: '超越范式', en: 'TRANSCENDING PARADIGMS', tier: '元层', strength: 100,
      desc: '意识到所有范式都是不完整的模型，并保持在不同视角之间切换的能力。不是没有立场，而是不被单一立场俘获。',
      software: '同时看见效率与韧性、局部与整体、短期与长期；在冲突的模型之间做实验，而不是选边站。',
      warn: '这是最高杠杆，也最难操作。它要求持续的自省、谦逊和与不确定性共处。'
    }
  ];
  let activeLever = 12;
  let leverageRendered = false;

  function meterLabel(strength) {
    if (strength >= 90) return '最强';
    if (strength >= 70) return '很强';
    if (strength >= 50) return '中等';
    if (strength >= 30) return '较弱';
    return '最弱';
  }

  function selectLeverage(num) {
    const item = leveragePoints.find((p) => p.num === num);
    if (!item) return;
    activeLever = num;
    $$('#leverageList .lever').forEach((btn) => btn.classList.toggle('is-active', Number(btn.dataset.lever) === num));
    $('#leverDetailNum').textContent = item.num;
    $('#leverDetailTier').textContent = item.tier;
    $('#leverDetailTitle').textContent = item.name;
    $('#leverDetailEn').textContent = item.en;
    $('#leverDetailDesc').textContent = item.desc;
    $('#leverDetailSoftware').textContent = item.software;
    $('#leverDetailWarn').textContent = item.warn;
    $('#leverMeterFill').style.width = `${item.strength}%`;
    $('#leverMeterText').textContent = meterLabel(item.strength);
  }

  function renderLeverage() {
    if (!$('#leverageList') || leverageRendered) {
      if ($('#leverageList')) selectLeverage(activeLever);
      return;
    }
    leverageRendered = true;
    $('#leverageList').innerHTML = leveragePoints.map((p) => `
      <button class="lever" data-lever="${p.num}" style="--w:${p.strength}%" type="button">
        <span class="lever-num">${String(p.num).padStart(2, '0')}</span>
        <span class="lever-name">${p.name}</span>
        <span class="lever-tier">${p.tier}</span>
      </button>
    `).join('');
    $$('#leverageList .lever').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectLeverage(Number(btn.dataset.lever));
        audio.click();
      });
    });
    selectLeverage(activeLever);
  }

  /* ================================================================== CH09 */
  const principles = [
    { num: 1, group: 'see', title: '跟上系统的节拍', summary: '先观察它的历史与真实行为，再谈干预。', action: '在复盘时先画一张真实数据的时间曲线，而不是从解释开始。去问那些长期观察系统的人，他们看到了什么。' },
    { num: 2, group: 'see', title: '把心智模式摊在阳光下', summary: '把假设说出来，让它们可以被检验。', action: '在方案评审时显式写出：“我们假设用户会在 3 秒内重试。”然后设计一个可以证伪它的实验。' },
    { num: 3, group: 'see', title: '相信、尊重并分享信息', summary: '不要让信息在层级中被过滤、扭曲或藏起来。', action: '让故障数据、用户反馈和成本信息流向真正需要做决定的人，而不是停在中间层。' },
    { num: 4, group: 'see', title: '谨慎使用语言', summary: '用系统概念丰富语言，少用指责性叙事。', action: '把“他们又搞砸了”换成“什么结构让这个行为变得合理？”语言改变注意力。' },
    { num: 5, group: 'design', title: '关注重要的，而不只是容易衡量的', summary: '不要让可测量性替代重要性。', action: '在指标旁边补一个“我们真正关心什么”的说明；定期检查指标是否偏离了真实目标。' },
    { num: 6, group: 'design', title: '为反馈系统制定有反馈的政策', summary: '政策本身也要根据结果修正，而不是一次性定死。', action: '为每个流程设置回顾触发器和调整条件；让规则保留学习能力。' },
    { num: 7, group: 'design', title: '追求整体利益', summary: '不要用子系统的胜利换整体的失败。', action: '在优化团队指标前，先检查它会不会把成本推给其他团队或用户。' },
    { num: 8, group: 'design', title: '聆听系统的智慧', summary: '系统已有自我调节能力，不要急着替它做所有决定。', action: '先问：我们能不能恢复一段反馈，而不是再加一个控制中心？' },
    { num: 9, group: 'design', title: '界定系统的职责', summary: '让决策者直接、快速地看见自己行为的后果。', action: '让开发团队参与 on-call，让需求方看到线上成本；把决策与结果之间的反馈缩短。' },
    { num: 10, group: 'be', title: '保持谦逊，做一名学习者', summary: '模型永远不完整，系统永远比我们聪明。', action: '把“我知道答案”换成“这是我的模型，它可能是错的。我们怎么验证？”' },
    { num: 11, group: 'be', title: '庆祝复杂性', summary: '复杂不是缺陷，而是生命与适应的来源。', action: '为不同的工作方式、背景和观点留出空间；不要用单一最优解压平所有差异。' },
    { num: 12, group: 'be', title: '扩展时间的范围', summary: '把决策放到更长的时间尺度上检查。', action: '问：这个选择在 6 个月、3 年后会留下什么存量？' },
    { num: 13, group: 'be', title: '打破各种清规戒律', summary: '质疑“我们一直都这样做”的规则。', action: '选一条从未被验证的流程，问它今天还在解决什么问题；如果答案消失，就删掉它。' },
    { num: 14, group: 'be', title: '扩大关切的范围', summary: '把边界外的生命、生态与未来纳入考虑。', action: '在技术决策中纳入用户、运维、供应商和环境的成本，而不只是本团队的季度指标。' },
    { num: 15, group: 'be', title: '不要降低“善”的标准', summary: '当标准开始漂移时，守住更高的参照。', action: '为质量、诚实和公平设定不可随绩效下调的底线；用历史最佳而不是最近表现做参照。' }
  ];
  const principleGroups = {
    see: { label: '观察 · 先看见，再行动', color: 'var(--accent)' },
    design: { label: '设计 · 改变结构与反馈', color: 'var(--gold)' },
    be: { label: '姿态 · 成为一个系统思考者', color: 'var(--blue)' }
  };
  let principlesRendered = false;
  let principleFilter = 'all';

  function renderPrinciples() {
    if (!$('#principlesWrap')) return;
    if (!principlesRendered) {
      principlesRendered = true;
      $('#principlesWrap').innerHTML = Object.entries(principleGroups).map(([key, group]) => {
        const cards = principles.filter((p) => p.group === key).map((p) => `
          <button class="principle-card" type="button" data-principle="${p.num}" aria-expanded="false" style="--group-color:${group.color}">
            <span class="principle-card-top"><span class="principle-num">${String(p.num).padStart(2, '0')}</span><svg class="icon principle-arrow"><use href="#i-chevron"></use></svg></span>
            <h3>${p.title}</h3>
            <p>${p.summary}</p>
            <span class="principle-more"><span>带到现场</span><p>${p.action}</p></span>
          </button>
        `).join('');
        return `<div class="principle-group" data-group="${key}" style="--group-color:${group.color}"><div class="principle-group-head"><span>${group.label}</span><i></i></div><div class="principle-grid">${cards}</div></div>`;
      }).join('');
      $$('#principlesWrap [data-principle]').forEach((card) => {
        card.addEventListener('click', () => {
          const open = card.classList.toggle('is-open');
          card.setAttribute('aria-expanded', String(open));
          audio.click();
        });
      });
    }
    applyPrincipleFilter(principleFilter);
  }

  function applyPrincipleFilter(filter) {
    principleFilter = filter;
    $$('#principlesWrap .principle-group').forEach((group) => {
      group.classList.toggle('is-hidden', filter !== 'all' && group.dataset.group !== filter);
    });
    $$('#principleFilter [data-filter]').forEach((btn) => {
      const on = btn.dataset.filter === filter;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    if (filter !== 'all') {
      $$('#principlesWrap .principle-group').forEach((group) => group.classList.remove('is-hidden'));
      $$('#principlesWrap .principle-group').forEach((group) => {
        if (group.dataset.group !== filter) group.classList.add('is-hidden');
      });
    }
  }

  function initPrinciples() {
    if (!$('#principleFilter')) return;
    renderPrinciples();
    $$('#principleFilter [data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyPrincipleFilter(btn.dataset.filter);
        audio.click();
      });
    });
  }

  /* ================================================================== CH10 */
  const sandboxTemplates = {
    debt: {
      nodes: [
        { id: 'n_pressure', name: '交付压力', x: 150, y: 105 },
        { id: 'n_shortcut', name: '走捷径', x: 160, y: 335 },
        { id: 'n_debt', name: '技术债', x: 450, y: 182 },
        { id: 'n_rework', name: '返工', x: 440, y: 420 },
        { id: 'n_cost', name: '维护成本', x: 735, y: 115 },
        { id: 'n_speed', name: '交付速度', x: 745, y: 340 }
      ],
      edges: [
        { id: 'e1', from: 'n_pressure', to: 'n_shortcut', sign: 1 },
        { id: 'e2', from: 'n_shortcut', to: 'n_debt', sign: 1 },
        { id: 'e3', from: 'n_debt', to: 'n_rework', sign: 1 },
        { id: 'e4', from: 'n_rework', to: 'n_pressure', sign: 1 },
        { id: 'e5', from: 'n_debt', to: 'n_cost', sign: 1 },
        { id: 'e6', from: 'n_cost', to: 'n_speed', sign: -1 },
        { id: 'e7', from: 'n_speed', to: 'n_pressure', sign: -1 }
      ]
    },
    commons: {
      nodes: [
        { id: 'c_use', name: '资源使用量', x: 165, y: 100 },
        { id: 'c_resource', name: '公共资源', x: 445, y: 170 },
        { id: 'c_benefit', name: '个体收益', x: 160, y: 350 },
        { id: 'c_cost', name: '稀缺成本', x: 720, y: 110 },
        { id: 'c_monitor', name: '监管反馈', x: 710, y: 355 },
        { id: 'c_regen', name: '资源再生', x: 450, y: 430 }
      ],
      edges: [
        { id: 'ce1', from: 'c_use', to: 'c_resource', sign: -1 },
        { id: 'ce2', from: 'c_resource', to: 'c_use', sign: 1 },
        { id: 'ce3', from: 'c_use', to: 'c_benefit', sign: 1 },
        { id: 'ce4', from: 'c_benefit', to: 'c_use', sign: 1 },
        { id: 'ce5', from: 'c_resource', to: 'c_cost', sign: -1 },
        { id: 'ce6', from: 'c_cost', to: 'c_use', sign: -1 },
        { id: 'ce7', from: 'c_use', to: 'c_monitor', sign: 1 },
        { id: 'ce8', from: 'c_monitor', to: 'c_use', sign: -1 },
        { id: 'ce9', from: 'c_resource', to: 'c_regen', sign: 1 },
        { id: 'ce10', from: 'c_regen', to: 'c_resource', sign: 1 }
      ]
    },
    erosion: {
      nodes: [
        { id: 'r_perf', name: '实际绩效', x: 155, y: 115 },
        { id: 'r_target', name: '绩效标准', x: 445, y: 115 },
        { id: 'r_gap', name: '差距压力', x: 445, y: 350 },
        { id: 'r_effort', name: '改进努力', x: 155, y: 350 },
        { id: 'r_lower', name: '降低标准', x: 735, y: 230 }
      ],
      edges: [
        { id: 're1', from: 'r_perf', to: 'r_gap', sign: -1 },
        { id: 're2', from: 'r_target', to: 'r_gap', sign: 1 },
        { id: 're3', from: 'r_gap', to: 'r_effort', sign: 1 },
        { id: 're4', from: 'r_effort', to: 'r_perf', sign: 1 },
        { id: 're5', from: 'r_perf', to: 'r_lower', sign: -1 },
        { id: 're6', from: 'r_lower', to: 'r_target', sign: -1 }
      ]
    },
    blank: { nodes: [], edges: [] }
  };

  const sandbox = {
    template: 'debt',
    nodes: [],
    edges: [],
    selectedNode: null,
    selectedEdge: null,
    connectSource: null,
    mode: 'select',
    sign: 1,
    rendered: false,
    pendingNode: null
  };

  function cloneTemplate(key) {
    const t = sandboxTemplates[key] || sandboxTemplates.blank;
    return {
      nodes: t.nodes.map((n) => ({ ...n })),
      edges: t.edges.map((e) => ({ ...e }))
    };
  }

  function loadSandboxFromStorage() {
    const saved = readJSON(SANDBOX_KEY, null);
    if (saved && Array.isArray(saved.nodes) && Array.isArray(saved.edges) && sandboxTemplates[saved.template]) {
      sandbox.template = saved.template;
      sandbox.nodes = saved.nodes.filter((n) => n && typeof n.name === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y)).map((n) => ({
        id: String(n.id), name: String(n.name).slice(0, 18), x: clamp(Number(n.x), 50, 850), y: clamp(Number(n.y), 40, 480)
      }));
      const valid = new Set(sandbox.nodes.map((n) => n.id));
      sandbox.edges = saved.edges.filter((e) => e && valid.has(e.from) && valid.has(e.to) && e.from !== e.to).map((e) => ({
        id: String(e.id || uid('e')), from: String(e.from), to: String(e.to), sign: Number(e.sign) < 0 ? -1 : 1
      }));
    } else {
      const t = cloneTemplate('debt');
      sandbox.nodes = t.nodes;
      sandbox.edges = t.edges;
    }
  }

  function saveSandbox() {
    writeJSON(SANDBOX_KEY, { template: sandbox.template, nodes: sandbox.nodes, edges: sandbox.edges });
    state.loopCount = computeSandboxLoops().length;
    saveState();
  }

  function sandboxNodeById(id) {
    return sandbox.nodes.find((n) => n.id === id);
  }

  function computeSandboxLoops() {
    const adj = new Map(sandbox.nodes.map((n) => [n.id, []]));
    sandbox.edges.forEach((edge) => {
      if (adj.has(edge.from) && adj.has(edge.to)) adj.get(edge.from).push(edge);
    });
    const loops = [];
    const seen = new Set();
    const maxNodes = 8;
    const canonical = (nodeIds, edgeList) => {
      let minIndex = 0;
      for (let i = 1; i < nodeIds.length; i++) {
        if (nodeIds[i] < nodeIds[minIndex]) minIndex = i;
      }
      const rotNodes = nodeIds.slice(minIndex).concat(nodeIds.slice(0, minIndex));
      const rotEdges = edgeList.slice(minIndex).concat(edgeList.slice(0, minIndex));
      return { key: rotNodes.join('>'), nodes: rotNodes, edges: rotEdges };
    };
    const starts = sandbox.nodes.map((n) => n.id).sort();
    starts.forEach((start) => {
      const walk = (current, nodePath, edgePath, visited) => {
        const outgoing = adj.get(current) || [];
        for (const edge of outgoing) {
          if (edge.to === start) {
            if (nodePath.length >= 2) {
              const c = canonical(nodePath, edgePath.concat(edge));
              if (!seen.has(c.key)) {
                seen.add(c.key);
                const product = c.edges.reduce((acc, e) => acc * (e.sign < 0 ? -1 : 1), 1);
                loops.push({
                  type: product > 0 ? 'R' : 'B',
                  nodes: c.nodes,
                  nodeNames: c.nodes.map((id) => sandboxNodeById(id)?.name || '?'),
                  edges: c.edges
                });
              }
            }
          } else if (!visited.has(edge.to) && nodePath.length < maxNodes) {
            visited.add(edge.to);
            walk(edge.to, nodePath.concat(edge.to), edgePath.concat(edge), visited);
            visited.delete(edge.to);
          }
        }
      };
      walk(start, [start], [], new Set([start]));
    });
    return loops.slice(0, 12);
  }

  function edgeGeometry(edge, index = 0) {
    const from = sandboxNodeById(edge.from);
    const to = sandboxNodeById(edge.to);
    if (!from || !to) return null;
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let len = Math.hypot(dx, dy) || 1;
    let ux = dx / len;
    let uy = dy / len;
    const boundaryDistance = (ax, ay) => {
      const tx = Math.abs(ax) < 1e-6 ? Infinity : 49 / Math.abs(ax);
      const ty = Math.abs(ay) < 1e-6 ? Infinity : 25 / Math.abs(ay);
      return Math.min(tx, ty);
    };
    const edgeDistance = boundaryDistance(ux, uy);
    const startPad = Math.min(len * .42, edgeDistance + 4);
    const endPad = Math.min(len * .46, edgeDistance + 14);
    const sx = from.x + ux * startPad;
    const sy = from.y + uy * startPad;
    const ex = to.x - ux * endPad;
    const ey = to.y - uy * endPad;
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const bendDir = (edge.id.charCodeAt(edge.id.length - 1) % 2 === 0) ? 1 : -1;
    const bend = Math.min(26, 10 + len * .035) * bendDir;
    const cx = mx + (-uy) * bend;
    const cy = my + (ux) * bend;
    const labelX = .25 * sx + .5 * cx + .25 * ex;
    const labelY = .25 * sy + .5 * cy + .25 * ey;
    return { sx, sy, ex, ey, cx, cy, labelX, labelY };
  }

  function drawSandboxEdges() {
    const layer = $('#sandboxEdges');
    if (!layer) return;
    layer.innerHTML = '';
    sandbox.edges.forEach((edge, index) => {
      const geo = edgeGeometry(edge, index);
      if (!geo) return;
      const selected = sandbox.selectedEdge === edge.id;
      const neg = edge.sign < 0;
      const color = selected ? cssVar('--gold') : neg ? cssVar('--coral') : cssVar('--accent');
      const marker = selected ? 'sbArrowSel' : neg ? 'sbArrowMinus' : 'sbArrowPlus';
      const d = `M ${geo.sx.toFixed(1)} ${geo.sy.toFixed(1)} Q ${geo.cx.toFixed(1)} ${geo.cy.toFixed(1)} ${geo.ex.toFixed(1)} ${geo.ey.toFixed(1)}`;
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('data-edge-id', edge.id);
      hit.style.pointerEvents = 'stroke';
      hit.style.cursor = 'pointer';
      layer.appendChild(hit);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', selected ? '2.4' : '1.55');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', `url(#${marker})`);
      path.setAttribute('opacity', selected ? '1' : '.8');
      path.style.pointerEvents = 'none';
      layer.appendChild(path);
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badge.setAttribute('class', 'sandbox-edge-label');
      badge.style.pointerEvents = 'none';
      const badgeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      badgeCircle.setAttribute('cx', geo.labelX.toFixed(1));
      badgeCircle.setAttribute('cy', geo.labelY.toFixed(1));
      badgeCircle.setAttribute('r', '7.5');
      badgeCircle.setAttribute('fill', cssVar('--panel'));
      badgeCircle.setAttribute('stroke', color);
      badgeCircle.setAttribute('stroke-width', '1');
      badge.appendChild(badgeCircle);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', geo.labelX.toFixed(1));
      label.setAttribute('y', (geo.labelY + .5).toFixed(1));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('fill', color);
      label.style.fontFamily = 'var(--mono)';
      label.style.fontSize = '11px';
      label.style.fontWeight = '600';
      label.textContent = neg ? '−' : '+';
      badge.appendChild(label);
      layer.appendChild(badge);
    });
  }

  function updateSandboxStatus() {
    const status = $('#sandboxStatus');
    if (!status) return;
    let text = '选择模式：拖动变量，或点击“连接”开始画因果。';
    if (sandbox.mode === 'connect') {
      text = sandbox.connectSource
        ? `连接模式：起点是「${sandboxNodeById(sandbox.connectSource)?.name || '?'}」，点击另一个变量完成连接。`
        : '连接模式：点击起点，再点击终点。当前极性会显示在箭头上。';
    } else if (sandbox.selectedEdge) {
      text = '已选中一条因果链。按“删除”移除它。';
    } else if (sandbox.selectedNode) {
      text = `已选中「${sandboxNodeById(sandbox.selectedNode)?.name || '?'}」。可拖动、双击重命名，或按删除。`;
    }
    status.innerHTML = `<span class="status-dot"></span>${text}`;
    $('#sandboxCanvas').classList.toggle('is-connecting', sandbox.mode === 'connect');
  }

  function renderSandboxNodes() {
    const layer = $('#sandboxNodes');
    if (!layer) return;
    layer.innerHTML = '';
    sandbox.nodes.forEach((node) => {
      const el = document.createElement('div');
      el.className = 'node-chip';
      el.dataset.nodeId = node.id;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `变量：${node.name}`);
      el.innerHTML = `<span class="node-chip-name">${escapeHTML(node.name)}</span><small>VARIABLE</small>`;
      el.style.left = `${(node.x / 900) * 100}%`;
      el.style.top = `${(node.y / 520) * 100}%`;
      if (sandbox.selectedNode === node.id) el.classList.add('is-selected');
      if (sandbox.connectSource === node.id) el.classList.add('is-connect-source');
      layer.appendChild(el);
      bindSandboxNode(el, node);
    });
    $('#sandboxEmpty').hidden = sandbox.nodes.length > 0;
  }

  function bindSandboxNode(el, node) {
    let moved = false;
    let startX = 0, startY = 0, nodeX = 0, nodeY = 0;
    el.addEventListener('pointerdown', (e) => {
      if (sandbox.mode !== 'select') return;
      e.preventDefault();
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      nodeX = node.x;
      nodeY = node.y;
      el.classList.add('is-dragging');
      el.setPointerCapture?.(e.pointerId);
      const onMove = (ev) => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
        if (!moved) return;
        const canvas = $('#sandboxCanvas');
        const rect = canvas.getBoundingClientRect();
        node.x = clamp(nodeX + ((ev.clientX - startX) / rect.width) * 900, 50, 850);
        node.y = clamp(nodeY + ((ev.clientY - startY) / rect.height) * 520, 40, 480);
        el.style.left = `${(node.x / 900) * 100}%`;
        el.style.top = `${(node.y / 520) * 100}%`;
        drawSandboxEdges();
      };
      const onUp = () => {
        el.classList.remove('is-dragging');
        el.releasePointerCapture?.(e.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          el.dataset.suppressClick = '1';
          saveSandbox();
          renderLoopPanel();
          setTimeout(() => { delete el.dataset.suppressClick; }, 30);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
    el.addEventListener('click', (e) => {
      if (el.dataset.suppressClick) return;
      e.stopPropagation();
      if (sandbox.mode === 'connect') {
        if (!sandbox.connectSource) {
          sandbox.connectSource = node.id;
          sandbox.selectedNode = null;
          sandbox.selectedEdge = null;
          renderSandboxNodes();
          updateSandboxStatus();
          audio.click();
        } else if (sandbox.connectSource === node.id) {
          sandbox.connectSource = null;
          renderSandboxNodes();
          updateSandboxStatus();
        } else {
          const exists = sandbox.edges.some((edge) => edge.from === sandbox.connectSource && edge.to === node.id && edge.sign === sandbox.sign);
          if (exists) {
            toast('这条因果链已经存在');
            audio.error();
            return;
          }
          sandbox.edges.push({ id: uid('e'), from: sandbox.connectSource, to: node.id, sign: sandbox.sign });
          sandbox.connectSource = null;
          saveSandbox();
          renderSandbox();
          toast(`已连接 · ${sandbox.sign > 0 ? '同向（+）' : '反向（−）'}`);
          audio.open();
        }
      } else {
        sandbox.selectedNode = node.id;
        sandbox.selectedEdge = null;
        renderSandboxNodes();
        drawSandboxEdges();
        updateSandboxStatus();
        audio.click();
      }
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openNodeDialog('rename', node.id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        sandbox.selectedNode = node.id;
        deleteSandboxSelection();
      }
    });
  }

  function renderLoopPanel() {
    if (!$('#loopList')) return;
    const loops = computeSandboxLoops();
    if (state.loopCount !== loops.length) {
      state.loopCount = loops.length;
      saveState();
    }
    $('#loopCount').textContent = loops.length;
    $('#sandboxStats').textContent = `${sandbox.nodes.length} 变量 · ${sandbox.edges.length} 条因果链 · ${loops.length} 个回路`;
    if (!loops.length) {
      $('#loopList').innerHTML = '<div class="loop-empty"><span>◎</span><p>还没有发现回路。<br>把箭头连回起点试试。</p></div>';
      return;
    }
    $('#loopList').innerHTML = loops.slice(0, 6).map((loop) => `
      <div class="loop-item">
        <div class="loop-item-head"><span class="loop-type ${loop.type === 'B' ? 'is-b' : ''}">${loop.type}</span><strong>${loop.type === 'R' ? '增强回路' : '调节回路'}</strong></div>
        <p>${loop.nodeNames.map(escapeHTML).join(' → ')} → ${escapeHTML(loop.nodeNames[0])}</p>
      </div>
    `).join('') + (loops.length > 6 ? `<div class="loop-item"><p>还有 ${loops.length - 6} 个回路未显示。</p></div>` : '');
  }

  function renderSandbox() {
    if (!$('#sandboxCanvas')) return;
    sandbox.rendered = true;
    $('#sandboxTemplate').value = sandbox.template;
    $('#addNodeBtn').disabled = false;
    $('#linkModeBtn').classList.toggle('is-active', sandbox.mode === 'connect');
    $('#linkModeBtn').setAttribute('aria-pressed', String(sandbox.mode === 'connect'));
    $('#polarityBtn').textContent = sandbox.sign > 0 ? '＋' : '−';
    $('#polarityBtn').classList.toggle('is-minus', sandbox.sign < 0);
    $('#polarityBtn').setAttribute('aria-label', sandbox.sign > 0 ? '当前连接极性：正' : '当前连接极性：负');
    drawSandboxEdges();
    renderSandboxNodes();
    renderLoopPanel();
    updateSandboxStatus();
    if (sandbox.nodes.length) $('#sandboxEmpty').hidden = true;
  }

  function deleteSandboxSelection() {
    if (sandbox.selectedNode) {
      const id = sandbox.selectedNode;
      sandbox.nodes = sandbox.nodes.filter((n) => n.id !== id);
      sandbox.edges = sandbox.edges.filter((e) => e.from !== id && e.to !== id);
      sandbox.selectedNode = null;
      if (sandbox.connectSource === id) sandbox.connectSource = null;
    } else if (sandbox.selectedEdge) {
      sandbox.edges = sandbox.edges.filter((e) => e.id !== sandbox.selectedEdge);
      sandbox.selectedEdge = null;
    } else {
      toast('先选中一个变量或一条因果链');
      return;
    }
    saveSandbox();
    renderSandbox();
    audio.click();
  }

  function openNodeDialog(mode, id = null) {
    sandbox.pendingNode = { mode, id };
    const title = $('#nodeModalTitle');
    const input = $('#nodeName');
    title.textContent = mode === 'rename' ? '重命名变量' : '添加一个变量';
    input.value = mode === 'rename' ? (sandboxNodeById(id)?.name || '') : '';
    input.placeholder = mode === 'rename' ? '输入新的变量名' : '例如：交付压力';
    openModal($('#nodeModal'), input);
    setTimeout(() => input.select(), 40);
  }

  function addSandboxNode(name) {
    let x = 450, y = 260;
    for (let i = 0; i < 30; i++) {
      const tx = 180 + Math.random() * 540;
      const ty = 100 + Math.random() * 300;
      if (sandbox.nodes.every((n) => Math.hypot(n.x - tx, n.y - ty) > 110)) {
        x = tx;
        y = ty;
        break;
      }
    }
    const node = { id: uid('n'), name: name.slice(0, 18), x, y };
    sandbox.nodes.push(node);
    sandbox.selectedNode = node.id;
    sandbox.selectedEdge = null;
    sandbox.connectSource = null;
    sandbox.mode = 'select';
    saveSandbox();
    renderSandbox();
  }

  function loadSandboxTemplate(key, save = true) {
    const t = cloneTemplate(key);
    sandbox.template = key;
    sandbox.nodes = t.nodes;
    sandbox.edges = t.edges;
    sandbox.selectedNode = null;
    sandbox.selectedEdge = null;
    sandbox.connectSource = null;
    sandbox.mode = 'select';
    sandbox.sign = 1;
    if (save) saveSandbox();
    renderSandbox();
  }

  function initSandbox() {
    if (!$('#sandboxShell')) return;
    loadSandboxFromStorage();
    renderSandbox();
    $('#sandboxTemplate').addEventListener('change', (e) => {
      const key = e.target.value;
      if (!sandboxTemplates[key]) return;
      const hasContent = sandbox.nodes.length > 0;
      if (hasContent && !window.confirm('载入模板会替换当前画布中的变量和因果链，继续吗？')) {
        e.target.value = sandbox.template;
        return;
      }
      loadSandboxTemplate(key);
      audio.open();
    });
    $('#addNodeBtn').addEventListener('click', () => openNodeDialog('add'));
    $('#linkModeBtn').addEventListener('click', () => {
      sandbox.mode = sandbox.mode === 'connect' ? 'select' : 'connect';
      sandbox.connectSource = null;
      sandbox.selectedEdge = null;
      renderSandbox();
      audio.click();
    });
    $('#polarityBtn').addEventListener('click', () => {
      sandbox.sign *= -1;
      $('#polarityBtn').textContent = sandbox.sign > 0 ? '＋' : '−';
      $('#polarityBtn').classList.toggle('is-minus', sandbox.sign < 0);
      $('#polarityBtn').setAttribute('aria-label', sandbox.sign > 0 ? '当前连接极性：正' : '当前连接极性：负');
      audio.click();
    });
    $('#renameBtn').addEventListener('click', () => {
      if (!sandbox.selectedNode) {
        toast('先选中一个变量，再重命名');
        return;
      }
      openNodeDialog('rename', sandbox.selectedNode);
    });
    $('#deleteBtn').addEventListener('click', deleteSandboxSelection);
    $('#clearBtn').addEventListener('click', () => {
      if (!sandbox.nodes.length && !sandbox.edges.length) return;
      if (!window.confirm('清空整个画布？此操作不可撤销。')) return;
      sandbox.nodes = [];
      sandbox.edges = [];
      sandbox.selectedNode = null;
      sandbox.selectedEdge = null;
      sandbox.connectSource = null;
      sandbox.mode = 'select';
      saveSandbox();
      renderSandbox();
      audio.click();
    });
    $('#restoreTemplate').addEventListener('click', () => {
      if (!window.confirm('恢复当前模板会覆盖你在这张画布上的修改，继续吗？')) return;
      loadSandboxTemplate(sandbox.template);
      audio.open();
    });
    $('#sandboxSvg').addEventListener('click', (e) => {
      const target = e.target.closest('[data-edge-id]');
      if (!target) return;
      sandbox.selectedEdge = target.getAttribute('data-edge-id');
      sandbox.selectedNode = null;
      drawSandboxEdges();
      renderSandboxNodes();
      updateSandboxStatus();
      audio.click();
    });
    $('#sandboxCanvas').addEventListener('click', (e) => {
      if (e.target.closest('.node-chip') || e.target.closest('[data-edge-id]')) return;
      if (sandbox.mode === 'connect' && sandbox.connectSource) {
        sandbox.connectSource = null;
        renderSandboxNodes();
        updateSandboxStatus();
      }
      if (sandbox.mode === 'select') {
        sandbox.selectedNode = null;
        sandbox.selectedEdge = null;
        drawSandboxEdges();
        renderSandboxNodes();
        updateSandboxStatus();
      }
    });
    $('#nodeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const value = $('#nodeName').value.trim().slice(0, 18);
      if (!value) return;
      if (sandbox.pendingNode?.mode === 'rename') {
        const node = sandboxNodeById(sandbox.pendingNode.id);
        if (node) {
          node.name = value;
          saveSandbox();
          renderSandbox();
          toast('变量已重命名');
        }
      } else {
        addSandboxNode(value);
        toast('变量已加入画布');
      }
      closeModals();
      sandbox.pendingNode = null;
      audio.open();
    });
    document.addEventListener('keydown', (e) => {
      if (activeChapter !== 'ch10') return;
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if ($$('.modal-layer:not([hidden])').length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sandbox.selectedNode || sandbox.selectedEdge) {
          e.preventDefault();
          deleteSandboxSelection();
        }
      }
      if (e.key === 'Escape' && sandbox.connectSource) {
        sandbox.connectSource = null;
        renderSandboxNodes();
        updateSandboxStatus();
      }
    });
  }

  /* ================================================================== CH11 */
  const chapterQuizData = {
    ch01: [
      {
        q: '你接手一个服务，团队换了两茬人，接口、值班流程和发布规则却没变，线上行为几乎一样。这最能说明什么？',
        options: ['要素是系统行为最关键的决定因素', '连接、目标与规则往往比具体人员更稳定地决定行为', '系统没有边界', '存量不会影响流量'],
        answer: 1,
        explain: '换人是在改变要素；接口、流程、目标等连接和目的没变，系统行为就容易被保留下来。对软件团队来说，只换人不改协作结构，常常只是换一种方式重复旧问题。'
      },
      {
        q: '团队口号写着“质量第一”，但晋升和奖金只看上线速度。用系统语言看，这个系统更可能在追求什么？',
        options: ['质量第一', '上线速度', '工程师人数', '代码行数'],
        answer: 1,
        explain: '目标要看系统实际奖励什么、重复什么，而不是听口号。当激励持续指向速度时，质量口号很难对抗结构。'
      },
      {
        q: '线上故障反复出现，老板问“是谁造成的”。系统思考者更应先追问什么？',
        options: ['谁最后提交了代码', '这次故障的直接触发点', '什么连接、反馈和目标让问题反复出现', '要不要先换掉负责人'],
        answer: 2,
        explain: '从事件层退一步，寻找重复模式背后的结构，才可能找到真正能改变行为的干预点。'
      }
    ],
    ch02: [
      {
        q: '团队每个迭代都关闭大量工单，但积压总量一直不降。这里的“积压总量”是什么？',
        options: ['流量', '存量', '增强回路', '时间延迟'],
        answer: 1,
        explain: '积压量是可积累、可减少的量，因此是存量。每轮新开与关闭的工单是改变它的流量。'
      },
      {
        q: '告警处理速度提高了，但告警总量持续上涨。最需要同时关注哪个量？',
        options: ['关闭数量', '流入速率与净流量', '告警颜色', '值班人数'],
        answer: 1,
        explain: '只看流出会误判系统。若流入持续大于流出，存量仍会增长；要同时看新增来源、关闭速度和净流量。'
      },
      {
        q: '技术债不能靠一个冲刺清零。想真正降低它，最直接的原则是什么？',
        options: ['只提高关闭工单的速度', '让偿还速度持续大于新增速度', '增加故事点估算', '换一个项目经理'],
        answer: 1,
        explain: '存量的方向由净流量决定。偶尔集中还债，如果新增债的速度更快，存量仍会继续上升。'
      }
    ],
    ch03: [
      {
        q: '错误率升高时，监控自动回滚到上一个版本。这属于哪种反馈？',
        options: ['调节回路', '增强回路', '存量', '边界'],
        answer: 0,
        explain: '它检测偏离并把系统拉回可接受状态，是调节回路。调节回路的目标和质量，取决于阈值与信息是否及时。'
      },
      {
        q: '用户增加 → 数据增多 → 推荐更准 → 用户继续增加。这是一个什么回路？',
        options: ['增强回路', '调节回路', '时间延迟', '缓冲器'],
        answer: 0,
        explain: '每个环节都在放大前一个变化，形成增强回路。它可以是良性增长，也可能让资源消耗加速。'
      },
      {
        q: '构建时间从 10 分钟变成 1 小时，团队仍按旧节奏合并代码，故障率上升。最相关的结构是什么？',
        options: ['反馈延迟', '目标缺失', '要素太少', '边界太窄'],
        answer: 0,
        explain: '反馈变慢后，团队对代码质量的判断滞后于现实，问题在更晚的时候才暴露。延迟让调节回路错过最佳时机。'
      }
    ],
    ch04: [
      {
        q: '产品用户数先快速上升，随后增长趋缓并接近市场容量。这条曲线最像什么？',
        options: ['无限指数增长', 'S 曲线', '无延迟的振荡', '资源崩溃'],
        answer: 1,
        explain: '前期由增强回路推动，接近承载上限后调节回路接管，形成 S 曲线。'
      },
      {
        q: '发布频率和故障率来回波动，修完一阵又反弹。最可能的结构是什么？',
        options: ['只有增强回路', '纯线性关系', '带延迟的调节回路', '系统没有边界'],
        answer: 2,
        explain: '调节回路在修正偏差，但反馈或行动存在延迟，于是系统在目标两侧来回过冲，形成振荡。'
      },
      {
        q: '系统看起来还在增长，但关键资源存量已经逼近上限。最危险的行为是什么？',
        options: ['自动稳定', '过度与崩溃', '自组织', '规模效应'],
        answer: 1,
        explain: '增长冲过承载能力后，支撑增长的资源会迅速枯竭，系统可能出现骤降。增长的表象容易掩盖限制的收紧。'
      }
    ],
    ch05: [
      {
        q: '为了降本，团队删掉所有备用节点和交叉培训。短期效率提高，长期最可能发生什么？',
        options: ['适应力下降', '自组织增强', '目标更清晰', '延迟消失'],
        answer: 0,
        explain: '冗余和多样性是适应力的来源。把它们全部优化掉，系统面对冲击时会缺少替代路径。'
      },
      {
        q: '平台允许团队自建工具、插件和小型实验，新的工作方式不断涌现。这体现了什么？',
        options: ['自组织', '调节回路', '缓冲器', '边界'],
        answer: 0,
        explain: '没有中央设计者逐项规划，局部试错与组合也能产生新结构。这正是自组织。'
      },
      {
        q: '一个子系统为了自己的 KPI 牺牲整体用户体验。这被称为什么？',
        options: ['次优化', '自组织', '增强回路', '缓冲'],
        answer: 0,
        explain: '子系统目标压过整体目标，局部看似最优，整体却变差，这就是次优化。'
      }
    ],
    ch06: [
      {
        q: '事故复盘只写“谁在几点改了什么”，还停留在哪一层？',
        options: ['事件层', '模式层', '结构层', '心智模型层'],
        answer: 0,
        explain: '只记录单次事件，很难解释问题为什么重复。需要继续追问模式、结构与背后的假设。'
      },
      {
        q: '给系统加两倍机器，吞吐只提高 10%。最可能说明什么？',
        options: ['系统是线性的', '存在非线性与瓶颈转移', '系统没有目标', '存量不存在'],
        answer: 1,
        explain: '投入与产出不成比例，通常意味着某个瓶颈仍在别处。解决一个限制后，主导限制可能已经换人。'
      },
      {
        q: '产品、风控、运维各自依据局部信息做最优选择，整体却更慢。这体现了什么？',
        options: ['有限理性', '适应力', '自组织', '层次性'],
        answer: 0,
        explain: '每个角色在局部信息下都做了合理选择，但缺少共享信息和共同目标，累加起来就产生了集体困境。'
      }
    ],
    ch07: [
      {
        q: '两个团队互相加急、抢占发布窗口，越拼整体越慢。最像哪个陷阱？',
        options: ['竞争升级', '公地悲剧', '目标侵蚀', '目标错位'],
        answer: 0,
        explain: '每一方都在对另一方的行动加码，形成向上的增强回路。继续加力只会推高成本。'
      },
      {
        q: '所有团队共用一套测试环境，各自多跑一点，最后所有人都无法验证。最像哪个陷阱？',
        options: ['公地悲剧', '政策阻力', '转嫁负担', '富者愈富'],
        answer: 0,
        explain: '使用收益归团队，拥堵成本由所有人分摊，资源状态与个体使用的反馈很弱。这是公地悲剧。'
      },
      {
        q: '每次事故都靠同一个英雄救火，团队越来越不修根因。最像哪个陷阱？',
        options: ['转嫁负担', '竞争升级', '目标侵蚀', '规避规则'],
        answer: 0,
        explain: '症状解快速有效，却侵蚀了系统自身解决问题的能力，导致更依赖外部干预。'
      }
    ],
    ch08: [
      {
        q: '团队觉得效率低，第一反应是加人、调 KPI、加预算。这更接近哪个杠杆层？',
        options: ['数字 / 参数', '信息流', '规则', '目标'],
        answer: 0,
        explain: '这些是参数层的变化，最容易操作，但也最容易被系统中的其他回路抵消。'
      },
      {
        q: '让值班工程师直接看到用户受影响的数据和后果，主要改变的是什么？',
        options: ['信息流', '缓冲器', '存量—流量结构', '数字'],
        answer: 0,
        explain: '让正确的人看见真实反馈，通常比加一条规则更根本。信息流是很有力的杠杆点。'
      },
      {
        q: '越靠近范式的干预，通常具有什么特征？',
        options: ['阻力更小', '杠杆更高，但阻力也更大', '一定立刻见效', '不需要实验'],
        answer: 1,
        explain: '目标、范式与超越范式处在杠杆阶梯高处。它们影响更深，也更容易触发身份认同和权力结构的抵抗。'
      }
    ],
    ch09: [
      {
        q: '面对复杂系统，最合适的长期姿态是什么？',
        options: ['找到万能公式并控制系统', '观察、学习、参与，与系统共舞', '忽略局部，只盯整体', '消灭所有不确定性'],
        answer: 1,
        explain: '系统不能被完全控制。观察节拍、尊重反馈、扩大时间和关切边界，并在行动中持续学习，才是可持续的姿态。'
      },
      {
        q: '把做决定的人放到用户投诉现场轮岗，最接近哪条法则？',
        options: ['界定系统职责，让决策者看见后果', '降低善的标准', '只关注容易衡量的', '庆祝复杂性'],
        answer: 0,
        explain: '让决策与结果之间形成直接反馈，是“界定系统职责”的核心。决策者要能看见自己行为的后果。'
      },
      {
        q: '复盘只写时间线，不写出大家的假设和判断，最缺哪条实践？',
        options: ['把心智模型摊在阳光下', '增加预算', '增加监控数量', '缩短会议时间'],
        answer: 0,
        explain: '时间线记录事件，假设才解释为什么。把心智模型显式写出来，才有机会检验和修正它。'
      }
    ],
    ch10: [
      {
        q: '在因果回路图中，A 增加会导致 B 减少，箭头应该标什么？',
        options: ['＋', '−', 'R', 'B'],
        answer: 1,
        explain: '负号表示反向变化：A 上升时 B 下降。R / B 标记的是整条回路，不是单条因果链。'
      },
      {
        q: '一个回路里负号个数为奇数，它通常是什么回路？',
        options: ['增强回路', '调节回路', '存量', '时间延迟'],
        answer: 1,
        explain: '负号个数为奇数表示回路会抵消变化，是调节回路 B；偶数则为增强回路 R。'
      },
      {
        q: '下面哪个更适合作为因果回路图里的变量？',
        options: ['周五发生了故障', '技术债', '系统上线了', '工程师很累'],
        answer: 1,
        explain: '变量应该能增加或减少。技术债可以上升或下降；事件和一次性状态不适合做变量。'
      }
    ],
    ch11: [
      {
        q: '你发现每次大促前都会出现发布故障。最系统的下一步是什么？',
        options: ['加大测试力度', '拉长时间轴，找重复模式与背后的结构', '换掉发布负责人', '禁止大促发布'],
        answer: 1,
        explain: '先跟上系统的节拍，从重复模式进入结构层。否则容易在不同人身上重复同一个故事。'
      },
      {
        q: '有人主张“加更多监控就能解决稳定性”。最需要补充的问题是什么？',
        options: ['谁看数据，看到后能采取什么行动', '监控用什么颜色', '预算多少', '工具品牌'],
        answer: 0,
        explain: '信息只有进入决策与行动，才构成反馈。否则只是增加告警噪声和存量。'
      },
      {
        q: '系统思考最终希望你带走什么姿态？',
        options: ['控制系统', '预测所有结果', '谦逊观察、实验、调整', '避免行动'],
        answer: 2,
        explain: '系统永远比模型复杂。带着谦逊持续观察和实验，在行动中修正，是与系统共舞的核心。'
      }
    ]
  };

  const CHAPTER_QUIZ_IDS = Object.keys(chapterQuizData);
  const CHAPTER_QUIZ_TOTAL = CHAPTER_QUIZ_IDS.reduce((total, id) => total + chapterQuizData[id].length, 0);

  function getChapterAnswers(id) {
    const questions = chapterQuizData[id] || [];
    const stored = Array.isArray(state.chapterQuizzes[id]) ? state.chapterQuizzes[id] : [];
    return questions.map((q, i) => {
      const value = stored[i];
      return Number.isInteger(value) && value >= 0 && value < q.options.length ? value : null;
    });
  }

  function chapterOptionOrder(id, qIndex, count) {
    let seed = 2166136261;
    for (const ch of `${id}:${qIndex}:options`) {
      seed ^= ch.charCodeAt(0);
      seed = Math.imul(seed, 16777619);
    }
    const order = Array.from({ length: count }, (_, i) => i);
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  function renderChapterQuiz(id) {
    const block = $(`[data-quiz="${id}"]`);
    if (!block || !chapterQuizData[id]) return;
    const questions = chapterQuizData[id];
    const answers = getChapterAnswers(id);
    const answered = answers.filter((a) => a !== null).length;
    const correct = answers.reduce((sum, a, i) => sum + (a !== null && a === questions[i].answer ? 1 : 0), 0);
    const chapterNum = id.replace('ch', '');
    const complete = answered === questions.length;
    block.classList.toggle('is-complete', complete);
    const questionHTML = questions.map((q, qi) => {
      const answer = answers[qi];
      const hasAnswer = answer !== null;
      const isCorrect = hasAnswer && answer === q.answer;
      const optionOrder = chapterOptionOrder(id, qi, q.options.length);
      const optionsHTML = optionOrder.map((oi, displayIndex) => {
        const option = q.options[oi];
        const classes = ['chapter-option'];
        if (hasAnswer) {
          if (oi === q.answer) classes.push('is-correct');
          if (oi === answer && !isCorrect) classes.push('is-wrong');
        }
        return `<button class="${classes.join(' ')}" type="button" data-chapter-option data-chapter="${id}" data-q-index="${qi}" data-option-index="${oi}" ${hasAnswer ? 'disabled' : ''}><span>${String.fromCharCode(65 + displayIndex)}</span>${option}</button>`;
      }).join('');
      return `
        <article class="chapter-q ${hasAnswer ? 'is-answered' : ''}">
          <div class="chapter-q-head">
            <span class="chapter-q-num">${String(qi + 1).padStart(2, '0')}</span>
            <div class="chapter-q-copy"><span class="chapter-q-kind">工程情境</span><h3>${q.q}</h3></div>
            <span class="chapter-q-state ${hasAnswer ? (isCorrect ? 'is-correct' : 'is-wrong') : ''}">${hasAnswer ? (isCorrect ? '✓' : '×') : '未答'}</span>
          </div>
          <div class="chapter-q-options">${optionsHTML}</div>
          ${hasAnswer ? `<div class="chapter-explain ${isCorrect ? 'is-correct' : 'is-wrong'}"><b>${isCorrect ? '答对了' : `正确答案：${q.options[q.answer]}`}</b><p>${q.explain}</p></div>` : ''}
        </article>
      `;
    }).join('');
    const completionCopy = correct === questions.length
      ? '3 / 3 全对。你不仅能命名概念，也能在工程现场识别它。'
      : correct >= 2
        ? '基本看见结构了。回看错题解释，再决定是否点亮本章。'
        : '先回看错题解释。回到本章的实验或工程翻译，再决定是否点亮本章。';
    block.innerHTML = `
      <div class="chapter-quiz-head">
        <div class="chapter-quiz-title">
          <span class="kicker">SELF-CHECK · 软件工程情境</span>
          <h2>停下来，做一次工程判断。</h2>
          <p>3 道题，不考背定义。题目都放在代码、发布、值班或团队协作的现场。</p>
        </div>
        <div class="qz-meter">
          <span class="mono">CHAPTER ${chapterNum}</span>
          <strong>${answered}<small> / ${questions.length}</small></strong>
          <div class="chapter-quiz-progress"><span style="width:${(answered / questions.length) * 100}%"></span></div>
          <small>${complete ? `答对 ${correct} 题` : '已完成题数'}</small>
        </div>
      </div>
      <div class="chapter-quiz-list">${questionHTML}</div>
      <div class="chapter-quiz-foot">
        <div class="chapter-quiz-summary">
          <span class="status-dot"></span>
          <span>${complete ? completionCopy : '选完三个答案，看看自己是否真的能把结构带回现场。'}</span>
        </div>
        ${answered > 0 ? `<button class="text-btn chapter-quiz-reset" type="button" data-chapter-quiz-reset="${id}">重做本章自测</button>` : ''}
      </div>
    `;
    updateCompleteHints();
    updateReport();
  }

  function renderAllChapterQuizzes() {
    CHAPTER_QUIZ_IDS.forEach(renderChapterQuiz);
  }

  function initChapterQuizzes() {
    renderAllChapterQuizzes();
    document.addEventListener('click', (event) => {
      const option = event.target.closest('[data-chapter-option]');
      if (option) {
        const id = option.dataset.chapter;
        const qIndex = Number(option.dataset.qIndex);
        const optionIndex = Number(option.dataset.optionIndex);
        const questions = chapterQuizData[id];
        if (!questions || !questions[qIndex]) return;
        const answers = getChapterAnswers(id);
        if (answers[qIndex] !== null) return;
        answers[qIndex] = optionIndex;
        state.chapterQuizzes[id] = answers;
        saveState();
        const isCorrect = optionIndex === questions[qIndex].answer;
        if (isCorrect) audio.success(); else audio.error();
        renderChapterQuiz(id);
        return;
      }
      const reset = event.target.closest('[data-chapter-quiz-reset]');
      if (reset) {
        const id = reset.dataset.chapterQuizReset;
        delete state.chapterQuizzes[id];
        saveState();
        renderChapterQuiz(id);
        audio.click();
      }
    });
  }

  function chapterQuizStats() {
    let answered = 0;
    let correct = 0;
    CHAPTER_QUIZ_IDS.forEach((id) => {
      const answers = getChapterAnswers(id);
      const questions = chapterQuizData[id];
      answers.forEach((answer, i) => {
        if (answer !== null) {
          answered++;
          if (answer === questions[i].answer) correct++;
        }
      });
    });
    return { answered, correct, total: CHAPTER_QUIZ_TOTAL };
  }

  /* ================================================================== CH11 */
  const quizQuestions = [
    {
      tag: 'CHAPTER 01 · 系统结构',
      q: '系统三要素中，最不显眼但通常最关键的是哪一项？',
      options: ['要素', '连接', '目标', '边界'],
      answer: 2,
      explain: '目标决定了系统实际奖励什么、重复什么。它不像要素那样看得见，却最能解释系统为何这样行动。'
    },
    {
      tag: 'CHAPTER 02 · 存量与流量',
      q: '“技术债”更适合被理解为什么？',
      options: ['一种流量', '一种存量', '一个增强回路', '一个时间延迟'],
      answer: 1,
      explain: '技术债会积累、带来持续成本，也无法一夜清除，因此是存量。每个迭代产生的“新债”才是流量。'
    },
    {
      tag: 'CHAPTER 03 · 反馈',
      q: '增强回路（R）最典型的作用是什么？',
      options: ['把系统拉回目标', '放大当前的变化方向', '消除所有延迟', '让系统停止变化'],
      answer: 1,
      explain: '增强回路放大偏离：可以带来指数增长，也可以带来加速崩溃。它不判断好坏，只负责放大。'
    },
    {
      tag: 'CHAPTER 03 · 延迟',
      q: '一个调节回路加上较大的时间延迟，最可能出现什么行为？',
      options: ['立刻稳定', '线性增长', '过冲与振荡', '完全随机'],
      answer: 2,
      explain: '系统根据过时的信息行动，等结果出现时已经修正过度，于是在目标两侧来回摆动。'
    },
    {
      tag: 'CHAPTER 05 · 系统之美',
      q: '系统的三大特征是什么？',
      options: ['规模、速度、成本', '适应力、自组织、层次性', '输入、处理、输出', '目标、规则、信息'],
      answer: 1,
      explain: 'Meadows 用适应力、自组织和层次性来描述系统为何运作得如此精妙。'
    },
    {
      tag: 'CHAPTER 05 · 适应力',
      q: '为了保持长期适应力，系统通常需要什么？',
      options: ['尽可能高的效率', '完全消除冗余', '多样反馈与一定冗余', '中央集中所有决策'],
      answer: 2,
      explain: '适应力来自多条可替代的反馈路径。把冗余全部优化掉，短期效率会提高，但系统面对冲击会更脆弱。'
    },
    {
      tag: 'CHAPTER 07 · 公地悲剧',
      q: '公地悲剧最直接的破局方向是什么？',
      options: ['呼吁每个人更有道德，但不改结构', '恢复资源状态与使用行为之间的反馈', '增加公共资源的使用者', '把资源藏起来不让人知道'],
      answer: 1,
      explain: '关键在于让使用者看见并承担过度使用的后果：配额、价格、监管、资源切分或共同治理，都是恢复反馈的方式。'
    },
    {
      tag: 'CHAPTER 07 · 目标侵蚀',
      q: '“目标侵蚀”的典型破局方式是什么？',
      options: ['把目标降得更低以减少压力', '坚持绝对标准或历史最佳表现', '增加更多检查表', '让每个人都更努力工作'],
      answer: 1,
      explain: '目标不能跟着下滑的绩效一起漂移。锚定绝对标准或过去最佳表现，才能把向下的增强回路反转。'
    },
    {
      tag: 'CHAPTER 08 · 杠杆点',
      q: '在 Meadows 的十二个杠杆点中，通常被认为杠杆最高的是哪一项？',
      options: ['调整参数和数字', '加强调节回路', '改变信息流', '超越范式'],
      answer: 3,
      explain: '最高杠杆是“超越范式”：意识到所有模型都不完整，并保持在不同范式之间切换的能力。它最难，也最深刻。'
    },
    {
      tag: 'CHAPTER 09 · 与系统共舞',
      q: '系统思考者面对复杂系统，最合适的基本姿态是什么？',
      options: ['找到万能公式并控制系统', '消灭所有不确定性', '观察、学习、参与，与系统共舞', '忽略局部，只盯整体'],
      answer: 2,
      explain: '系统不能被完全控制。观察节拍、尊重反馈、扩大时间与关切边界，并在行动中持续学习，才是可持续的姿态。'
    }
  ];
  const quiz = { index: 0, score: 0, answered: false, completed: false };

  function renderQuiz() {
    if (!$('#quizLab')) return;
    quiz.completed = false;
    quiz.answered = false;
    $('#quizResult').hidden = true;
    $('#quizBody').hidden = false;
    $('#quizFoot').hidden = false;
    quiz.index = quiz.index >= quizQuestions.length ? 0 : quiz.index;
    const q = quizQuestions[quiz.index];
    $('#quizStep').textContent = `QUESTION ${String(quiz.index + 1).padStart(2, '0')} / ${String(quizQuestions.length).padStart(2, '0')}`;
    $('#quizBar').style.width = `${((quiz.index + (quiz.answered ? 1 : 0)) / quizQuestions.length) * 100}%`;
    $('#quizRight').textContent = quiz.score;
    $('#quizTag').textContent = q.tag;
    $('#quizQuestion').textContent = q.q;
    $('#quizExplain').hidden = true;
    $('#quizExplain').innerHTML = '';
    $('#quizNext').disabled = true;
    $('#quizMicro').textContent = '选择一个答案，看看结构是否被你看穿。';
    $('#quizNext').innerHTML = quiz.index === quizQuestions.length - 1
      ? '查看结果 <svg class="icon"><use href="#i-arrow"></use></svg>'
      : '下一题 <svg class="icon"><use href="#i-arrow"></use></svg>';
    $('#quizOptions').innerHTML = q.options.map((opt, i) => `
      <button class="quiz-option" type="button" data-option="${i}"><span>${String.fromCharCode(65 + i)}</span>${opt}</button>
    `).join('');
    $$('#quizOptions .quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => answerQuiz(Number(btn.dataset.option)));
    });
    $('#quizNext').disabled = true;
  }

  function answerQuiz(option) {
    if (quiz.answered) return;
    quiz.answered = true;
    const q = quizQuestions[quiz.index];
    const correct = option === q.answer;
    if (correct) quiz.score++;
    $('#quizRight').textContent = quiz.score;
    $$('#quizOptions .quiz-option').forEach((btn) => {
      btn.disabled = true;
      const val = Number(btn.dataset.option);
      if (val === q.answer) btn.classList.add('is-correct');
      if (val === option && !correct) btn.classList.add('is-wrong');
    });
    $('#quizExplain').hidden = false;
    $('#quizExplain').innerHTML = `<b>${correct ? '正确 · ' : '正确答案：'}${q.options[q.answer]}</b><p>${q.explain}</p>`;
    $('#quizBar').style.width = `${((quiz.index + 1) / quizQuestions.length) * 100}%`;
    $('#quizMicro').textContent = correct ? '看见了结构。继续。' : '没关系，回看一下解释，再进入下一题。';
    $('#quizNext').disabled = false;
    if (correct) audio.success(); else audio.error();
  }

  function showQuizResult() {
    quiz.completed = true;
    const pct = Math.round((quiz.score / quizQuestions.length) * 100);
    if (pct > state.quizBest) {
      state.quizBest = quiz.score;
      saveState();
    }
    $('#quizBody').hidden = true;
    $('#quizFoot').hidden = true;
    $('#quizResult').hidden = false;
    $('#quizResultPct').textContent = pct;
    $('#quizResultRing').style.setProperty('--p', pct);
    const title = pct >= 90 ? '你已经能看见回路了。' : pct >= 70 ? '不错，结构感正在形成。' : pct >= 50 ? '基础已经建立，再回看几章。' : '系统思考需要练习，先回到结构。';
    $('#quizResultTitle').textContent = title;
    $('#quizResultText').textContent = pct >= 70
      ? '真正重要的不是分数，而是下次遇到反复出现的问题时，你是否会先问：“是什么结构在产生它？”'
      : '建议回到第 02、03、07 章，重点观察存量、反馈回路和陷阱结构。你不需要记住术语，只需要能讲出回路。';
    updateReport();
    if (pct >= 80) {
      celebrate();
      audio.complete();
    } else {
      audio.open();
    }
  }

  function resetQuiz() {
    quiz.index = 0;
    quiz.score = 0;
    quiz.answered = false;
    quiz.completed = false;
    renderQuiz();
    audio.click();
  }

  function initQuiz() {
    if (!$('#quizLab')) return;
    renderQuiz();
    $('#quizNext').addEventListener('click', () => {
      if (!quiz.answered) return;
      if (quiz.index >= quizQuestions.length - 1) {
        showQuizResult();
        return;
      }
      quiz.index++;
      quiz.answered = false;
      renderQuiz();
    });
    $('#quizRetry').addEventListener('click', resetQuiz);
  }

  /* ============================================================ final / init */
  function refreshCharts() {
    if (stock.chart) drawStockChart();
    if (tempChart) drawTempChart();
    if (compoundChart) renderCompound();
    if (zooChart) renderZoo();
    drawAllSparks();
    if (nlChart) drawNonlinear();
    if (activeChapter === 'ch05') { resizeLife(); drawLife(); }
  }

  function initFinal() {
    $('#printBtn')?.addEventListener('click', () => {
      audio.click();
      window.print();
    });
    $('#resetProgress')?.addEventListener('click', () => {
      if (!window.confirm('重置学习进度与最佳测验成绩？这个操作不会删除沙盒里的图。')) return;
      state.progress = {};
      state.quizBest = 0;
      state.chapterQuizzes = {};
      saveState();
      renderAllChapterQuizzes();
      updateProgressUI();
      updateReport();
      toast('学习进度已重置');
      audio.click();
    });
    updateReport();
  }

  function debounce(fn, wait = 160) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function init() {
    initTheme();
    initSound();
    initNavigation();
    initRanges();
    initChapterQuizzes();
    setupReveal();
    initFlipCards();
    initAssembly();
    initBoundary();
    initStockLab();
    initThermoLab();
    initCompoundLab();
    initZooLab();
    initResilience();
    initLife();
    initHierarchy();
    initIceberg();
    initNonlinear();
    initDelayCalc();
    initBounded();
    initTrapGame();
    initPrinciples();
    initSandbox();
    initQuiz();
    initFinal();
    updateProgressUI();
    bootChapter();

    const onResize = debounce(() => {
      refreshCharts();
      if (activeChapter === 'ch05') resizeLife();
    }, 180);
    window.addEventListener('resize', onResize);
    window.addEventListener('load', refreshCharts);
    document.fonts?.ready?.then(() => refreshCharts()).catch(() => {});
    setTimeout(refreshCharts, 260);
  }

  /* ================================================================== CH07 fix */
  function resetTrapGame() {
    trapGame.index = 0;
    trapGame.score = 0;
    trapGame.answered = false;
    trapGame.summary = false;
    renderTrapGame();
  }

  function showTrapSummary() {
    trapGame.summary = true;
    const pct = Math.round((trapGame.score / trapCases.length) * 100);
    $('#trapCaseTitle').textContent = `诊断完成：${trapGame.score} / ${trapCases.length}`;
    $('#trapCaseText').textContent = pct >= 75
      ? '你已经能在复杂情境里辨认结构。下一步，试着把这些回路画出来，而不只是说出名字。'
      : '认出结构需要练习。打开下方的八张卡片，重点看每个陷阱“短期有效、长期反噬”的回路。';
    $('#trapResult').hidden = false;
    $('#trapResultMark').textContent = pct >= 75 ? '✓' : '↺';
    $('#trapResultTitle').textContent = pct >= 75 ? '系统诊断力不错' : '再看一遍结构';
    $('#trapResultText').textContent = '本页不会保存诊断分数。你可以随时重新开始，或用卡片慢慢研究每个陷阱。';
    $('#trapNext').hidden = false;
    $('#trapNext').innerHTML = '重新诊断 <svg class="icon"><use href="#i-reset"></use></svg>';
    $('#trapHint').textContent = '点击“重新诊断”再来一轮。';
    $('#trapProgressBar').style.width = '100%';
    audio.open();
  }

  function bindTrapNext() {
    const btn = $('#trapNext');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (trapGame.summary) {
        resetTrapGame();
        return;
      }
      if (!trapGame.answered) return;
      if (trapGame.index >= trapCases.length - 1) {
        showTrapSummary();
        return;
      }
      trapGame.index++;
      trapGame.answered = false;
      renderTrapGame();
    });
  }

  init();

})();
