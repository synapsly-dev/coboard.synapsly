# -*- coding: utf-8 -*-
"""data/ 持久化:runs(status.json / dashboard.json / raw/*.json)+ cache。

- 缓存键: {tool}_{market}_{asinsKey}(见 datasources.cache_key)
- 写 JSON 一律 UTF-8,先写唯一临时文件(uuid 后缀)再 os.replace,避免半截文件;
  Windows 下 os.replace 遇读写竞争(PermissionError)短退避重试
- status.json 的写入按 run_id 用进程级共享锁串行化(见 RunStatus)
"""
import datetime as _dt
import json
import os
import re
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from .config import CACHE_DIR, RUNS_DIR

# run_id 白名单(与 new_run_id 生成格式一致): run_YYYYMMDD_HHMMSS[_n]
RUN_ID_RE = re.compile(r"^run_[0-9]{8}_[0-9]{6}(_[0-9]+)?$")


def is_valid_run_id(run_id) -> bool:
    return isinstance(run_id, str) and bool(RUN_ID_RE.match(run_id))

STAGE_LABELS = {
    "fetch_competitor": "拉取竞品市场数据(卖家精灵)",
    "fetch_detail": "拉取商品详情(亚马逊前台)",
    "fetch_reviews": "拉取商品评论",
    "llm_analysis": "LLM 分析",
    "assemble": "组装看板数据",
}


# ---------------------------------------------------------------- JSON IO
# Windows 下 os.replace 目标文件正被读取时会抛 PermissionError → 短退避重试
_REPLACE_RETRY_BACKOFF_MS = (20, 40, 80, 160, 320)


def write_json(path: Path, data) -> None:
    """原子写 JSON:

    - 临时文件名带 uuid 后缀,并发双写不撞名;
    - os.replace 失败(读写竞争)按 20/40/80/160/320ms 退避重试 5 次;
    - 最终失败向上抛,但 finally 保证清理临时文件(不留 tmp 孤儿)。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        last_err = None
        for attempt in range(len(_REPLACE_RETRY_BACKOFF_MS) + 1):
            try:
                os.replace(tmp, path)
                return
            except PermissionError as e:
                last_err = e
                if attempt < len(_REPLACE_RETRY_BACKOFF_MS):
                    time.sleep(_REPLACE_RETRY_BACKOFF_MS[attempt] / 1000.0)
        raise last_err
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def read_json(path: Path):
    """读 JSON;Windows 下 PermissionError(写方正 replace)短重试 3 次再放弃。"""
    path = Path(path)
    if not path.is_file():
        return None
    last_attempt = 3  # 首次 + 3 次重试
    for attempt in range(last_attempt + 1):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except PermissionError:
            if attempt < last_attempt:
                time.sleep(0.02 * (attempt + 1))
                continue
            return None
        except FileNotFoundError:
            # replace 瞬间可能短暂不可见,极小概率;重试一次窗口即可
            if attempt < last_attempt:
                time.sleep(0.02)
                continue
            return None
        except (json.JSONDecodeError, OSError):
            return None
    return None


# ---------------------------------------------------------------- cache
def cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def cache_get(key: str):
    return read_json(cache_path(key))


def cache_put(key: str, data) -> None:
    write_json(cache_path(key), data)


# ---------------------------------------------------------------- runs
def new_run_id() -> str:
    ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"run_{ts}"
    # 同秒冲突加后缀
    i = 1
    while (RUNS_DIR / run_id).exists():
        run_id = f"run_{ts}_{i}"
        i += 1
    return run_id


def run_dir(run_id: str) -> Path:
    """拼 run 目录;resolve 后断言在 RUNS_DIR 内(路径穿越双保险)。"""
    base = RUNS_DIR.resolve()
    d = (base / str(run_id)).resolve()
    if base not in d.parents:
        raise ValueError(f"非法 runId(路径越界): {run_id!r}")
    return d


def raw_dir(run_id: str) -> Path:
    return run_dir(run_id) / "raw"


def status_path(run_id: str) -> Path:
    return run_dir(run_id) / "status.json"


def dashboard_path(run_id: str) -> Path:
    return run_dir(run_id) / "dashboard.json"


def run_exists(run_id: str) -> bool:
    return status_path(run_id).is_file()


def save_raw(run_id: str, name: str, data) -> None:
    write_json(raw_dir(run_id) / f"{name}.json", data)


def load_raw(run_id: str, name: str):
    return read_json(raw_dir(run_id) / f"{name}.json")


def save_dashboard(run_id: str, dashboard: dict) -> None:
    write_json(dashboard_path(run_id), dashboard)


def load_dashboard(run_id: str) -> Optional[dict]:
    return read_json(dashboard_path(run_id))


def list_runs() -> list:
    """运行列表(倒序)。"""
    out = []
    if not RUNS_DIR.is_dir():
        return out
    for entry in RUNS_DIR.iterdir():
        if not entry.is_dir():
            continue
        st = read_json(entry / "status.json")
        if not isinstance(st, dict):
            continue
        out.append({
            "runId": st.get("runId") or entry.name,
            "createdAt": st.get("createdAt"),
            "market": st.get("market"),
            "myAsin": st.get("myAsin"),
            "competitorAsins": st.get("competitorAsins") or [],
            "stage": st.get("stage"),
            "status": st.get("status"),
        })
    out.sort(key=lambda r: (r.get("createdAt") or ""), reverse=True)
    return out


# ---------------------------------------------------------------- 运行状态
# 进程级「按 run_id 共享」的状态锁:同一 run 的多个 RunStatus 实例(HTTP 线程 /
# pipeline 线程 / 拉取子线程)串行化 status.json 读改写,避免并发丢更新与写竞争。
_STATUS_LOCKS_GUARD = threading.Lock()
_STATUS_LOCKS: dict = {}  # run_id -> threading.RLock


def _status_lock(run_id: str) -> threading.RLock:
    with _STATUS_LOCKS_GUARD:
        lock = _STATUS_LOCKS.get(run_id)
        if lock is None:
            lock = _STATUS_LOCKS[run_id] = threading.RLock()
        return lock


class RunStatus:
    """status.json 的线程安全读写封装(进度/日志/阶段)。

    - 锁为进程级按 run_id 共享(而非每实例各自 new),跨实例互斥;
    - _save 容错:写盘失败只记 stderr + 内存标记,绝不炸管线线程。
    """

    def __init__(self, run_id: str, params: Optional[dict] = None):
        self.run_id = run_id
        self._lock = _status_lock(run_id)
        self.last_save_error: Optional[str] = None
        with self._lock:
            existing = read_json(status_path(run_id))
            if isinstance(existing, dict):
                self._data = existing
                if params:
                    self._data.update({
                        "market": params.get("market"),
                        "myAsin": params.get("myAsin"),
                        "competitorAsins": params.get("competitorAsins") or [],
                        "reviewsPerStar": params.get("reviewsPerStar"),
                        "useCache": params.get("useCache"),
                    })
            else:
                params = params or {}
                self._data = {
                    "runId": run_id,
                    "createdAt": _dt.datetime.now().isoformat(timespec="seconds"),
                    "market": params.get("market"),
                    "myAsin": params.get("myAsin"),
                    "competitorAsins": params.get("competitorAsins") or [],
                    "reviewsPerStar": params.get("reviewsPerStar"),
                    "useCache": params.get("useCache"),
                    "status": "running",
                    "stage": "fetch_competitor",
                    "stageLabel": STAGE_LABELS["fetch_competitor"],
                    "progress": 0,
                    "logs": [],
                    "error": None,
                }
            self._save()

    def _save(self, critical: bool = False) -> None:
        """写 status.json;失败不抛(记 stderr + last_save_error),数据保留在内存,
        下一次任意状态写入会连同本次未落盘的内容一起重写。

        critical=True(finish/fail 终态写):额外做长退避重试,尽最大努力
        避免 run 永久卡在 running(否则前端将一直轮询)。"""
        attempts = 10 if critical else 1
        for i in range(attempts):
            try:
                write_json(status_path(self.run_id), self._data)
                self.last_save_error = None
                return
            except Exception as e:  # noqa: BLE001
                self.last_save_error = str(e)
                if i < attempts - 1:
                    time.sleep(0.5)
        print(f"[store] 警告: status.json 写入失败 run={self.run_id}: "
              f"{self.last_save_error}", file=sys.stderr)

    def get(self, key: str, default=None):
        with self._lock:
            return self._data.get(key, default)

    def params(self) -> dict:
        with self._lock:
            return {
                "market": self._data.get("market"),
                "myAsin": self._data.get("myAsin"),
                "competitorAsins": list(self._data.get("competitorAsins") or []),
                "reviewsPerStar": self._data.get("reviewsPerStar") or 20,
                "useCache": self._data.get("useCache", True),
            }

    def log(self, msg: str) -> None:
        with self._lock:
            self._data["logs"].append({
                "ts": _dt.datetime.now().isoformat(timespec="seconds"),
                "msg": str(msg),
            })
            # 日志过长时保尾部
            if len(self._data["logs"]) > 500:
                self._data["logs"] = self._data["logs"][-400:]
            self._save()

    def set_stage(self, stage: str, progress: Optional[int] = None) -> None:
        with self._lock:
            self._data["stage"] = stage
            self._data["stageLabel"] = STAGE_LABELS.get(stage, stage)
            if progress is not None:
                self._data["progress"] = max(int(progress), int(self._data.get("progress") or 0))
            self._save()

    def set_progress(self, progress: int) -> None:
        with self._lock:
            self._data["progress"] = max(int(progress), int(self._data.get("progress") or 0))
            self._save()

    def restart(self) -> None:
        """rebuild 时重置状态。"""
        with self._lock:
            self._data["status"] = "running"
            self._data["error"] = None
            self._data["progress"] = 0
            self._save()

    def finish(self) -> None:
        with self._lock:
            self._data["status"] = "done"
            self._data["progress"] = 100
            self._data["error"] = None
            self._save(critical=True)

    def fail(self, error: str) -> None:
        with self._lock:
            self._data["status"] = "error"
            self._data["error"] = str(error)
            self._save(critical=True)
