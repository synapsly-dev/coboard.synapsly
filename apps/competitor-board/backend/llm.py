# -*- coding: utf-8 -*-
"""OpenAI 兼容 chat 客户端(标准库 urllib,不引第三方)。

供应商由 .env 决定(当前:DMXAPI 中转 gpt-5.5;备用:智谱 GLM):
- POST {LLM_BASE_URL}chat/completions,Authorization: Bearer {LLM_API_KEY}
- 请求 response_format {"type":"json_object"};仍容错:剥 ```json 围栏、
  取第一个 { 到最后一个 } 再 json.loads
- gpt-5.5 是推理模型:usage 含 reasoning_tokens,max_tokens 必须给足余量,
  否则正文会被 reasoning 挤掉返回空 content。遇到 content 为空且
  finish_reason==length 时自动加倍 max_tokens 重试。
- 失败重试 2 次;彻底失败抛 LlmError(调用方将对应分析块置 null 并写 note)
"""
import json
import re
import threading
import time
from typing import Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import config

LogFn = Optional[Callable[[str], None]]

MAX_RETRIES = 2          # 首次失败后再重试 2 次
REQUEST_TIMEOUT = 600    # 单次请求超时(秒);推理模型耗时较长

# 简单调用计数(汇报用)
_counter_lock = threading.Lock()
CALL_COUNTER = {"attempts": 0, "success": 0}


class LlmError(Exception):
    """LLM 调用/解析彻底失败。"""


def _log(log: LogFn, msg: str) -> None:
    if log:
        try:
            log(msg)
        except Exception:
            pass


def _endpoint() -> str:
    return config.LLM_BASE_URL.rstrip("/") + "/chat/completions"


def _post(payload: dict) -> dict:
    req = Request(
        _endpoint(),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.LLM_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def parse_json_text(text: str):
    """容错解析:剥围栏/思考标签,取第一个 { 到最后一个 }。"""
    if not text:
        raise LlmError("LLM 返回空内容")
    text = _THINK_RE.sub("", text).strip()
    m = _FENCE_RE.search(text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    raise LlmError(f"LLM 返回内容无法解析为 JSON: {text[:200]}")


class _EmptyByLength(Exception):
    """content 为空且 finish_reason==length:reasoning 挤掉了正文,需加大 max_tokens。"""


def _call_once(system: str, user: str, max_tokens: int) -> dict:
    """单次调用 → 解析后的 dict。可能抛 _EmptyByLength / LlmError / HTTPError / URLError。"""
    payload = {
        "model": config.LLM_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        # 注意:不传 temperature —— gpt-5 系推理模型仅接受默认值
    }
    resp = _post(payload)
    choices = resp.get("choices") or []
    if not choices:
        raise LlmError(f"LLM 响应无 choices: {json.dumps(resp, ensure_ascii=False)[:200]}")
    choice = choices[0]
    message = choice.get("message") or {}
    content = (message.get("content") or "").strip()
    if not content:
        # 部分推理模型把正文放 reasoning_content(取其中 JSON 兜底)
        content = (message.get("reasoning_content") or "").strip()
    if not content:
        if choice.get("finish_reason") == "length":
            raise _EmptyByLength(f"content 为空且 finish_reason=length(max_tokens={max_tokens})")
        raise LlmError(f"LLM 返回空 content(finish_reason={choice.get('finish_reason')})")
    result = parse_json_text(content)
    if not isinstance(result, dict):
        raise LlmError(f"LLM 返回的不是 JSON 对象: {type(result).__name__}")
    return result


def chat_json(system: str, user: str, max_tokens: int = 10000,
              log: LogFn = None) -> dict:
    """一次 JSON 模式对话,返回解析后的 dict。

    - 空 content + finish_reason=length → 加倍 max_tokens 立即重试(不占重试配额)
    - 其他失败重试 2 次;彻底失败抛 LlmError
    """
    last_err = None
    tokens = max_tokens
    length_bumps = 0
    attempt = 0
    while attempt <= MAX_RETRIES:
        with _counter_lock:
            CALL_COUNTER["attempts"] += 1
        try:
            result = _call_once(system, user, tokens)
            with _counter_lock:
                CALL_COUNTER["success"] += 1
            return result
        except _EmptyByLength as e:
            if length_bumps < 2:
                length_bumps += 1
                tokens *= 2
                _log(log, f"LLM 正文被 reasoning 挤掉({e}),加大 max_tokens={tokens} 重试")
                continue  # 不消耗常规重试次数
            last_err = LlmError(str(e))
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8") if e.fp else ""
            except Exception:
                pass
            last_err = LlmError(f"HTTP {e.code}: {body[:300]}")
        except URLError as e:
            last_err = LlmError(f"连接失败: {e.reason}")
        except LlmError as e:
            last_err = e
        except Exception as e:  # noqa: BLE001
            last_err = LlmError(str(e))
        attempt += 1
        if attempt <= MAX_RETRIES:
            _log(log, f"LLM 调用失败(第{attempt}次): {last_err},{3 * attempt}s 后重试")
            time.sleep(3 * attempt)
    raise last_err if last_err else LlmError("LLM 调用失败")
