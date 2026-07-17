# -*- coding: utf-8 -*-
"""三类 LinkFox 工具任务的任务文本构造 + 真实返回结构解析 → 规范化结构。

解析逻辑严格以已回收的真实返回结构(data/cache/ 下 fixture)为准,不凭空猜字段:
- 查竞品(卖家精灵):    type=productWorkbenches, products[] 57字段
- 商品详情(亚马逊前台): type=productWorkbenches, products[] 含 aboutItemFivePoint/
                        productImageUrls/itemSpecifications/productDescription(A+)/
                        boughtTogether 等;真实返回**没有** relatedProducts 与视频URL字段
- 商品评论(亚马逊):    type=tableListWorkbenches, data[] 行;statusMessage==FOUND 为真实评论,
                        NO_REVIEWS_PENALTY_* 表示该星级抓不到评论
"""
import html
import json
import re
from typing import Optional

from .config import AMAZON_BASE

# 站点映射(契约 §4)
MARKET_NAMES = {
    "US": "美国站", "UK": "英国站", "DE": "德国站",
    "FR": "法国站", "JP": "日本站", "CA": "加拿大站",
}


def market_name(market: str) -> str:
    return MARKET_NAMES.get(market.upper(), f"{market}站")


# ---------------------------------------------------------------- 任务文本
def competitor_task_text(market: str, asins: list) -> str:
    return (f"@卖家精灵-查竞品 在{market_name(market)},asin为 "
            f"{','.join(asins)} 的商品数据,返回全部字段")


def detail_task_text(market: str, asins: list) -> str:
    return (f"@亚马逊前端-商品详情 获取亚马逊{market_name(market)},asin为:"
            f"{'、'.join(asins)} 的数据,同时返回相关商品列表(relatedProducts=true)"
            f"和经常一起购买的商品(boughtTogether=true)")


def reviews_task_text(market: str, asin: str, per_star: int = 20) -> str:
    return (f"@亚马逊-商品评论 亚马逊{market_name(market)},asin为{asin},"
            f"每个星级各{per_star}条,评论排序方式为最新评论,评论者类型为所有评论")


# ---------------------------------------------------------------- 缓存键
def cache_key(tool: str, market: str, asins) -> str:
    """{tool}_{market}_{asinsKey};多 ASIN 排序后拼接,保证与顺序无关。"""
    if isinstance(asins, str):
        asins_key = asins
    else:
        asins_key = "-".join(sorted(asins))
    return f"{tool}_{market.upper()}_{asins_key}"


# ---------------------------------------------------------------- 通用提取
def extract_json_result(raw: Optional[dict]) -> Optional[dict]:
    """从轮询原始响应中取出 results[] 里 type==json 的内层结构。"""
    if not isinstance(raw, dict):
        return None
    for item in raw.get("results") or []:
        if item.get("type") != "json":
            continue
        content = item.get("content")
        if isinstance(content, dict):
            return content
        try:
            return json.loads(content)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def _rows(payload: Optional[dict]) -> list:
    if not isinstance(payload, dict):
        return []
    for key in ("products", "data", "items", "list"):
        v = payload.get(key)
        if isinstance(v, list):
            return v
    return []


def _clean_num(v):
    """卖家精灵用 -1 / -1.0 表示「无数据」的哨兵值 → None。

    适用于价格/费用/计数/评分/排名/质量分/销量/销售额等只可能非负的字段。
    注意:增长率类字段(monthlySalesUnitsGrowthRate、bsrGrowthRate、
    bsrGrowthCount)**不得**用本函数清洗——负增长是真值;
    ratingsGrowth 的 0 是合法值,只有 -1 才是哨兵。
    """
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v == -1.0:
        return None
    return v


# ---------------------------------------------------------------- 查竞品解析
def parse_competitor(raw: Optional[dict]) -> dict:
    """→ {asin: {"brand","title","imageUrl","brandUrl","metrics":{...}}}

    字段映射依据真实返回(卖家精灵-查竞品 productWorkbenches.products[]):
    - brandUrl 是相对路径,拼 https://www.amazon.com 前缀
    - sellerUrl 由 sellerId 拼出
    - subcategories[0] → subCategory/subBsr
    - badge 对象直接透传为 metrics.badges
    """
    payload = extract_json_result(raw)
    out = {}
    for p in _rows(payload):
        asin = p.get("asin")
        if not asin:
            continue
        brand_url = p.get("brandUrl")
        if brand_url and brand_url.startswith("/"):
            brand_url = AMAZON_BASE + brand_url
        seller_id = p.get("sellerId")
        node_path = p.get("nodeLabelPath")
        subcats = p.get("subcategories") or []
        sub0 = subcats[0] if subcats and isinstance(subcats[0], dict) else {}
        available = p.get("availableDateString")
        if not available:
            raw_date = p.get("availableDate") or ""
            available = raw_date[:10] if raw_date else None

        metrics = {
            "monthlySalesUnits": _clean_num(p.get("monthlySalesUnits")),
            "monthlySalesRevenue": _clean_num(p.get("monthlySalesRevenue")),
            "bsrCategory": node_path.split(":")[0] if node_path else None,
            "bsr": _clean_num(p.get("bsr")),
            "subCategory": sub0.get("label"),
            "subBsr": _clean_num(sub0.get("rank")),
            "price": _clean_num(p.get("price")),
            "averagePrice": _clean_num(p.get("averagePrice")),
            "profit": _clean_num(p.get("profit")),
            "fba": _clean_num(p.get("fba")),
            "rating": _clean_num(p.get("rating")),
            "ratings": _clean_num(p.get("ratings")),
            "ratingsRate": _clean_num(p.get("ratingsRate")),
            "ratingsGrowth": _clean_num(p.get("ratingsGrowth")),  # 0 合法,只清 -1
            # 增长率是真值,负增长不清洗(-1 也可能是真实的 -1%)
            "monthlySalesUnitsGrowthRate": p.get("monthlySalesUnitsGrowthRate"),
            "bsrGrowthRate": p.get("bsrGrowthRate"),
            "variationNum": _clean_num(p.get("variationNum")),
            "parentAsin": p.get("parent"),
            "availableDate": available,
            "fulfillment": p.get("fulfillment"),
            "sellerName": p.get("sellerName"),
            "sellerId": seller_id,
            "sellerNation": p.get("sellerNation"),
            "sellerUrl": f"{AMAZON_BASE}/sp?seller={seller_id}" if seller_id else None,
            "listingQualityScore": _clean_num(p.get("listingQualityScore")),
            "weight": p.get("weight"),
            "dimension": p.get("dimension"),
            "packageDimensions": p.get("packageDimensions"),
            "packageWeight": p.get("packageWeight"),
            "sku": p.get("sku"),
            "nodeLabelPath": node_path,
            "badges": p.get("badge"),  # badge 对象直接透传
        }
        out[asin] = {
            "brand": p.get("brand"),
            "title": html.unescape(p.get("title") or "") or None,
            "imageUrl": p.get("imageUrl"),
            "brandUrl": brand_url,
            "metrics": metrics,
        }
    return out


# ---------------------------------------------------------------- 商品详情解析
def _clean_brand(byline: Optional[str]) -> Optional[str]:
    """'Visit the SICOTAS Store' → 'SICOTAS'。"""
    if not byline:
        return None
    m = re.match(r"^Visit the (.+?) Store$", byline.strip())
    return m.group(1) if m else byline.strip()


def _map_mini_product(item: dict) -> dict:
    """推荐/一起购买小卡 → {asin, imageUrl, title}(契约 §6)。

    真实返回中"经常一起购买"的第一个条目通常是商品本身,无 asin/link;
    有 link 时尝试从 /dp/{ASIN} 提取。诚实透传,不编造。
    """
    asin = item.get("asin")
    if not asin:
        link = item.get("linkClean") or item.get("link") or ""
        m = re.search(r"/dp/([A-Z0-9]{10})", link)
        asin = m.group(1) if m else None
    return {
        "asin": asin,
        "imageUrl": item.get("thumbnail") or item.get("imageUrl"),
        "title": item.get("title"),
    }


def parse_detail(raw: Optional[dict]) -> dict:
    """→ {asin: {"title","brand","imageUrl","productUrl","detail":{...}}}

    真实返回结构说明(诚实原则):
    - 五点原文在 aboutItemFivePoint;套图在 productImageUrls
    - A+ 内容在 productDescription(JSON 字符串);非空即视为有 A+
    - 本次真实返回**无视频 URL 字段** → videoUrl=None,不编造
    - 本次真实返回**无 relatedProducts 字段** → recommended=[](如返回则解析)
    - Coupon 无对应字段 → modules.coupon=None;Deal 用 discount/oldPrice 作代理
    """
    payload = extract_json_result(raw)
    out = {}
    for p in _rows(payload):
        asin = p.get("asin")
        if not asin:
            continue
        aplus_raw = p.get("productDescription")
        has_aplus = bool(aplus_raw and str(aplus_raw).strip() not in ("", "[]", "null"))

        recommended = []
        for key in ("relatedProducts", "related_products", "recommendations", "recommended"):
            v = p.get(key)
            if isinstance(v, list) and v:
                recommended = [_map_mini_product(x) for x in v if isinstance(x, dict)]
                break

        bought = [_map_mini_product(x) for x in (p.get("boughtTogether") or [])
                  if isinstance(x, dict)]

        discount = p.get("discount")
        old_price = p.get("extractedOldPrice") or p.get("oldPrice")
        deal = None
        if discount:
            deal = f"{discount}(划线价 ${old_price})" if old_price else str(discount)

        detail = {
            "bullets": p.get("aboutItemFivePoint") or [],
            "images": p.get("productImageUrls") or [],
            "videoUrl": None,  # 详情接口本次未返回视频 URL,诚实置空
            "aplus": has_aplus,
            "specs": p.get("itemSpecifications") or {},
            "recommended": recommended,
            "boughtTogether": bought,
            "modules": {
                "coupon": None,  # 详情接口未返回 Coupon 字段
                "deal": deal,
                "bsAc": p.get("badges") or None,  # 前台搜索标识,如 "Amazon's Choice"
            },
        }
        product_details = p.get("productDetails") or {}
        out[asin] = {
            "title": p.get("title"),
            "brand": _clean_brand(p.get("brand")) or product_details.get("manufacturer"),
            "imageUrl": p.get("imageUrl") or p.get("thumbnail"),
            "productUrl": p.get("linkClean") or p.get("asinUrl"),
            "detail": detail,
        }
    return out


# ---------------------------------------------------------------- 商品评论解析
_STAR_RE = re.compile(r"^([\d.]+)")
_DATE_RE = re.compile(r"\bon\s+(.+)$")


def parse_reviews(raw: Optional[dict], asin: str) -> dict:
    """→ 契约 reviews 块 {"status","note","count","lowStarCount","items"}。

    真实返回:data[] 行,statusMessage==FOUND 为真实评论;
    NO_REVIEWS_PENALTY_* 行表示该星级未抓到评论(重试记录),不是评论。
    """
    status = (raw or {}).get("status")
    if status != "finished":
        note = (raw or {}).get("error") or f"评论任务未成功(状态: {status or '无响应'})"
        return {"status": "unavailable", "note": note,
                "count": 0, "lowStarCount": 0, "items": []}

    payload = extract_json_result(raw)
    if payload is None:
        return {"status": "unavailable",
                "note": "评论任务已完成但未返回结构化数据(亚马逊评论模块可能要求账户验证)",
                "count": 0, "lowStarCount": 0, "items": []}

    items = []
    for row in _rows(payload):
        if row.get("statusMessage") != "FOUND":
            continue
        if row.get("asin") and row.get("asin") != asin:
            continue
        star = None
        m = _STAR_RE.match(str(row.get("rating") or ""))
        if m:
            try:
                star = float(m.group(1))
            except ValueError:
                star = None
        date_raw = row.get("date") or ""
        dm = _DATE_RE.search(date_raw)
        date = dm.group(1) if dm else (date_raw or None)
        items.append({
            "star": star,
            "title": row.get("title"),
            "date": date,
            "content": row.get("text"),
            "verified": bool(row.get("verified")),
        })

    if not items:
        return {"status": "unavailable",
                "note": "评论任务已完成但未抓到任何评论原文(该商品评论过少或亚马逊评论模块限制)",
                "count": 0, "lowStarCount": 0, "items": []}

    low = sum(1 for it in items if isinstance(it["star"], (int, float)) and it["star"] <= 3)
    return {"status": "ok", "note": "", "count": len(items),
            "lowStarCount": low, "items": items}
