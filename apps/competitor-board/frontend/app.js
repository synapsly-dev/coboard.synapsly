/* ============================================================
 * 竞品分析看板 · 前端逻辑(纯原生 JS,无构建、无外部依赖)
 * 数据契约:CONTRACT.md §6 Dashboard JSON;API:§7
 * ?dev=1 时直接加载 sample-dashboard.json 做无后端预览
 * ============================================================ */
(function () {
  'use strict';

  var DEV = new URLSearchParams(location.search).get('dev') === '1';
  var POLL_INTERVAL = 1500;

  /* API 基址:取当前路径的目录部分,使应用既能独立跑在 8916 根路径,
     也能经 coboard 反代挂在 /apps/competitor/ 子路径下(绝对路径 /api
     会打到宿主平台自己的 API 上,必须相对化) */
  var BASE = location.pathname.replace(/[^/]*$/, '');
  function apiPath(p) { return BASE + p; }

  var STAGE_LABELS = {
    fetch_competitor: '拉取竞品市场数据(卖家精灵)',
    fetch_detail: '拉取商品详情(亚马逊前台)',
    fetch_reviews: '拉取商品评论',
    llm_analysis: 'LLM 分析(标题五点 / VOC / 策略)',
    assemble: '组装看板数据'
  };

  var state = {
    pollTimer: null,
    currentRunId: null,
    dashboard: null
  };

  /* ---------------- 工具函数 ---------------- */

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isEmpty(v) {
    return v === null || v === undefined || v === '' ||
      (Array.isArray(v) && v.length === 0);
  }

  var EMPTY_HTML = '<span class="cell-empty">暂无数据</span>';

  function fmtNumber(v) {
    var n = Number(v);
    if (!isFinite(n)) return esc(v);
    return n.toLocaleString('en-US');
  }

  function fmtMoney(v) {
    if (typeof v === 'string' && v.trim().charAt(0) === '$') return esc(v);
    var n = Number(v);
    if (!isFinite(n)) return esc(v);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPercent(v) {
    if (typeof v === 'string' && v.indexOf('%') !== -1) return esc(v);
    var n = Number(v);
    if (!isFinite(n)) return esc(v);
    return String(parseFloat(n.toFixed(2))) + '%';
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    return String(iso).replace('T', ' ').slice(0, 19);
  }

  function statusHtml(note, fallback) {
    return '<span class="cell-status">' + esc(note || fallback || '暂无数据') + '</span>';
  }

  function apiFetch(path, options) {
    return fetch(path, options).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (body) {
        if (!resp.ok) {
          var msg = (body && (body.detail || body.error)) || ('HTTP ' + resp.status);
          throw new Error(msg);
        }
        return body;
      });
    });
  }

  /* ---------------- 单元格渲染(字段矩阵) ---------------- */

  function renderTextValue(v) {
    if (Array.isArray(v)) {
      return '<ul class="cell-list">' + v.map(function (it) {
        return '<li>' + esc(it) + '</li>';
      }).join('') + '</ul>';
    }
    return '<div class="cell-pre">' + esc(v) + '</div>';
  }

  function badgeClass(text) {
    var t = String(text).trim().toLowerCase();
    if (t === '是' || t === 'y' || t === 'yes' || t === '有') return 'badge pos';
    if (t === '否' || t === 'n' || t === 'no' || t === '无') return 'badge neg';
    if (t.indexOf('choice') !== -1 || t.indexOf('best seller') !== -1 || t.indexOf('bs') === 0) return 'badge hl';
    return 'badge';
  }

  function renderBadgeValue(v) {
    var arr = Array.isArray(v) ? v : [v];
    return arr.map(function (b) {
      return '<span class="' + badgeClass(b) + '">' + esc(b) + '</span>';
    }).join('');
  }

  function renderImageValue(url) {
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' +
      '<img class="cell-thumb" loading="lazy" src="' + esc(url) + '" alt="产品图"></a>';
  }

  /* images 值支持两种元素:纯 URL 字符串,或 {asin,imageUrl,title} 小卡对象 */
  function renderImagesValue(v) {
    var arr = Array.isArray(v) ? v : [v];
    var isCard = arr.some(function (it) { return it && typeof it === 'object'; });
    if (isCard) {
      return '<div class="thumb-grid">' + arr.map(function (it) {
        if (!it || typeof it !== 'object') {
          return '<a href="' + esc(it) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(it) + '" alt=""></a>';
        }
        var href = it.asin ? 'https://www.amazon.com/dp/' + esc(it.asin) : (it.imageUrl || '#');
        return '<a class="mini-card" href="' + esc(href) + '" target="_blank" rel="noopener" title="' + esc(it.title || '') + '">' +
          (it.imageUrl ? '<img loading="lazy" src="' + esc(it.imageUrl) + '" alt="">' : '') +
          '<span><span class="mc-asin">' + esc(it.asin || '') + '</span>' +
          '<span class="mc-sub">Amazon 推荐商品</span></span></a>';
      }).join('') + '</div>';
    }
    return '<div class="thumb-grid">' + arr.map(function (url) {
      return '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(url) + '" alt="套图"></a>';
    }).join('') + '</div>';
  }

  function renderLinkValue(v) {
    var url = v, text = v, asButton = false;
    if (v && typeof v === 'object') {
      url = v.url;
      text = v.text || v.url;
      asButton = !!v.text; /* 带展示文案的链接按示例图渲染为墨绿按钮(如"打开视频播放") */
    }
    if (isEmpty(url)) return EMPTY_HTML;
    if (asButton) {
      return '<a class="link-btn" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>';
    }
    if (text === url && String(text).length > 90) text = String(text).slice(0, 87) + '…';
    return '<span class="cell-link"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + '</a></span>';
  }

  function renderCell(type, value) {
    if (isEmpty(value)) {
      return type === 'status' ? statusHtml(null, '暂无数据') : EMPTY_HTML;
    }
    switch (type) {
      case 'number': return '<span class="cell-num">' + fmtNumber(value) + '</span>';
      case 'money': return '<span class="cell-num">' + fmtMoney(value) + '</span>';
      case 'percent': return '<span class="cell-num">' + fmtPercent(value) + '</span>';
      case 'link': return renderLinkValue(value);
      case 'image': return renderImageValue(value);
      case 'images': return renderImagesValue(value);
      case 'badge': return renderBadgeValue(value);
      case 'status': return statusHtml(value);
      case 'text':
      default: return renderTextValue(value);
    }
  }

  /* ---------------- 各区块渲染 ---------------- */

  function productHeading(p) {
    return esc(p.roleLabel || (p.role === 'my' ? '我司产品' : '竞品')) + ' ' + esc(p.asin || '');
  }

  function renderOverview(d) {
    var grid = $('#product-grid');
    grid.innerHTML = (d.products || []).map(function (p) {
      var m = p.metrics || {};
      var links = [];
      if (p.productUrl) links.push('<a href="' + esc(p.productUrl) + '" target="_blank" rel="noopener">打开商品页</a>');
      var video = p.videoUrl || (p.detail && p.detail.videoUrl);
      if (video) links.push('<a href="' + esc(video) + '" target="_blank" rel="noopener">打开视频</a>');
      if (p.brandUrl) links.push('<a href="' + esc(p.brandUrl) + '" target="_blank" rel="noopener">品牌页</a>');

      function stat(label, valueHtml, empty) {
        return '<div class="stat"><div class="stat-label">' + label + '</div>' +
          '<div class="stat-value' + (empty ? ' empty' : '') + '">' + valueHtml + '</div></div>';
      }

      var stats =
        (isEmpty(m.monthlySalesUnits) ? stat('销量', '暂无数据', true) : stat('销量', fmtNumber(m.monthlySalesUnits))) +
        (isEmpty(m.monthlySalesRevenue) ? stat('销售额', '暂无数据', true) : stat('销售额', fmtMoney(m.monthlySalesRevenue))) +
        (isEmpty(m.subBsr) ? stat('BSR(小类)', '暂无数据', true) : stat('BSR(小类)', '#' + fmtNumber(m.subBsr))) +
        (isEmpty(m.ratings) ? stat('评论', '暂无数据', true) : stat('评论', fmtNumber(m.ratings)));

      return '<article class="product-card">' +
        '<div class="pc-img">' +
        (p.imageUrl
          ? '<img loading="lazy" src="' + esc(p.imageUrl) + '" alt="' + esc(p.brand || p.asin || '') + '">'
          : '<div class="img-placeholder">暂无图片</div>') +
        '</div>' +
        '<div class="pc-role"><span class="role-badge ' + (p.role === 'my' ? 'my' : 'comp') + '">' +
        esc(p.roleLabel || (p.role === 'my' ? '我司产品' : '竞品')) + '</span>' +
        '<span class="pc-asin">' + esc(p.asin || '') + '</span></div>' +
        '<h3 class="pc-brand">' + (isEmpty(p.brand) ? '<span class="cell-empty">暂无品牌</span>' : esc(p.brand)) + '</h3>' +
        '<p class="pc-title" title="' + esc(p.title || '') + '">' + (isEmpty(p.title) ? '暂无标题' : esc(p.title)) + '</p>' +
        (links.length ? '<div class="pc-links">' + links.join('') + '</div>' : '') +
        '<div class="pc-stats">' + stats + '</div>' +
        '</article>';
    }).join('');

    var notes = $('#notes-block');
    if (d.notes && d.notes.length) {
      notes.innerHTML = '<div class="notes-block"><h3>数据与口径说明</h3><ul>' +
        d.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    } else {
      notes.innerHTML = '';
    }
  }

  function analysisRows(block) {
    if (!block) return '<p class="status-line">暂无分析数据</p>';
    function row(cls, label, content) {
      if (isEmpty(content)) return '';
      var text = Array.isArray(content) ? content.join(';') : content;
      return '<div class="pca-row"><span class="pca-lbl ' + cls + '">' + label + '</span>' +
        '<span class="pca-txt">' + esc(text) + '</span></div>';
    }
    var html = row('pros', '优点', block.pros) + row('cons', '缺点', block.cons) + row('advice', '改进', block.advice);
    return html || '<p class="status-line">暂无分析数据</p>';
  }

  function renderAnalysis(d) {
    $('#analysis-list').innerHTML = (d.products || []).map(function (p) {
      var a = p.analysis;
      var body;
      if (!a || (!a.titleAnalysis && !a.bulletsAnalysis && !a.strategy)) {
        body = '<p class="status-line">LLM 分析不可用(该产品未产出标题/五点分析结果)</p>';
      } else {
        body =
          '<h4>标题分析</h4>' + analysisRows(a.titleAnalysis) +
          '<h4>五点分析</h4>' + analysisRows(a.bulletsAnalysis) +
          (isEmpty(a.strategy) ? '' :
            '<h4>策略建议</h4><div class="pca-row"><span class="pca-lbl strategy">策略</span>' +
            '<span class="pca-txt">' + esc(a.strategy) + '</span></div>');
      }
      return '<div class="sub-card"><h3>' + productHeading(p) + '</h3>' + body + '</div>';
    }).join('');
  }

  function vocGroup(cls, title, items) {
    var inner;
    if (isEmpty(items)) {
      inner = '<p class="status-line">暂无数据</p>';
    } else {
      inner = items.map(function (it) {
        var point = (it && typeof it === 'object') ? it.point : it;
        var evidence = (it && typeof it === 'object') ? it.evidence : null;
        if (isEmpty(evidence)) {
          return '<div class="voc-item"><div class="voc-point-plain">' + esc(point || '') + '</div></div>';
        }
        return '<details class="voc-item"><summary>' + esc(point || '') + '</summary>' +
          '<ul class="evidence">' + evidence.map(function (e) {
            return '<li>' + esc(e) + '</li>';
          }).join('') + '</ul></details>';
      }).join('');
    }
    return '<div class="voc-group"><div class="voc-group-title ' + cls + '">' + title + '</div>' + inner + '</div>';
  }

  function renderVoc(d) {
    $('#voc-list').innerHTML = (d.products || []).map(function (p) {
      var voc = p.analysis && p.analysis.voc;
      var body;
      if (!voc || voc.status !== 'ok') {
        body = '<p class="status-line">' +
          esc((voc && voc.note) || 'VOC 聚类不可用:未获取到可用评论数据') + '</p>';
      } else {
        body =
          vocGroup('pos', '好评点 Top3', voc.positiveTop) +
          vocGroup('neg', '差评点 Top3', voc.negativeTop) +
          vocGroup('unmet', '未被满足需求', voc.unmetNeeds);
        if (voc.note) body += '<p class="status-line">' + esc(voc.note) + '</p>';
      }
      return '<div class="sub-card"><h3>' + productHeading(p) + '</h3>' + body + '</div>';
    }).join('');
  }

  var REVIEW_PREVIEW_COUNT = 6;

  function reviewCard(r) {
    var low = Number(r.star) <= 3;
    var starTxt = isEmpty(r.star) ? '' : (Number(r.star).toFixed(1) + '星 ');
    return '<div class="review-card' + (low ? ' low' : '') + '">' +
      '<div class="rc-head">' + esc(starTxt) + esc(r.title || '(无标题)') +
      (r.verified ? '<span class="rc-verified">已验证购买</span>' : '') + '</div>' +
      (r.date ? '<div class="rc-date">Reviewed on ' + esc(r.date) + '</div>' : '') +
      '<p class="rc-content">' + esc(r.content || '') + '</p></div>';
  }

  function renderReviews(d) {
    $('#reviews-list').innerHTML = (d.products || []).map(function (p, idx) {
      var rv = p.reviews || {};
      var body;
      if (rv.status !== 'ok') {
        body = '<div class="review-meta">缓存评论 ' + fmtNumber(rv.count || 0) + ' 条;低星评论 ' +
          fmtNumber(rv.lowStarCount || 0) + ' 条</div>' +
          '<p class="status-line">' + esc(rv.note || '评论数据不可用') + '</p>';
      } else {
        var items = rv.items || [];
        var head = items.slice(0, REVIEW_PREVIEW_COUNT).map(reviewCard).join('');
        var rest = items.slice(REVIEW_PREVIEW_COUNT).map(reviewCard).join('');
        body = '<div class="review-meta">缓存评论 ' + fmtNumber(rv.count != null ? rv.count : items.length) +
          ' 条;低星评论 ' + fmtNumber(rv.lowStarCount || 0) + ' 条</div>' +
          (rv.note ? '<p class="status-line">' + esc(rv.note) + '</p>' : '') +
          (items.length ? head : '<p class="status-line">缓存中没有评论原文</p>') +
          (rest ? '<div class="hidden" id="rv-rest-' + idx + '">' + rest + '</div>' +
            '<button type="button" class="btn-more" data-target="rv-rest-' + idx + '">展开全部 ' +
            items.length + ' 条评论</button>' : '');
      }
      return '<div class="sub-card"><h3>' + productHeading(p) + '</h3>' + body + '</div>';
    }).join('');
  }

  function renderMatrix(d) {
    var wrap = $('#matrix-wrap');
    var products = d.products || [];
    var fm = d.fieldMatrix;
    if (!fm || !fm.groups || !fm.groups.length) {
      wrap.innerHTML = '<p class="status-line">字段矩阵数据不可用</p>';
      return;
    }
    var colCount = products.length;
    var thead = '<thead><tr><th class="col-attr">属性</th>' +
      products.map(function (p) {
        return '<th><span class="th-role">' + esc(p.roleLabel || '') + '</span>' +
          '<span class="th-asin">' + esc(p.asin || '') + '</span></th>';
      }).join('') + '</tr></thead>';

    var rows = fm.groups.map(function (g) {
      var groupRow = '<tr class="group-row"><th class="col-attr">' + esc(g.name || '') + '</th>' +
        '<td colspan="' + colCount + '"></td></tr>';
      var dataRows = (g.rows || []).map(function (row) {
        var cells = '';
        for (var i = 0; i < colCount; i++) {
          var v = (row.values || [])[i];
          cells += '<td>' + renderCell(row.type, v) + '</td>';
        }
        return '<tr><th class="col-attr">' + esc(row.label || '') + '</th>' + cells + '</tr>';
      }).join('');
      return groupRow + dataRows;
    }).join('');

    wrap.innerHTML = '<table class="matrix">' + thead + '<tbody>' + rows + '</tbody></table>';
  }

  function renderConclusion(d) {
    var el = $('#conclusion-block');
    var ca = d.crossAnalysis;
    if (!ca || (isEmpty(ca.summary) && isEmpty(ca.actions))) {
      el.innerHTML = '<p class="status-line">跨产品综合分析不可用(LLM 分析未产出)</p>';
      return;
    }
    el.innerHTML =
      (isEmpty(ca.summary) ? '' : '<p class="conclusion-summary">' + esc(ca.summary) + '</p>') +
      (isEmpty(ca.actions) ? '' :
        '<ol class="conclusion-actions">' + ca.actions.map(function (a) {
          return '<li>' + esc(a) + '</li>';
        }).join('') + '</ol>');
  }

  function renderSop(d) {
    var wrap = $('#sop-wrap');
    var sop = d.sopMatrix;
    if (!sop || !sop.length) {
      wrap.innerHTML = '<p class="status-line">SOP 定义数据不可用</p>';
      return;
    }
    var lastCat = null;
    var rows = sop.map(function (r) {
      var isFirst = r.category !== lastCat;
      lastCat = r.category;
      return '<tr' + (isFirst ? ' class="sop-cat-first"' : '') + '>' +
        '<td class="sop-cat">' + (isFirst ? esc(r.category || '') : '') + '</td>' +
        '<td class="sop-attr">' + esc(r.attr || '') + '</td>' +
        '<td class="sop-def">' + (isEmpty(r.sop) ? '—' : esc(r.sop)) + '</td></tr>';
    }).join('');
    wrap.innerHTML = '<table class="sop"><thead><tr><th>类别</th><th>属性</th><th>SOP</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function renderFooter(d) {
    $('#board-footer').innerHTML =
      'runId:' + esc(d.runId || '—') + ' · 站点:' + esc(d.market || '—') +
      ' · 生成时间:' + esc(fmtDateTime(d.createdAt) || '—') + '<br>' +
      '数据源:卖家精灵-查竞品 / 亚马逊前台-商品详情 / 亚马逊-商品评论(经 LinkFox Agent)· 分析:' +
      esc(d.llmModel || 'LLM') +
      ' · 取不到的数据均如实标注,不做编造';
  }

  function renderDashboard(d) {
    state.dashboard = d;
    if (d.title) $('#board-title').textContent = d.title;
    renderOverview(d);
    renderAnalysis(d);
    renderVoc(d);
    renderReviews(d);
    renderMatrix(d);
    renderConclusion(d);
    renderSop(d);
    renderFooter(d);
    $('#empty-state').classList.add('hidden');
    $('#dashboard-root').classList.remove('hidden');
    if (window.BoardMotion) window.BoardMotion.onDashboardRendered(d);
  }

  /* ---------------- 运行控制:发起 / 轮询 / 历史 ---------------- */

  function showError(msg) {
    var el = $('#error-banner');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function clearError() {
    $('#error-banner').classList.add('hidden');
  }

  function setProgress(status) {
    $('#progress-panel').classList.remove('hidden');
    var pct = Math.max(0, Math.min(100, Number(status.progress) || 0));
    if (window.BoardMotion) {
      window.BoardMotion.onProgress(pct, status.status);
    } else {
      $('#progress-bar').style.width = pct + '%';
    }
    $('#progress-pct').textContent = pct + '%';
    var label = status.stageLabel || STAGE_LABELS[status.stage] || status.stage || '执行中';
    if (status.status === 'done') label = '分析完成';
    if (status.status === 'error') label = '分析失败';
    $('#progress-stage').textContent = label;
    var logs = (status.logs || []).map(function (l) {
      var ts = l.ts ? String(l.ts) : '';
      var hhmmss = ts.length >= 19 ? ts.slice(11, 19) : ts;
      return (hhmmss ? '[' + hhmmss + '] ' : '') + (l.msg || '');
    }).join('\n');
    var logEl = $('#progress-logs');
    if (logs !== logEl.textContent) {
      logEl.textContent = logs;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function pollRun(runId) {
    stopPolling();
    state.currentRunId = runId;
    $('#progress-panel').classList.remove('hidden');
    $('#btn-start').disabled = true;

    function tick() {
      apiFetch(apiPath('api/runs/' + encodeURIComponent(runId) + '/status'))
        .then(function (st) {
          setProgress(st);
          if (st.status === 'done') {
            stopPolling();
            $('#btn-start').disabled = false;
            loadDashboard(runId);
            refreshRuns(false);
          } else if (st.status === 'error') {
            stopPolling();
            $('#btn-start').disabled = false;
            showError('分析失败:' + (st.error || '未知错误'));
            refreshRuns(false);
          }
        })
        .catch(function (err) {
          stopPolling();
          $('#btn-start').disabled = false;
          showError('轮询运行状态失败:' + err.message);
        });
    }
    tick();
    state.pollTimer = setInterval(tick, POLL_INTERVAL);
  }

  function loadDashboard(runId) {
    return apiFetch(apiPath('api/runs/' + encodeURIComponent(runId) + '/dashboard'))
      .then(function (d) {
        clearError();
        renderDashboard(d);
        var sel = $('#sel-history');
        if (sel.value !== runId) sel.value = runId;
      })
      .catch(function (err) {
        showError('加载看板数据失败(' + runId + '):' + err.message);
      });
  }

  function refreshRuns(autoload) {
    return apiFetch(apiPath('api/runs'))
      .then(function (runs) {
        runs = Array.isArray(runs) ? runs : [];
        var sel = $('#sel-history');
        var current = sel.value;
        sel.innerHTML = '<option value="">— 选择历史运行 —</option>' +
          runs.map(function (r) {
            var label = r.runId + ' · ' + (r.market || '') + ' · ' + (r.myAsin || '') +
              ' · ' + (r.status === 'done' ? '已完成' : r.status === 'error' ? '失败' : '进行中');
            return '<option value="' + esc(r.runId) + '">' + esc(label) + '</option>';
          }).join('');
        if (current) sel.value = current;

        if (autoload) {
          var latestDone = runs.filter(function (r) { return r.status === 'done'; })[0];
          var latestRunning = runs.filter(function (r) { return r.status === 'running'; })[0];
          if (latestDone) {
            loadDashboard(latestDone.runId);
          }
          if (latestRunning) {
            pollRun(latestRunning.runId);
          }
        }
        return runs;
      })
      .catch(function (err) {
        if (autoload) {
          $('#empty-state').innerHTML =
            '<p>无法连接后端服务(' + esc(err.message) + ')。请先启动后端:<code>powershell -File run.ps1</code>,' +
            '再访问 <code>http://127.0.0.1:8916/</code>。</p>' +
            '<p class="empty-hint">无后端时可在地址栏加 <code>?dev=1</code> 加载开发样例预览页面结构。</p>';
        }
      });
  }

  function startRun(ev) {
    ev.preventDefault();
    clearError();
    var market = $('#inp-market').value;
    var myAsin = $('#inp-my').value.trim().toUpperCase();
    var comps = [$('#inp-c1').value, $('#inp-c2').value, $('#inp-c3').value]
      .map(function (v) { return v.trim().toUpperCase(); })
      .filter(function (v) { return v !== ''; });

    var asinRe = /^[A-Z0-9]{10}$/;
    if (!asinRe.test(myAsin)) {
      showError('请填写有效的我司 ASIN(10 位字母数字,如 B0FY5PZCXQ)');
      return;
    }
    var badComp = comps.filter(function (a) { return !asinRe.test(a); });
    if (badComp.length) {
      showError('竞品 ASIN 格式无效:' + badComp.join(', '));
      return;
    }

    $('#btn-start').disabled = true;
    $('#progress-panel').classList.remove('hidden');
    $('#progress-stage').textContent = '提交任务中…';
    $('#progress-bar').style.width = '0%';
    $('#progress-pct').textContent = '0%';
    $('#progress-logs').textContent = '';

    apiFetch(apiPath('api/runs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market: market,
        myAsin: myAsin,
        competitorAsins: comps,
        reviewsPerStar: 20,
        useCache: $('#inp-cache').checked
      })
    })
      .then(function (resp) {
        if (!resp.runId) throw new Error('后端未返回 runId');
        refreshRuns(false);
        pollRun(resp.runId);
      })
      .catch(function (err) {
        $('#btn-start').disabled = false;
        showError('发起分析失败:' + err.message);
      });
  }

  /* ---------------- 锚点导航高亮 ---------------- */

  function setupScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.anchor-nav a'));
    var ids = links.map(function (a) { return a.getAttribute('data-sec'); });
    function onScroll() {
      var activeId = ids[0];
      for (var i = 0; i < ids.length; i++) {
        var sec = document.getElementById(ids[i]);
        if (!sec || sec.offsetParent === null) continue;
        if (sec.getBoundingClientRect().top <= 120) activeId = ids[i];
      }
      links.forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('data-sec') === activeId);
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    $('#run-form').addEventListener('submit', startRun);

    $('#sel-history').addEventListener('change', function () {
      var runId = this.value;
      if (!runId) return;
      stopPolling();
      clearError();
      apiFetch(apiPath('api/runs/' + encodeURIComponent(runId) + '/status'))
        .then(function (st) {
          if (st.status === 'done') {
            $('#progress-panel').classList.add('hidden');
            loadDashboard(runId);
          } else if (st.status === 'running') {
            pollRun(runId);
          } else {
            setProgress(st);
            showError('该运行已失败:' + (st.error || '未知错误'));
          }
        })
        .catch(function (err) { showError('读取运行状态失败:' + err.message); });
    });

    /* Review 展开全部(事件委托) */
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-more');
      if (!btn) return;
      var target = document.getElementById(btn.getAttribute('data-target'));
      if (!target) return;
      var nowHidden = target.classList.toggle('hidden');
      btn.textContent = nowHidden
        ? btn.textContent.replace('收起', '展开全部')
        : btn.textContent.replace('展开全部', '收起');
      if (!nowHidden && window.BoardMotion) window.BoardMotion.onReviewReveal(target);
    });

    setupScrollSpy();

    if (DEV) {
      $('#dev-banner').classList.remove('hidden');
      fetch('sample-dashboard.json')
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(renderDashboard)
        .catch(function (err) {
          showError('加载 sample-dashboard.json 失败:' + err.message +
            '(请通过 http 服务访问,而非 file:// 直接打开)');
        });
    } else {
      refreshRuns(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
