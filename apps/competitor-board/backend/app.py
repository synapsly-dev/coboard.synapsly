# -*- coding: utf-8 -*-
"""FastAPI 实例 + 路由(契约 §7)+ 静态托管 frontend/。

| GET  /                          | 静态 index.html(frontend/,check_dir=False 容忍目录未就绪)|
| POST /api/runs                  | 发起 run,后台线程执行 pipeline                              |
| GET  /api/runs                  | 运行列表(倒序)                                             |
| GET  /api/runs/{runId}/status   | 进度/日志                                                    |
| GET  /api/runs/{runId}/dashboard| Dashboard JSON;未完成 404 {"detail":"not ready"}           |
| POST /api/runs/{runId}/rebuild  | 用缓存原始数据重跑 LLM+组装(省 LinkFox 积分)               |
"""
import re
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import pipeline, store
from .config import FRONTEND_DIR

app = FastAPI(title="竞品分析看板 API", version="1.0")

# 仅允许本机看板同源访问;不需要凭据
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8916", "http://localhost:8916"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")


def _validate_run_id(run_id: str) -> str:
    """runId 白名单校验(格式与 store.new_run_id 一致);不匹配一律 404。"""
    if not store.is_valid_run_id(run_id):
        raise HTTPException(status_code=404, detail="run not found")
    return run_id


class RunRequest(BaseModel):
    market: str = Field(default="US")
    myAsin: str
    competitorAsins: List[str] = Field(default_factory=list)
    reviewsPerStar: int = 20
    useCache: bool = True


def _validate_asin(asin: str) -> str:
    asin = (asin or "").strip().upper()
    if not _ASIN_RE.match(asin):
        raise HTTPException(status_code=400, detail=f"非法 ASIN: {asin!r}")
    return asin


@app.post("/api/runs")
def create_run(req: RunRequest):
    my_asin = _validate_asin(req.myAsin)
    competitors = [_validate_asin(a) for a in req.competitorAsins if (a or "").strip()]
    if len(competitors) > 3:
        raise HTTPException(status_code=400, detail="竞品 ASIN 最多 3 个")
    # 去重(保序),防止重复 ASIN
    seen = {my_asin}
    competitors = [a for a in competitors if not (a in seen or seen.add(a))]
    params = {
        "market": (req.market or "US").strip().upper(),
        "myAsin": my_asin,
        "competitorAsins": competitors,
        "reviewsPerStar": max(1, min(int(req.reviewsPerStar or 20), 100)),
        "useCache": bool(req.useCache),
    }
    # 进程内同参幂等:同一组参数已有 running 的 run 时直接复用,不重复计费
    run_id, reused = pipeline.create_or_reuse_run(params)
    return {"runId": run_id, "reused": reused}


@app.get("/api/runs")
def list_runs():
    return store.list_runs()


@app.get("/api/runs/{run_id}/status")
def run_status(run_id: str):
    _validate_run_id(run_id)
    st = store.read_json(store.status_path(run_id))
    if st is None:
        raise HTTPException(status_code=404, detail="run not found")
    return {
        "runId": st.get("runId") or run_id,
        "status": st.get("status"),
        "stage": st.get("stage"),
        "stageLabel": st.get("stageLabel"),
        "progress": st.get("progress"),
        "logs": st.get("logs") or [],
        "error": st.get("error"),
    }


@app.get("/api/runs/{run_id}/dashboard")
def run_dashboard(run_id: str):
    _validate_run_id(run_id)
    if not store.run_exists(run_id):
        raise HTTPException(status_code=404, detail="run not found")
    dashboard = store.load_dashboard(run_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="not ready")
    return dashboard


@app.post("/api/runs/{run_id}/rebuild")
def rebuild_run(run_id: str):
    _validate_run_id(run_id)
    if not store.run_exists(run_id):
        raise HTTPException(status_code=404, detail="run not found")
    # 原子 compare-and-set(pipeline 锁内再次读 status),消除 TOCTOU 双跑
    if not pipeline.try_start_rebuild(run_id):
        raise HTTPException(status_code=409, detail="run is still running")
    return {"runId": run_id}


# 静态托管 frontend/(前端由并行 agent 开发;目录可能尚未就绪,check_dir=False 保证启动不炸)
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True, check_dir=False),
          name="frontend")
