# -*- coding: utf-8 -*-
"""LinkFox Agent API 客户端(标准库 urllib 实现)。

协议(已实测):
- 提交任务: POST {BASE}/chat/saveMessageForApi  body {"text": "<任务文本>"}
- 轮询结果: POST {BASE}/chat/getMessageForApi   body {"id": "<messageId>"}
- 请求头: Authorization: <裸 JWT,不带 Bearer 前缀>, Content-Type: application/json
- 终态: finished / error / cancel;任务一般 1~5 分钟。
"""
import json
import time
from typing import Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import config

SUBMIT_ENDPOINT = "chat/saveMessageForApi"
POLL_ENDPOINT = "chat/getMessageForApi"
TERMINAL_STATUSES = {"finished", "error", "cancel"}

DEFAULT_TIMEOUT = 600  # 单任务最长等待(秒)
DEFAULT_INTERVAL = 5   # 轮询间隔(秒)

LogFn = Optional[Callable[[str], None]]


class LinkfoxError(Exception):
    """LinkFox API 调用失败。"""


def _log(log: LogFn, msg: str) -> None:
    if log:
        try:
            log(msg)
        except Exception:
            pass


def _request(endpoint: str, payload: dict, timeout: int = 30) -> dict:
    url = f"{config.LINKFOX_BASE_URL.rstrip('/')}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=data,
        headers={
            "Authorization": config.LINKFOX_API_KEY,  # 裸 JWT
            "Content-Type": "application/json",
            "User-Agent": "CompetitorDashboard/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8") if e.fp else ""
        except Exception:
            pass
        raise LinkfoxError(f"HTTP {e.code}: {e.reason} {body[:300]}") from e
    except URLError as e:
        raise LinkfoxError(f"连接失败: {e.reason}") from e
    except Exception as e:  # noqa: BLE001
        raise LinkfoxError(str(e)) from e


def submit(text: str, log: LogFn = None) -> str:
    """提交任务,返回 messageId。失败抛 LinkfoxError。"""
    resp = _request(SUBMIT_ENDPOINT, {"text": text})
    message_id = resp.get("messageId") or ""
    if not message_id:
        raise LinkfoxError(f"提交任务未返回 messageId: {json.dumps(resp, ensure_ascii=False)[:300]}")
    _log(log, f"LinkFox 任务已提交 messageId={message_id}")
    return message_id


def poll_once(message_id: str) -> dict:
    """单次轮询,返回原始响应。"""
    return _request(POLL_ENDPOINT, {"id": message_id})


def poll(message_id: str, timeout: int = DEFAULT_TIMEOUT,
         interval: int = DEFAULT_INTERVAL, log: LogFn = None) -> dict:
    """轮询直到终态(finished/error/cancel)或超时。

    返回原始响应 dict;超时返回 {"status": "timeout", "messageId": ...}。
    网络级瞬时错误会容忍并继续轮询。
    """
    deadline = time.time() + timeout
    last_progress = ""
    consecutive_errors = 0
    while time.time() < deadline:
        try:
            resp = poll_once(message_id)
            consecutive_errors = 0
        except LinkfoxError as e:
            consecutive_errors += 1
            _log(log, f"轮询 {message_id} 出错({consecutive_errors}): {e}")
            if consecutive_errors >= 5:
                return {"status": "error", "messageId": message_id,
                        "error": f"连续轮询失败: {e}"}
            time.sleep(interval)
            continue

        status = resp.get("status", "")
        if status in TERMINAL_STATUSES:
            _log(log, f"任务 {message_id} 终态: {status}")
            return resp

        progress = resp.get("progress") or ""
        if progress and progress != last_progress:
            _log(log, f"任务 {message_id} 进度: {progress}")
            last_progress = progress
        time.sleep(interval)

    _log(log, f"任务 {message_id} 轮询超时({timeout}s)")
    return {"status": "timeout", "messageId": message_id,
            "error": f"轮询超时({timeout}s)"}


def run_task(text: str, timeout: int = DEFAULT_TIMEOUT,
             interval: int = DEFAULT_INTERVAL, log: LogFn = None) -> dict:
    """提交并等待任务完成,返回原始终态响应。"""
    message_id = submit(text, log=log)
    return poll(message_id, timeout=timeout, interval=interval, log=log)
