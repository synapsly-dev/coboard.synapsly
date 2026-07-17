/* ============================================================
 * 竞品分析看板 · 动效编排层(GSAP 3 + ScrollTrigger + ScrollToPlugin)
 *
 * 设计约束:
 * - 纯增强层:window.gsap 缺失时本文件全部降级为 no-op,app.js 原有
 *   降级路径(CSS transition / 直接显示)继续生效。
 * - prefers-reduced-motion: reduce 时不做位移/循环动画,仅保留
 *   进度条宽度的即时更新与内容直接显示。
 * - 字段矩阵(.matrix-wrap)内部有 sticky 表头/属性列:对其只做
 *   透明度动画,决不施加 transform;分区卡片动画结束后 clearProps
 *   清掉 transform,避免残留 transform 影响内部布局。
 * ============================================================ */
(function () {
  'use strict';

  var noop = function () {};
  var fallback = {
    onDashboardRendered: noop,
    onReviewReveal: noop,
    onProgress: function (pct) {
      var bar = document.getElementById('progress-bar');
      if (bar) bar.style.width = pct + '%';
    }
  };

  if (!window.gsap) { window.BoardMotion = fallback; return; }

  var gsap = window.gsap;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  if (window.ScrollToPlugin) gsap.registerPlugin(window.ScrollToPlugin);

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.body.classList.add('gsap-on');
  gsap.defaults({ ease: 'power2.out', duration: 0.6 });

  var dashboardCtx = null;   // 每次看板重渲染后重建的动画上下文
  var sheenTween = null;     // 进度条流光

  /* ---------------- 工具 ---------------- */

  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* 已经滚过触发线(位于视口上方)的元素直接显示,不等 ScrollTrigger */
  function splitByViewport(targets, ratio) {
    var line = window.innerHeight * (ratio || 0.92);
    var above = [], below = [];
    targets.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < line) above.push(el); else below.push(el);
    });
    return { above: above, below: below };
  }

  /* 分批滚动揭示:visible 立即入场,视口下方交给 ScrollTrigger.batch */
  function revealOnScroll(targets, vars) {
    if (!targets.length) return;
    var fromVars = Object.assign({ autoAlpha: 0, y: 22 }, vars && vars.from);
    var toVars = Object.assign({
      autoAlpha: 1, y: 0, duration: 0.65,
      stagger: 0.09, clearProps: 'transform', overwrite: 'auto'
    }, vars && vars.to);

    if (REDUCED) { gsap.set(targets, { clearProps: 'all', autoAlpha: 1 }); return; }

    gsap.set(targets, fromVars);
    var parts = splitByViewport(targets, 0.92);
    if (parts.above.length) gsap.to(parts.above, toVars);
    if (parts.below.length && window.ScrollTrigger) {
      window.ScrollTrigger.batch(parts.below, {
        start: 'top 92%',
        once: true,
        onEnter: function (batch) { gsap.to(batch, toVars); }
      });
    } else if (parts.below.length) {
      gsap.to(parts.below, toVars);
    }
  }

  /* ---------------- 统计数字滚动计数 ---------------- */

  /* 解析 "53" / "$4,530.97" / "#1,103" → {prefix, value, decimals, suffix} */
  function parseStatText(text) {
    var m = /^([^0-9\-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/.exec(String(text).trim());
    if (!m) return null;
    var num = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(num)) return null;
    var decs = (m[2].split('.')[1] || '').length;
    return { prefix: m[1], value: num, decimals: decs, suffix: m[3] };
  }

  function countUpStats(root) {
    var values = qsa('.stat-value:not(.empty)', root);
    values.forEach(function (el) {
      var parsed = parseStatText(el.textContent);
      if (!parsed || REDUCED) return;
      var obj = { v: parsed.value * 0.25 };
      gsap.to(obj, {
        v: parsed.value,
        duration: 1.1,
        ease: 'power3.out',
        onUpdate: function () {
          el.textContent = parsed.prefix + obj.v.toLocaleString('en-US', {
            minimumFractionDigits: parsed.decimals,
            maximumFractionDigits: parsed.decimals
          }) + parsed.suffix;
        },
        onComplete: function () {
          el.textContent = parsed.prefix + parsed.value.toLocaleString('en-US', {
            minimumFractionDigits: parsed.decimals,
            maximumFractionDigits: parsed.decimals
          }) + parsed.suffix;
        }
      });
    });
  }

  /* ---------------- Hero 标题逐字揭示 ---------------- */

  function splitTitle() {
    var h1 = qs('#board-title');
    if (!h1) return [];
    var text = h1.textContent;
    h1.setAttribute('aria-label', text);
    h1.innerHTML = '';
    var frag = document.createDocumentFragment();
    Array.prototype.forEach.call(text, function (ch) {
      var span = document.createElement('span');
      span.className = 'tchar';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = ch === ' ' ? ' ' : ch;
      frag.appendChild(span);
    });
    h1.appendChild(frag);
    return qsa('.tchar', h1);
  }

  function playTitleReveal(quick) {
    var chars = splitTitle();
    if (!chars.length || REDUCED) return;
    gsap.from(chars, {
      autoAlpha: 0,
      y: quick ? 10 : 18,
      rotationX: quick ? 0 : -40,
      transformOrigin: '50% 100%',
      duration: quick ? 0.4 : 0.7,
      ease: 'back.out(1.6)',
      stagger: { each: quick ? 0.015 : 0.03 }
    });
  }

  /* ---------------- Hero 入场 + 环境动效 ---------------- */

  function heroIntro() {
    if (REDUCED) return;

    var tl = gsap.timeline();
    tl.from('#hero-kicker', { autoAlpha: 0, y: 14, letterSpacing: '8px', duration: 0.6 }, 0.05);
    tl.add(playTitleReveal, 0.15);
    tl.from('#board-subtitle', { autoAlpha: 0, y: 14 }, 0.5);
    tl.from('#hero-chips .chip', { autoAlpha: 0, y: 12, scale: 0.92, stagger: 0.06, duration: 0.45 }, 0.65);
    tl.from('.anchor-nav', { yPercent: -100, autoAlpha: 0, duration: 0.5 }, 0.75);
    tl.from('#control-card', { autoAlpha: 0, y: 26, duration: 0.6, clearProps: 'transform' }, 0.9);
    tl.from('#empty-state', { autoAlpha: 0, y: 20, clearProps: 'all' }, 1.0);

    /* 光斑缓慢漂移(环境层,无限循环) */
    gsap.to('.blob-a', { x: -45, y: 30, duration: 16, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    gsap.to('.blob-b', { x: 50, y: -24, duration: 19, repeat: -1, yoyo: true, ease: 'sine.inOut' });

    /* hero 视差:滚出视口时装饰层轻微下沉 */
    if (window.ScrollTrigger) {
      gsap.to('.hero-decor', {
        yPercent: 26,
        ease: 'none',
        scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true }
      });
    }
  }

  /* ---------------- 锚点导航:滑动指示条 + 平滑滚动 ---------------- */

  function moveIndicator(animate) {
    var bar = qs('#nav-indicator');
    var active = qs('.anchor-nav a.active');
    if (!bar) return;
    if (!active) { gsap.set(bar, { width: 0 }); return; }
    var vars = { x: active.offsetLeft, width: active.offsetWidth };
    if (animate === false || REDUCED) {
      gsap.set(bar, vars);
    } else {
      gsap.to(bar, Object.assign({ duration: 0.35, ease: 'power3.out', overwrite: 'auto' }, vars));
    }
  }

  function setupNav() {
    var links = qsa('.anchor-nav a');

    /* app.js 的 scrollspy 切换 .active,这里监听 class 变化驱动指示条 */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { moveIndicator(true); });
      links.forEach(function (a) { mo.observe(a, { attributes: true, attributeFilter: ['class'] }); });
    }
    window.addEventListener('resize', function () { moveIndicator(false); });
    moveIndicator(false);

    /* 平滑滚动(替代原生 scroll-behavior) */
    if (window.ScrollToPlugin) {
      links.forEach(function (a) {
        a.addEventListener('click', function (ev) {
          var id = a.getAttribute('data-sec');
          var target = id && document.getElementById(id);
          if (!target || target.offsetParent === null) return;
          ev.preventDefault();
          if (REDUCED) { target.scrollIntoView(); return; }
          /* autoKill 必须关:滚动途中懒加载图片引发 scroll anchoring
             微调,会被误判为用户滚动而中断补间 */
          gsap.to(window, {
            duration: 0.7,
            ease: 'power2.inOut',
            scrollTo: { y: target, offsetY: 54, autoKill: false },
            overwrite: 'auto'
          });
        });
      });
    }
  }

  /* ---------------- 进度条 ---------------- */

  function ensureSheen() {
    var bar = qs('#progress-bar');
    if (!bar || REDUCED) return;
    if (!bar.querySelector('.bar-sheen')) {
      var sheen = document.createElement('span');
      sheen.className = 'bar-sheen';
      bar.appendChild(sheen);
      sheenTween = gsap.fromTo(sheen, { xPercent: -110 }, {
        xPercent: 110, duration: 1.4, repeat: -1, ease: 'power1.inOut', repeatDelay: 0.35
      });
    }
  }

  function onProgress(pct, status) {
    var bar = qs('#progress-bar');
    if (!bar) return;
    ensureSheen();
    if (REDUCED) { bar.style.width = pct + '%'; }
    else gsap.to(bar, { width: pct + '%', duration: 0.55, ease: 'power1.out', overwrite: 'auto' });
    if ((status === 'done' || status === 'error') && sheenTween) {
      sheenTween.kill();
      sheenTween = null;
      var s = bar.querySelector('.bar-sheen');
      if (s) s.remove();
    }
  }

  /* ---------------- 看板渲染完成后的分区编排 ---------------- */

  function onDashboardRendered() {
    if (dashboardCtx) { dashboardCtx.revert(); dashboardCtx = null; }
    playTitleReveal(true); /* renderDashboard 可能改写了标题文本 */

    dashboardCtx = gsap.context(function () {
      /* 产品概览:卡片 + 统计计数 */
      revealOnScroll(qsa('#product-grid .product-card'), {
        from: { y: 30, scale: 0.985 },
        to: { scale: 1, duration: 0.7, stagger: 0.1 }
      });
      countUpStats(qs('#sec-overview'));
      revealOnScroll(qsa('#notes-block .notes-block'));

      /* 分析 / VOC / Review 子卡 */
      revealOnScroll(qsa('#analysis-list .sub-card'));
      revealOnScroll(qsa('#voc-list .sub-card'));
      revealOnScroll(qsa('#reviews-list .sub-card'));

      /* 字段矩阵:容器只做透明度(内部有 sticky,禁 transform) */
      var matrix = qs('#matrix-wrap');
      if (matrix) {
        if (REDUCED) { gsap.set(matrix, { autoAlpha: 1 }); }
        else if (window.ScrollTrigger) {
          gsap.set(matrix, { autoAlpha: 0 });
          window.ScrollTrigger.create({
            trigger: matrix, start: 'top 92%', once: true,
            onEnter: function () { gsap.to(matrix, { autoAlpha: 1, duration: 0.7 }); }
          });
          if (matrix.getBoundingClientRect().top < window.innerHeight * 0.92) {
            gsap.to(matrix, { autoAlpha: 1, duration: 0.7 });
          }
        }
      }

      /* 结论 / SOP / 页脚 */
      revealOnScroll(qsa('#conclusion-block > *'), { to: { stagger: 0.12 } });
      revealOnScroll(qsa('#sop-wrap'));
      revealOnScroll(qsa('#board-footer'), { from: { y: 10 } });
    });

    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    moveIndicator(false);
  }

  /* Review「展开全部」后的新增卡片入场 */
  function onReviewReveal(container) {
    if (REDUCED || !container) return;
    var cards = qsa('.review-card', container).slice(0, 12);
    if (cards.length) {
      gsap.from(cards, { autoAlpha: 0, y: 12, duration: 0.4, stagger: 0.04, clearProps: 'all' });
    }
  }

  /* ---------------- 对外接口 + 启动 ---------------- */

  window.BoardMotion = {
    onDashboardRendered: onDashboardRendered,
    onReviewReveal: onReviewReveal,
    onProgress: onProgress
  };

  function boot() {
    heroIntro();
    setupNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
