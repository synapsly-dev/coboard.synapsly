# -*- coding: utf-8 -*-
"""编排:拉取(线程并行+缓存)→ LLM 分析 → 组装 dashboard.json。

- 三类拉取任务并行(线程);评论任务每 ASIN 一个,先全部提交再统一轮询。
- 每个原始工具结果写 data/runs/<runId>/raw/<key>.json,成功的同时写 data/cache/<key>.json;
  useCache=true 时命中缓存直接复用(LinkFox 按任务计费,积分昂贵)。
- 单数据源失败不炸整个 run:对应块置 null/unavailable + note,继续走完。
- rebuild:用已缓存原始数据重跑 LLM + 组装,不再花 LinkFox 积分。
"""
import datetime as _dt
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from . import analysis, datasources as ds, linkfox_client as lf, store
from .config import AMAZON_BASE

ROLE_LABELS = ["我司产品", "直接竞对1", "直接竞对2", "直接竞对3"]


# ================================================================ in-flight 幂等登记
# HIGH-1:并发同参请求不得重复提交 LinkFox 计费任务 —— 进程内维护
# 「归一化参数键(market + 排序后全 ASIN 集合)→ running 中的 runId」登记表;
# MED-2:rebuild 复用同一把锁做原子 compare-and-set,消除 TOCTOU 双跑。
_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT_BY_PARAMS: dict = {}  # paramKey -> run_id(仍在 running 的 run)
_INFLIGHT_RUNS: set = set()     # 仍在 running 的 run_id(新 run + rebuild)


def _param_key(params: dict) -> str:
    market = (params.get("market") or "").strip().upper()
    asins = {params.get("myAsin")} | set(params.get("competitorAsins") or [])
    return f"{market}|{'-'.join(sorted(a for a in asins if a))}"


def _clear_inflight(run_id: str) -> None:
    """run 终态(done/error)时清除登记。"""
    with _INFLIGHT_LOCK:
        _INFLIGHT_RUNS.discard(run_id)
        for k in [k for k, v in _INFLIGHT_BY_PARAMS.items() if v == run_id]:
            _INFLIGHT_BY_PARAMS.pop(k, None)


def create_or_reuse_run(params: dict):
    """发起 run(进程内同参幂等)。返回 (run_id, reused)。

    锁内完成「查登记 → new_run_id → 落 status.json → 登记」,并发同参的
    第二个请求直接复用第一个的 runId(reused=True),不重复提交计费任务;
    new_run_id 的同秒冲突检测也因此被串行化。
    """
    key = _param_key(params)
    with _INFLIGHT_LOCK:
        existing = _INFLIGHT_BY_PARAMS.get(key)
        if existing:
            return existing, True
        run_id = store.new_run_id()
        store.RunStatus(run_id, params)  # 立即落 status.json 占住 run 目录
        _INFLIGHT_BY_PARAMS[key] = run_id
        _INFLIGHT_RUNS.add(run_id)
    try:
        start_run(run_id, params)
    except Exception:
        _clear_inflight(run_id)
        raise
    return run_id, False


def try_start_rebuild(run_id: str) -> bool:
    """MED-2:锁内原子 compare-and-set 后再起 rebuild 线程。

    锁内再次读 status:仍非 running 才标 running(restart)并登记;
    否则返回 False(调用方回 409)。rebuild 同样登记 paramKey,
    并发同参新 run 会复用 rebuild 中的 run,不重复计费。
    """
    with _INFLIGHT_LOCK:
        if run_id in _INFLIGHT_RUNS:
            return False
        st = store.read_json(store.status_path(run_id))
        if not isinstance(st, dict) or st.get("status") == "running":
            return False
        status = store.RunStatus(run_id)
        params = status.params()
        status.restart()  # 锁内标 running,关闭 TOCTOU 窗口
        _INFLIGHT_BY_PARAMS[_param_key(params)] = run_id
        _INFLIGHT_RUNS.add(run_id)
    try:
        start_rebuild(run_id)
    except Exception:
        _clear_inflight(run_id)
        raise
    return True


# ================================================================ run 入口
def start_run(run_id: str, params: dict) -> None:
    t = threading.Thread(target=execute_run, args=(run_id, params), daemon=True)
    t.start()


def start_rebuild(run_id: str) -> None:
    t = threading.Thread(target=execute_rebuild, args=(run_id,), daemon=True)
    t.start()


# ================================================================ 容错落盘
def _cache_result_safe(status: store.RunStatus, tool: str, key: str, raw: dict) -> None:
    """成功结果写 data/cache;失败/不可缓存时诚实记日志,不炸管线线程。"""
    if raw.get("status") == "finished" and ds.extract_json_result(raw) is not None:
        try:
            store.cache_put(key, raw)
            status.log(f"[{tool}] 结果已写缓存 {key}")
        except Exception as e:  # noqa: BLE001
            status.log(f"[{tool}] 警告:结果未能落缓存 {key}({e});"
                       "本次结果不可缓存,重跑将重新计费")
    elif raw.get("status") == "finished":
        status.log(f"[{tool}] 任务 finished 但未返回可解析的 JSON 结果,不写缓存;"
                   "本次结果不可缓存,重跑将再次计费")


def _save_raw_safe(status: store.RunStatus, tool: str, key: str, raw) -> None:
    """写 runs/<runId>/raw;失败只记日志(数据仍在内存中继续用于分析)。"""
    try:
        store.save_raw(status.run_id, key, raw)
    except Exception as e:  # noqa: BLE001
        status.log(f"[{tool}] 警告:raw/{key}.json 落盘失败({e}),"
                   "该原始结果仅保留在内存中继续分析")


# ================================================================ 拉取
def _fetch_source(status: store.RunStatus, tool: str, key: str, task_text: str,
                  use_cache: bool, results: dict, progress_tick) -> None:
    """拉取一个数据源(带缓存),原始响应放入 results[key]。"""
    raw = None
    if use_cache:
        cached = store.cache_get(key)
        if isinstance(cached, dict) and cached.get("status") == "finished" \
                and ds.extract_json_result(cached) is not None:
            status.log(f"[{tool}] 缓存命中 {key},复用缓存(不消耗 LinkFox 积分)")
            raw = cached
    if raw is None:
        status.log(f"[{tool}] 提交 LinkFox 任务: {task_text}")
        try:
            raw = lf.run_task(task_text, log=status.log)
        except lf.LinkfoxError as e:
            status.log(f"[{tool}] 任务失败: {e}")
            raw = {"status": "error", "error": str(e)}
        _cache_result_safe(status, tool, key, raw)
    _save_raw_safe(status, tool, key, raw)
    results[key] = raw
    progress_tick()


def _fetch_all(status: store.RunStatus, params: dict) -> dict:
    """并行拉取三类数据源,返回 {cacheKey: raw}。"""
    market = params["market"]
    my_asin = params["myAsin"]
    competitor_asins = list(params.get("competitorAsins") or [])
    all_asins = [my_asin] + competitor_asins
    per_star = params.get("reviewsPerStar") or 20
    use_cache = bool(params.get("useCache", True))

    results: dict = {}
    total_units = 2 + len(all_asins)  # 查竞品 + 详情 + 每 ASIN 评论
    done_units = {"n": 0}
    lock = threading.Lock()

    def progress_tick():
        with lock:
            done_units["n"] += 1
            # 拉取阶段占 5% ~ 55%
            status.set_progress(5 + int(50 * done_units["n"] / total_units))

    keys = {
        "competitor": ds.cache_key("competitor", market, all_asins),
        "detail": ds.cache_key("detail", market, all_asins),
        "reviews": {a: ds.cache_key("reviews", market, a) for a in all_asins},
    }

    threads = [
        threading.Thread(target=_fetch_source, daemon=True, args=(
            status, "查竞品", keys["competitor"],
            ds.competitor_task_text(market, all_asins), use_cache, results, progress_tick)),
        threading.Thread(target=_fetch_source, daemon=True, args=(
            status, "商品详情", keys["detail"],
            ds.detail_task_text(market, all_asins), use_cache, results, progress_tick)),
    ]

    def fetch_reviews_group():
        # 先检查缓存;未命中的先全部提交,再统一并行轮询
        pending = []  # (asin, key, messageId)
        for asin in all_asins:
            key = keys["reviews"][asin]
            if use_cache:
                cached = store.cache_get(key)
                if isinstance(cached, dict) and cached.get("status") == "finished" \
                        and ds.extract_json_result(cached) is not None:
                    status.log(f"[评论 {asin}] 缓存命中 {key},复用缓存")
                    _save_raw_safe(status, f"评论 {asin}", key, cached)
                    results[key] = cached
                    progress_tick()
                    continue
            try:
                mid = lf.submit(ds.reviews_task_text(market, asin, per_star), log=status.log)
                status.log(f"[评论 {asin}] 已提交任务 messageId={mid}")
                pending.append((asin, key, mid))
            except lf.LinkfoxError as e:
                status.log(f"[评论 {asin}] 提交失败: {e}")
                raw = {"status": "error", "error": str(e)}
                _save_raw_safe(status, f"评论 {asin}", key, raw)
                results[key] = raw
                progress_tick()

        def poll_one(item):
            asin, key, mid = item
            raw = lf.poll(mid, log=status.log)
            _cache_result_safe(status, f"评论 {asin}", key, raw)
            _save_raw_safe(status, f"评论 {asin}", key, raw)
            results[key] = raw
            progress_tick()

        if pending:
            with ThreadPoolExecutor(max_workers=len(pending)) as pool:
                list(pool.map(poll_one, pending))

    threads.append(threading.Thread(target=fetch_reviews_group, daemon=True))

    status.set_stage("fetch_competitor", 5)
    for t in threads:
        t.start()
    # 阶段标签按完成顺序推进(粗粒度展示)
    threads[0].join()
    status.set_stage("fetch_detail")
    threads[1].join()
    status.set_stage("fetch_reviews")
    threads[2].join()

    results["_keys"] = keys
    return results


# ================================================================ LLM 分析
def _run_llm(status: store.RunStatus, products: list, notes: list) -> Optional[dict]:
    """对 products(已含 metrics/detail/reviews)就地填 analysis,返回 crossAnalysis。"""
    status.set_stage("llm_analysis", 58)
    n = len(products)
    total_calls = 2 * n + 1
    done = {"n": 0}
    lock = threading.Lock()

    def tick():
        with lock:
            done["n"] += 1
            status.set_progress(58 + int(32 * done["n"] / total_calls))

    def listing_ctx(p):
        m = p.get("metrics") or {}
        return {
            "price": m.get("price"), "averagePrice": m.get("averagePrice"),
            "monthlySalesUnits": m.get("monthlySalesUnits"),
            "monthlySalesRevenue": m.get("monthlySalesRevenue"),
            "bsr": m.get("bsr"), "subCategory": m.get("subCategory"),
            "subBsr": m.get("subBsr"), "rating": m.get("rating"),
            "ratings": m.get("ratings"),
            "monthlySalesUnitsGrowthRate": m.get("monthlySalesUnitsGrowthRate"),
            "bsrGrowthRate": m.get("bsrGrowthRate"),
            "badges": m.get("badges"), "fulfillment": m.get("fulfillment"),
            "variationNum": m.get("variationNum"),
            "availableDate": m.get("availableDate"),
        }

    def do_listing(p):
        asin = p["asin"]
        detail = p.get("detail") or {}
        bullets = detail.get("bullets") or []
        title = p.get("title")
        status.log(f"[{asin}] LLM 标题五点分析(Rufus/Alexa 视角)…")
        res = analysis.analyze_listing(asin, p["roleLabel"], title, bullets,
                                       listing_ctx(p), log=status.log)
        tick()
        if res is None:
            notes.append(f"{p['roleLabel']} {asin}:标题五点 LLM 分析失败,已置空(不编造)")
            p["analysis"]["titleAnalysis"] = None
            p["analysis"]["bulletsAnalysis"] = None
            p["analysis"]["strategy"] = None
        else:
            p["analysis"]["titleAnalysis"] = res.get("titleAnalysis")
            p["analysis"]["bulletsAnalysis"] = res.get("bulletsAnalysis")
            p["analysis"]["strategy"] = res.get("strategy")
            status.log(f"[{asin}] 标题五点分析完成")

    def do_voc(p):
        asin = p["asin"]
        reviews = p.get("reviews") or {}
        if reviews.get("status") != "ok" or not reviews.get("items"):
            note = reviews.get("note") or "无评论数据,无法做 VOC 聚类"
            p["analysis"]["voc"] = {"status": "unavailable", "note": note,
                                    "positiveTop": [], "negativeTop": [], "unmetNeeds": []}
            tick()
            return
        status.log(f"[{asin}] LLM VOC 聚类({reviews['count']} 条真实评论)…")
        res = analysis.analyze_voc(asin, reviews["items"], log=status.log)
        tick()
        if res is None:
            p["analysis"]["voc"] = {"status": "unavailable",
                                    "note": "VOC LLM 分析失败,已置空(不编造)",
                                    "positiveTop": [], "negativeTop": [], "unmetNeeds": []}
            notes.append(f"{p['roleLabel']} {asin}:VOC LLM 分析失败")
        else:
            p["analysis"]["voc"] = {"status": "ok", "note": "",
                                    "positiveTop": res.get("positiveTop") or [],
                                    "negativeTop": res.get("negativeTop") or [],
                                    "unmetNeeds": res.get("unmetNeeds") or []}
            status.log(f"[{asin}] VOC 聚类完成")

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = []
        for p in products:
            futures.append(pool.submit(do_listing, p))
            futures.append(pool.submit(do_voc, p))
        for f in futures:
            f.result()

    # 跨产品综合
    summary_input = []
    for p in products:
        m = p.get("metrics") or {}
        voc = (p.get("analysis") or {}).get("voc") or {}
        summary_input.append({
            "role": p["roleLabel"], "asin": p["asin"], "brand": p.get("brand"),
            "price": m.get("price"), "averagePrice": m.get("averagePrice"),
            "monthlySalesUnits": m.get("monthlySalesUnits"),
            "monthlySalesRevenue": m.get("monthlySalesRevenue"),
            "bsr": m.get("bsr"), "subCategory": m.get("subCategory"),
            "subBsr": m.get("subBsr"),
            "rating": m.get("rating"), "ratings": m.get("ratings"),
            "monthlySalesUnitsGrowthRate": m.get("monthlySalesUnitsGrowthRate"),
            "bsrGrowthRate": m.get("bsrGrowthRate"),
            "badges": m.get("badges"),
            "fulfillment": m.get("fulfillment"),
            "availableDate": m.get("availableDate"),
            "vocPositive": [x.get("point") for x in (voc.get("positiveTop") or [])],
            "vocNegative": [x.get("point") for x in (voc.get("negativeTop") or [])],
            "strategy": (p.get("analysis") or {}).get("strategy"),
        })
    status.log("LLM 跨产品综合分析…")
    cross = analysis.analyze_cross(summary_input, log=status.log)
    tick()
    if cross is None:
        notes.append("跨产品综合 LLM 分析失败,crossAnalysis 置空(不编造)")
        status.log("跨产品综合分析失败,置空")
    else:
        status.log("跨产品综合分析完成")
    return cross


# ================================================================ 组装
def _fmt_int(v) -> Optional[str]:
    try:
        return f"{int(v):,}"
    except (TypeError, ValueError):
        return None


def _build_products(params: dict, comp_map: dict, detail_map: dict,
                    reviews_map: dict, notes: list) -> list:
    """按契约 §6 组装 products 数组(我司在前,竞品按输入顺序)。"""
    all_asins = [params["myAsin"]] + list(params.get("competitorAsins") or [])
    products = []
    for i, asin in enumerate(all_asins):
        comp = comp_map.get(asin) or {}
        det = detail_map.get(asin) or {}
        metrics = comp.get("metrics") or {k: None for k in (
            "monthlySalesUnits", "monthlySalesRevenue", "bsrCategory", "bsr",
            "subCategory", "subBsr", "price", "averagePrice", "profit", "fba",
            "rating", "ratings", "ratingsRate", "ratingsGrowth",
            "monthlySalesUnitsGrowthRate", "bsrGrowthRate", "variationNum",
            "parentAsin", "availableDate", "fulfillment", "sellerName",
            "sellerId", "sellerNation", "sellerUrl", "listingQualityScore",
            "weight", "dimension", "packageDimensions", "packageWeight",
            "sku", "nodeLabelPath", "badges")}
        detail_block = det.get("detail")
        reviews = reviews_map.get(asin) or {
            "status": "unavailable", "note": "评论数据源缺失",
            "count": 0, "lowStarCount": 0, "items": []}
        products.append({
            "asin": asin,
            "role": "my" if i == 0 else "competitor",
            "roleLabel": ROLE_LABELS[i] if i < len(ROLE_LABELS) else f"直接竞对{i}",
            "brand": comp.get("brand") or det.get("brand"),
            "title": det.get("title") or comp.get("title"),
            "imageUrl": det.get("imageUrl") or comp.get("imageUrl"),
            "productUrl": det.get("productUrl") or f"{AMAZON_BASE}/dp/{asin}",
            "brandUrl": comp.get("brandUrl"),
            "videoUrl": (detail_block or {}).get("videoUrl"),
            "metrics": metrics,
            "detail": detail_block,
            "reviews": reviews,
            "analysis": {"titleAnalysis": None, "bulletsAnalysis": None,
                         "voc": None, "strategy": None},
        })
        if not comp:
            notes.append(f"{products[-1]['roleLabel']} {asin}:查竞品数据缺失,市场指标为空")
        if not det:
            notes.append(f"{products[-1]['roleLabel']} {asin}:商品详情数据缺失,detail 为空")
    return products


def _badge_val(badges: Optional[dict], key: str) -> Optional[str]:
    if not isinstance(badges, dict):
        return None
    return badges.get(key)


def _build_field_matrix(products: list) -> dict:
    """长对比表:行分组严格按契约 §6 的 8 组顺序;values 与 products 对齐。"""
    def vals(fn):
        return [fn(p) for p in products]

    def m(p, key):
        return (p.get("metrics") or {}).get(key)

    def d(p, key):
        return (p.get("detail") or {}).get(key) if p.get("detail") else None

    def row(label, rtype, fn):
        return {"label": label, "type": rtype, "values": vals(fn)}

    def variation_sku(p):
        vn, sku = m(p, "variationNum"), m(p, "sku")
        if vn is None and not sku:
            return None
        parts = [str(vn) if vn is not None else "?"]
        if sku:
            parts.append(str(sku))
        return " | ".join(parts)

    def big_bsr(p):
        cat, bsr = m(p, "bsrCategory"), m(p, "bsr")
        if bsr is None:
            return None
        return f"{cat or '大类'} #{_fmt_int(bsr)}"

    def sub_bsr(p):
        cat, r = m(p, "subCategory"), m(p, "subBsr")
        if r is None:
            return None
        return f"{cat or '小类'} #{_fmt_int(r)}"

    def profit_fba(p):
        profit, fba = m(p, "profit"), m(p, "fba")
        if profit is None and fba is None:
            return None
        pt = f"利润 ${profit}" if profit is not None else "利润 —"
        ft = f"FBA ${fba}" if fba is not None else "FBA —"
        return f"{pt} / {ft}"

    def bs_ac(p):
        badges = m(p, "badges")
        if not isinstance(badges, dict):
            return None
        parts = []
        bs = badges.get("bestSeller")
        ac = badges.get("amazonChoice")
        if bs and bs != "N":
            parts.append("BS")
        if ac and ac != "N":
            parts.append("AC")
        return "+".join(parts) if parts else "N"

    def badge_summary(p):
        badges = m(p, "badges")
        if not isinstance(badges, dict):
            return "无 badge 数据"
        mapping = [("bestSeller", "BS"), ("amazonChoice", "AC"),
                   ("newRelease", "NR"), ("ebc", "A+"), ("video", "视频")]
        on = [label for key, label in mapping
              if badges.get(key) and badges.get(key) != "N"]
        return " | ".join(on) if on else "无标识"

    def bullets_text(p):
        bullets = d(p, "bullets") or []
        if not bullets:
            return None
        return "\n".join(f"• {b}" for b in bullets)

    def analysis_summary(p):
        a = p.get("analysis") or {}
        ta, ba = a.get("titleAnalysis") or {}, a.get("bulletsAnalysis") or {}
        parts = []
        if ta.get("advice"):
            parts.append(f"【标题】{ta['advice']}")
        if ba.get("advice"):
            parts.append(f"【五点】{ba['advice']}")
        return "\n".join(parts) or None

    def voc_points(p, key):
        voc = (p.get("analysis") or {}).get("voc") or {}
        if voc.get("status") != "ok":
            return voc.get("note") or "暂无 VOC 数据"
        pts = voc.get(key) or []
        if not pts:
            return "评论中未聚出该类要点"
        return "\n".join(f"{i}. {x.get('point')}" for i, x in enumerate(pts, 1))

    def deal_text(p):
        modules = (d(p, "modules") or {})
        return modules.get("deal")

    def bought_imgs(p):
        items = d(p, "boughtTogether") or []
        imgs = [x.get("imageUrl") for x in items if x.get("imageUrl")]
        return imgs or None

    def recommended_imgs(p):
        items = d(p, "recommended") or []
        imgs = [x.get("imageUrl") for x in items if x.get("imageUrl")]
        return imgs or None

    groups = []

    # 1. 链接基本信息
    groups.append({"name": "链接基本信息", "rows": [
        row("产品图片", "image", lambda p: p.get("imageUrl")),
        row("产品链接", "link", lambda p: p.get("productUrl")),
        row("品牌", "text", lambda p: p.get("brand")),
        row("ASIN", "text", lambda p: p.get("asin")),
        row("变体数(+SKU)", "text", variation_sku),
        row("评论数", "number", lambda p: m(p, "ratings")),
        row("星级", "number", lambda p: m(p, "rating")),
        row("上架时间", "text", lambda p: m(p, "availableDate")),
        row("卖家(店铺)名称", "text", lambda p: m(p, "sellerName")),
        row("店铺链接", "link", lambda p: p.get("brandUrl")),
        row("卖家链接", "link", lambda p: m(p, "sellerUrl")),
    ]})

    # 2. 市场表现
    groups.append({"name": "市场表现", "rows": [
        row("售价", "money", lambda p: m(p, "price")),
        row("成交价(近30天均价代理)", "money", lambda p: m(p, "averagePrice")),
        row("大类BSR", "text", big_bsr),
        row("小类BSR", "text", sub_bsr),
        row("月销量", "number", lambda p: m(p, "monthlySalesUnits")),
        row("月销售额", "money", lambda p: m(p, "monthlySalesRevenue")),
        row("月销量增长率", "percent", lambda p: m(p, "monthlySalesUnitsGrowthRate")),
        row("BSR增长率", "percent", lambda p: m(p, "bsrGrowthRate")),
        row("留评率", "percent", lambda p: m(p, "ratingsRate")),
        row("利润/FBA费", "text", profit_fba),
        row("Listing质量分", "number", lambda p: m(p, "listingQualityScore")),
    ]})

    # 3. 产品与物流
    groups.append({"name": "产品与物流", "rows": [
        row("类目路径", "text", lambda p: m(p, "nodeLabelPath")),
        row("商品尺寸", "text", lambda p: m(p, "dimension")),
        row("重量", "text", lambda p: m(p, "weight")),
        row("包装尺寸", "text", lambda p: m(p, "packageDimensions")),
        row("包装重量", "text", lambda p: m(p, "packageWeight")),
        row("配送方式", "text", lambda p: m(p, "fulfillment")),
        row("变体数", "number", lambda p: m(p, "variationNum")),
    ]})

    # 4. 前台模块状态
    any_deal = any(deal_text(p) for p in products)
    groups.append({"name": "前台模块状态", "rows": [
        row("A+页面", "badge", lambda p: _badge_val(m(p, "badges"), "ebc")),
        row("视频", "badge", lambda p: _badge_val(m(p, "badges"), "video")),
        row("Coupon", "status",
            lambda p: "详情接口未返回Coupon字段,需前台/Keepa复核" if p.get("detail") else "详情数据缺失"),
        (row("Deal", "text", deal_text) if any_deal
         else row("Deal", "status", lambda p: "未见划线价/折扣信息,LD/BD需Keepa接口确认")),
        row("BS/AC标", "badge", bs_ac),
        row("Badge", "status", badge_summary),
    ]})

    # 5. 五点与卖点
    groups.append({"name": "五点与卖点", "rows": [
        row("五点描述原文", "text", bullets_text),
        row("标题/五点分析摘要", "text", analysis_summary),
    ]})

    # 6. VOC
    groups.append({"name": "VOC", "rows": [
        row("好评点top3", "text", lambda p: voc_points(p, "positiveTop")),
        row("差评点top3", "text", lambda p: voc_points(p, "negativeTop")),
        row("未被满足需求", "text", lambda p: voc_points(p, "unmetNeeds")),
    ]})

    # 7. 媒体与推荐
    any_recommended = any(recommended_imgs(p) for p in products)
    groups.append({"name": "媒体与推荐", "rows": [
        row("套图", "images", lambda p: d(p, "images") or None),
        row("视频入口", "link", lambda p: p.get("videoUrl")),
        (row("Amazon推荐商品", "images", recommended_imgs) if any_recommended
         else row("Amazon推荐商品", "status",
                  lambda p: "详情任务已请求relatedProducts,本次接口未返回相关商品列表")),
        row("经常一起购买", "images", bought_imgs),
    ]})

    # 8. 策略
    groups.append({"name": "策略", "rows": [
        row("策略建议", "text", lambda p: (p.get("analysis") or {}).get("strategy")),
    ]})

    return {"groups": groups}


def _build_sop_matrix() -> list:
    """静态 SOP 定义表(类别/属性/SOP 说明),口径对齐示例图。"""
    sop = [
        ("链接基本信息", "产品图片", "取亚马逊前台主图(详情工具productImageUrls[0],查竞品imageUrl兜底);Excel内嵌缩略图,HTML可点击打开大图。"),
        ("链接基本信息", "产品链接", "https://www.amazon.com/dp/{ASIN} 标准链接直达商品页。"),
        ("链接基本信息", "品牌", "卖家精灵查竞品 brand 字段;与前台 Byline(Visit the X Store)交叉核对。"),
        ("链接基本信息", "ASIN", "用户输入;所有数据源以 ASIN 对齐拼接。"),
        ("链接基本信息", "变体数(+SKU)", "变体数来自卖家精灵(variationNum);SKU为当前子体选项组合(sku),变体全貌看前台variants。"),
        ("链接基本信息", "评论数", "卖家精灵 ratings(评分数);与前台评论区 countRatings 交叉验证。"),
        ("链接基本信息", "星级", "卖家精灵 rating(1-5星)。"),
        ("链接基本信息", "上架时间", "卖家精灵 availableDate;判断新品期/成熟期。"),
        ("链接基本信息", "卖家(店铺)名称", "卖家精灵 BuyBox 卖家(sellerName);卖家精灵给出公司主体;天眼查/企查查仅适用于中国主体进一步验证。"),
        ("链接基本信息", "店铺链接", "品牌旗舰店链接来自查竞品 brandUrl(相对路径拼 https://www.amazon.com 前缀)。"),
        ("链接基本信息", "卖家链接", "由 sellerId 拼 https://www.amazon.com/sp?seller={sellerId},直达卖家主页。"),
        ("市场表现", "售价", "前台当前 BuyBox 价格(卖家精灵 price)。"),
        ("市场表现", "成交价(近30天均价代理)", "成交价:用卖家精灵averagePrice作为近30天成交均价代理(非亚马逊官方口径,促销期间与售价差即让利幅度)。"),
        ("市场表现", "大类BSR", "卖家精灵 bsr + 类目路径首段;反映大盘流量位。"),
        ("市场表现", "小类BSR", "卖家精灵 subcategories[0].rank;同小类直接竞争位次,比大类BSR更可比。"),
        ("市场表现", "月销量", "卖家精灵月销量(monthlySalesUnits),估算值;与前台『x bought in past month』互证。"),
        ("市场表现", "月销售额", "卖家精灵月销售额(monthlySalesRevenue),估算值。"),
        ("市场表现", "月销量增长率", "卖家精灵环比增长率(%);正=放量,负=下滑。"),
        ("市场表现", "BSR增长率", "BSR环比变化(%);负=排名上升(变好),正=排名下滑。"),
        ("市场表现", "留评率", "卖家精灵 ratingsRate(%)=评论数/销量;显著高于类目均值需警惕测评。"),
        ("市场表现", "利润/FBA费", "卖家精灵利润(profit)与FBA运费(fba)估算值,用于毛利空间对比;精确核算需自建成本表。"),
        ("市场表现", "Listing质量分", "卖家精灵 listingQualityScore(0-100),Listing完整度量化参考。"),
        ("产品与物流", "类目路径", "卖家精灵 nodeLabelPath 全路径;先确认类目一致再比BSR。"),
        ("产品与物流", "商品尺寸", "卖家精灵 dimension(商品本体尺寸)。"),
        ("产品与物流", "重量", "卖家精灵 weight(商品本体重量)。"),
        ("产品与物流", "包装尺寸", "卖家精灵 packageDimensions;测算头程运费/FBA仓储费的输入;缺失即上游未收录,不推断。"),
        ("产品与物流", "包装重量", "卖家精灵 packageWeight;同上。"),
        ("产品与物流", "配送方式", "卖家精灵 fulfillment(AMZ/FBA/FBM);影响Prime标与转化。"),
        ("产品与物流", "变体数", "变体数来自卖家精灵;结合前台 variants 选项(颜色/尺寸/件数)核对。"),
        ("前台模块状态", "A+页面", "卖家精灵 badge.ebc(Y/N)与前台A+内容(productDescription非空)双重确认。"),
        ("前台模块状态", "视频", "卖家精灵 badge.video(Y/N);本次前台接口未返回视频URL,故只标注有无、不给链接,不编造。"),
        ("前台模块状态", "Coupon", "本次前台详情接口未返回Coupon字段;需人工前台复核或Keepa接口确认。"),
        ("前台模块状态", "Deal", "以前台划线价(oldPrice)与折扣(discount)作为促销代理;LD/BD 需Keepa接口确认。"),
        ("前台模块状态", "BS/AC标", "卖家精灵 badge.bestSeller / badge.amazonChoice;AC标是搜索词强相关流量信号。"),
        ("前台模块状态", "Badge", "badge 对象(BS/AC/NR/A+/视频)原样透传,诚实标注,不做推断。"),
        ("五点与卖点", "五点描述原文", "前台详情 aboutItemFivePoint 原文完整呈现,不做改写。"),
        ("五点与卖点", "标题/五点分析摘要", "LLM按亚马逊AI导购(Rufus/Alexa)视角评估:类型词前置、场景清晰度、尺寸/承重/安装/充电等AI可引用信息完整度;输出优缺点+前80字符标题改写建议。"),
        ("VOC", "好评点top3", "LLM对真实评论聚类,按提及频次取top3;每条要点必须附评论原文摘录作为证据,程序校验摘录为原文子串,非原文剔除。"),
        ("VOC", "差评点top3", "同上,差评(≤3星)优先;直接指向改进机会。"),
        ("VOC", "未被满足需求", "从评论中的期望/抱怨/改进愿望提炼;无证据不输出,评论不足时可为空。"),
        ("媒体与推荐", "套图", "前台 productImageUrls 全套图,对比竞品视觉表达(场景图/尺寸图/细节图配比)。"),
        ("媒体与推荐", "视频入口", "前台如返回视频URL则给可点链接;本次接口未返回,置空不编造。"),
        ("媒体与推荐", "Amazon推荐商品", "详情任务已请求relatedProducts=true;本次接口未返回相关商品列表,如需请前台人工复核。"),
        ("媒体与推荐", "经常一起购买", "前台 boughtTogether 模块;判断连带购买/捆绑销售机会(首条通常为本品)。"),
        ("策略", "策略建议", "LLM综合市场数据+VOC输出;我司侧重差异化与转化修复,竞品侧重可借鉴打法;结论仅供决策参考。"),
    ]
    return [{"category": c, "attr": a, "sop": s} for c, a, s in sop]


def _assemble(run_id: str, params: dict, products: list,
              cross: Optional[dict], notes: list) -> dict:
    sub_cat = None
    for p in products:
        sub_cat = (p.get("metrics") or {}).get("subCategory")
        if sub_cat:
            break
    title = f"{sub_cat} 竞品分析看板" if sub_cat else "竞品分析看板"
    return {
        "runId": run_id,
        "market": params["market"],
        "createdAt": _dt.datetime.now().isoformat(timespec="seconds"),
        "myAsin": params["myAsin"],
        "title": title,
        "llmModel": os.environ.get("LLM_MODEL") or None,
        "notes": notes,
        "products": products,
        "crossAnalysis": cross,
        "fieldMatrix": _build_field_matrix(products),
        "sopMatrix": _build_sop_matrix(),
    }


# ================================================================ 主流程
def _parse_sources(status: store.RunStatus, params: dict, raws: dict, keys: dict,
                   notes: list):
    """解析三类原始结果 → (comp_map, detail_map, reviews_map)。"""
    all_asins = [params["myAsin"]] + list(params.get("competitorAsins") or [])

    comp_raw = raws.get(keys["competitor"])
    comp_map = ds.parse_competitor(comp_raw)
    if not comp_map:
        err = (comp_raw or {}).get("error") or (comp_raw or {}).get("status")
        notes.append(f"查竞品数据源失败({err}),全部市场指标为空")
        status.log(f"查竞品解析为空: {err}")
    else:
        status.log(f"查竞品解析成功: {len(comp_map)} 个 ASIN")

    detail_raw = raws.get(keys["detail"])
    detail_map = ds.parse_detail(detail_raw)
    if not detail_map:
        err = (detail_raw or {}).get("error") or (detail_raw or {}).get("status")
        notes.append(f"商品详情数据源失败({err}),detail 块为空")
        status.log(f"商品详情解析为空: {err}")
    else:
        status.log(f"商品详情解析成功: {len(detail_map)} 个 ASIN")
        if not any((v.get("detail") or {}).get("recommended") for v in detail_map.values()):
            notes.append("详情任务已请求relatedProducts=true,但本次接口未返回相关商品列表(诚实标注,不编造)")

    reviews_map = {}
    for asin in all_asins:
        r = ds.parse_reviews(raws.get(keys["reviews"][asin]), asin)
        reviews_map[asin] = r
        if r["status"] == "ok":
            status.log(f"[评论 {asin}] 解析成功: {r['count']} 条(低星 {r['lowStarCount']} 条)")
        else:
            status.log(f"[评论 {asin}] 不可用: {r['note']}")
            notes.append(f"{asin} 评论不可用:{r['note']}")
    return comp_map, detail_map, reviews_map


def execute_run(run_id: str, params: dict) -> None:
    """完整执行一次 run(同步;通常由后台线程调用)。"""
    status = store.RunStatus(run_id, params)
    try:
        status.log(f"run 开始: market={params['market']} 我司={params['myAsin']} "
                   f"竞品={params.get('competitorAsins')} useCache={params.get('useCache', True)}")
        raws = _fetch_all(status, params)
        keys = raws.pop("_keys")

        notes: list = []
        comp_map, detail_map, reviews_map = _parse_sources(status, params, raws, keys, notes)
        products = _build_products(params, comp_map, detail_map, reviews_map, notes)

        cross = _run_llm(status, products, notes)

        status.set_stage("assemble", 92)
        dashboard = _assemble(run_id, params, products, cross, notes)
        store.save_dashboard(run_id, dashboard)
        status.log("dashboard.json 已生成")
        status.finish()
    except Exception as e:  # noqa: BLE001
        import traceback
        status.log("run 异常: " + traceback.format_exc(limit=5))
        status.fail(str(e))
    finally:
        _clear_inflight(run_id)


def execute_rebuild(run_id: str) -> None:
    """用已缓存原始数据重跑 LLM + 组装(不再消耗 LinkFox 积分)。

    注意:status 已在 try_start_rebuild 锁内 restart(标 running),
    此处不再重复置位。
    """
    status = store.RunStatus(run_id)
    params = status.params()
    try:
        status.set_stage("llm_analysis", 5)
        status.log("rebuild:复用已缓存原始数据,重跑 LLM 分析与组装")
        market = params["market"]
        all_asins = [params["myAsin"]] + list(params.get("competitorAsins") or [])
        keys = {
            "competitor": ds.cache_key("competitor", market, all_asins),
            "detail": ds.cache_key("detail", market, all_asins),
            "reviews": {a: ds.cache_key("reviews", market, a) for a in all_asins},
        }
        raws = {}
        flat_keys = [keys["competitor"], keys["detail"]] + list(keys["reviews"].values())
        for key in flat_keys:
            raw = store.load_raw(run_id, key)
            if raw is None:
                raw = store.cache_get(key)
                if raw is not None:
                    status.log(f"rebuild:runs/raw 缺 {key},改用 data/cache 缓存")
            raws[key] = raw

        notes: list = []
        comp_map, detail_map, reviews_map = _parse_sources(status, params, raws, keys, notes)
        products = _build_products(params, comp_map, detail_map, reviews_map, notes)
        cross = _run_llm(status, products, notes)

        status.set_stage("assemble", 92)
        dashboard = _assemble(run_id, params, products, cross, notes)
        store.save_dashboard(run_id, dashboard)
        status.log("rebuild 完成,dashboard.json 已更新")
        status.finish()
    except Exception as e:  # noqa: BLE001
        import traceback
        status.log("rebuild 异常: " + traceback.format_exc(limit=5))
        status.fail(str(e))
    finally:
        _clear_inflight(run_id)
