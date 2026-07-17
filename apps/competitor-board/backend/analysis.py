# -*- coding: utf-8 -*-
"""LLM 分析层:三种分析的 prompt(中文)+ 严格 JSON 结果解析(schema 对齐契约 §6)。

1. 标题五点 Alexa/Rufus 分析 + 策略(每产品 1 次调用)
2. VOC 聚类(每产品 1 次;每条要点必须附真实评论原文摘录,程序校验为原文子串)
3. 跨产品综合(1 次)

诚实原则:LLM 彻底失败时对应块置 None,调用方写 note;证据摘录经程序校验,
非原文子串的证据会触发一次带反馈的重试,仍不合格则剔除,绝不编造。
"""
import json
import re
from typing import Callable, List, Optional

from . import llm

LogFn = Optional[Callable[[str], None]]

_WS_RE = re.compile(r"\s+")


def _log(log: LogFn, msg: str) -> None:
    if log:
        try:
            log(msg)
        except Exception:
            pass


def _norm(s: str) -> str:
    """归一化用于子串校验:小写 + 空白折叠 + 常见弯引号还原。"""
    if not s:
        return ""
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    return _WS_RE.sub(" ", s).strip().lower()


def _as_str_list(v, limit: int = 6) -> List[str]:
    if not isinstance(v, list):
        return []
    return [str(x).strip() for x in v if str(x).strip()][:limit]


def _parse_pca(block) -> Optional[dict]:
    """解析 {pros, cons, advice} 块。"""
    if not isinstance(block, dict):
        return None
    return {
        "pros": _as_str_list(block.get("pros")),
        "cons": _as_str_list(block.get("cons")),
        "advice": str(block.get("advice") or "").strip() or None,
    }


# ---------------------------------------------------------------- 1. 标题五点分析
_LISTING_SYSTEM = (
    "你是资深亚马逊 Listing 优化专家。你的分析视角是:站在亚马逊 AI 导购"
    "(Rufus / Alexa 购物助手)如何理解、检索与推荐商品的角度,评估标题与五点描述的质量:"
    "类型词是否前置、使用场景是否清晰、尺寸/承重/材质/安装/充电接口等 AI 可引用的"
    "结构化信息是否完整、是否有堆词或冗余符号影响机器解析。"
    "优缺点必须具体(引用原文片段说明),不得空泛。只输出严格 JSON,不要任何其他文字。"
)

_LISTING_USER_TMPL = """请分析以下亚马逊商品({role_label},ASIN {asin})的标题与五点描述,并给出该产品的竞争策略建议。

【标题原文】
{title}

【五点描述原文】
{bullets}

【市场背景(卖家精灵数据)】
{context}

要求返回严格 JSON,结构如下(键名固定,中文内容):
{{
  "titleAnalysis": {{
    "pros": ["优点1(具体,指出对 Rufus/Alexa 检索推荐有利的点)", "..."],
    "cons": ["缺点1(具体)", "..."],
    "advice": "改进建议,必须给出一条前80字符的英文标题改写建议(格式参考:Nightstand with Charging Station, USB-C/AC Outlets, 17.6 in Fluted Bedside Table),并简述理由"
  }},
  "bulletsAnalysis": {{
    "pros": ["优点1", "..."],
    "cons": ["缺点1", "..."],
    "advice": "五点改进建议(如何补齐 AI 可引用的规格/场景/差异化信息)"
  }},
  "strategy": "一句话竞争策略建议(结合上面的市场背景数据,说明该产品应如何打;80-150字)"
}}
每个 pros/cons 数组 2-4 条。不得编造商品没有的属性。"""


def analyze_listing(asin: str, role_label: str, title: Optional[str],
                    bullets: Optional[list], context: dict, log: LogFn = None) -> Optional[dict]:
    """标题五点 Alexa/Rufus 分析 + 策略。返回 {titleAnalysis, bulletsAnalysis, strategy} 或 None。"""
    if not title and not bullets:
        return None
    bullets_text = "\n".join(f"- {b}" for b in (bullets or [])) or "(无五点数据)"
    user = _LISTING_USER_TMPL.format(
        role_label=role_label, asin=asin,
        title=title or "(无标题数据)",
        bullets=bullets_text,
        context=json.dumps(context, ensure_ascii=False),
    )
    try:
        result = llm.chat_json(_LISTING_SYSTEM, user, max_tokens=10000, log=log)
    except llm.LlmError as e:
        _log(log, f"[{asin}] 标题五点分析失败: {e}")
        return None
    out = {
        "titleAnalysis": _parse_pca(result.get("titleAnalysis")),
        "bulletsAnalysis": _parse_pca(result.get("bulletsAnalysis")),
        "strategy": str(result.get("strategy") or "").strip() or None,
    }
    if not out["titleAnalysis"] and not out["bulletsAnalysis"] and not out["strategy"]:
        _log(log, f"[{asin}] 标题五点分析返回结构不符,置空")
        return None
    return out


# ---------------------------------------------------------------- 2. VOC 聚类
_VOC_SYSTEM = (
    "你是电商 VOC(Voice of Customer)分析专家。你要对真实的亚马逊评论做聚类分析。"
    "铁律:每条要点的 evidence 数组里的每一条,必须是所给评论【原文的连续摘录】"
    "——直接从评论 text 中复制一段连续文字(可截取片段,英文原文,不翻译、不改写、"
    "不增删单词、不改标点),长度 20-200 字符。系统会程序化校验摘录是否为原文子串,"
    "不是原文子串的证据会被判定为编造并剔除。评论数量不足时要点可以少于3条,绝不虚构。"
    "只输出严格 JSON。"
)

_VOC_USER_TMPL = """以下是亚马逊商品(ASIN {asin})的 {n} 条真实评论(编号 R1..R{n},含星级/标题/正文):

{reviews}

请聚类输出 VOC 分析,返回严格 JSON:
{{
  "positiveTop": [{{"point": "好评点(中文短语,≤20字)", "evidence": ["评论原文连续摘录1", "..."]}}, ...],
  "negativeTop": [{{"point": "差评点(中文短语)", "evidence": ["..."]}}, ...],
  "unmetNeeds":  [{{"point": "未被满足的需求(中文短语)", "evidence": ["..."]}}, ...]
}}
- positiveTop / negativeTop 各最多3条(按提及频次排序);unmetNeeds 最多3条(从期望、抱怨、改进愿望中提炼)。
- 每条要点 1-2 条 evidence,必须是上面评论 text 字段的原文连续摘录。
- 差评点优先基于 ≤3 星评论。数据不足就少写,不要编。{feedback}"""


def _validate_evidence(voc: dict, review_texts: List[str]):
    """校验 evidence 是否为评论原文子串。返回 (清洗后的voc, 无效证据列表)。"""
    norm_texts = [_norm(t) for t in review_texts if t]
    invalid = []
    cleaned = {}
    for key in ("positiveTop", "negativeTop", "unmetNeeds"):
        points_out = []
        for entry in (voc.get(key) or []):
            if not isinstance(entry, dict):
                continue
            point = str(entry.get("point") or "").strip()
            if not point:
                continue
            good_ev = []
            for ev in _as_str_list(entry.get("evidence"), limit=4):
                ev_norm = _norm(ev)
                # 最短长度门槛:过短的摘录(如单词/短语)极易碰巧匹配原文,
                # 起不到证据作用,按未通过处理
                if len(ev_norm) >= 15 and any(ev_norm in t for t in norm_texts):
                    good_ev.append(ev)
                else:
                    invalid.append(ev)
            points_out.append({"point": point, "evidence": good_ev})
        cleaned[key] = points_out[:3]
    return cleaned, invalid


def analyze_voc(asin: str, review_items: list, log: LogFn = None) -> Optional[dict]:
    """VOC 聚类。返回 {positiveTop, negativeTop, unmetNeeds}(不含 status)或 None。

    证据校验:非原文子串 → 带反馈重试一次 → 仍不合格的证据剔除;
    要点若证据全部被剔除仍保留要点但 evidence 为空数组(诚实呈现)。
    """
    items = [it for it in (review_items or []) if it.get("content")][:80]
    if not items:
        return None
    lines = []
    for i, it in enumerate(items, 1):
        star = it.get("star")
        title = (it.get("title") or "").replace("\n", " ")
        text = (it.get("content") or "").replace("\n", " ")
        lines.append(f"R{i} [{star}星] {title} ||| text: {text}")
    reviews_block = "\n".join(lines)
    texts = [it.get("content") or "" for it in items]

    feedback = ""
    result_clean = None
    for attempt in range(2):
        user = _VOC_USER_TMPL.format(asin=asin, n=len(items),
                                     reviews=reviews_block, feedback=feedback)
        try:
            result = llm.chat_json(_VOC_SYSTEM, user, max_tokens=12000, log=log)
        except llm.LlmError as e:
            _log(log, f"[{asin}] VOC 分析失败: {e}")
            return None
        cleaned, invalid = _validate_evidence(result, texts)
        result_clean = cleaned
        if not invalid:
            break
        if attempt == 0:
            _log(log, f"[{asin}] VOC 有 {len(invalid)} 条证据非原文子串,带反馈重试")
            feedback = ("\n\n【上次输出被驳回】以下证据不是评论原文的连续摘录(被判定为改写/编造),"
                        "请重新输出,evidence 必须从上面评论 text 中原样复制连续片段:\n"
                        + "\n".join(f"- {ev[:100]}" for ev in invalid[:8]))
        else:
            _log(log, f"[{asin}] VOC 重试后仍有 {len(invalid)} 条无效证据,已剔除")

    if result_clean is None:
        return None
    if not any(result_clean.get(k) for k in ("positiveTop", "negativeTop", "unmetNeeds")):
        return None
    return result_clean


# ---------------------------------------------------------------- 3. 跨产品综合
_CROSS_SYSTEM = (
    "你是亚马逊品类操盘顾问。基于多产品的真实市场数据与 VOC 要点,输出一段跨产品综合对比"
    "结论和可执行的行动建议。结论要点名 ASIN/品牌、用数据说话,不得编造数据。只输出严格 JSON。"
)

_CROSS_USER_TMPL = """以下是「我司产品 vs 直接竞品」的核心数据摘要(JSON):

{summary}

请输出跨产品综合分析,返回严格 JSON:
{{
  "summary": "一段综合对比结论(200-350字,中文):我司与竞品在价格带/销量/BSR/评论体量/流量标识(AC等)/VOC 上的差距与机会",
  "actions": ["行动建议1(具体可执行)", "行动建议2", "..."]
}}
actions 给 3-6 条,按优先级排序。"""


def analyze_cross(products_summary: list, log: LogFn = None) -> Optional[dict]:
    """跨产品综合。返回 {summary, actions} 或 None。"""
    if not products_summary:
        return None
    user = _CROSS_USER_TMPL.format(
        summary=json.dumps(products_summary, ensure_ascii=False, indent=1))
    try:
        result = llm.chat_json(_CROSS_SYSTEM, user, max_tokens=10000, log=log)
    except llm.LlmError as e:
        _log(log, f"跨产品综合分析失败: {e}")
        return None
    summary = str(result.get("summary") or "").strip()
    actions = _as_str_list(result.get("actions"), limit=8)
    if not summary and not actions:
        return None
    return {"summary": summary or None, "actions": actions}
