# -*- coding: utf-8 -*-
"""配置加载:手写 .env 解析(不依赖 python-dotenv)。

- .env 位于项目根目录,含真实密钥,勿覆盖。
- 解析后注入 os.environ,但**不覆盖**已存在的进程环境变量。
"""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"

DATA_DIR = PROJECT_ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
RUNS_DIR = DATA_DIR / "runs"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

AMAZON_BASE = "https://www.amazon.com"


def load_env(path: Path = ENV_PATH) -> None:
    """解析 .env 并注入 os.environ(不覆盖已存在的进程变量)。"""
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # 去掉成对的引号
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


load_env()


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# LLM(智谱 GLM, OpenAI 兼容)
LLM_BASE_URL = env("LLM_BASE_URL")
LLM_API_KEY = env("LLM_API_KEY")
LLM_MODEL = env("LLM_MODEL", "glm-5.2")

# LinkFox Agent
LINKFOX_BASE_URL = env("LINKFOXAGENT_BASE_URL", "https://agent-api.linkfox.com")
LINKFOX_API_KEY = env("LINKFOXAGENT_API_KEY")

# 服务
HOST = "127.0.0.1"
PORT = 8916


def ensure_dirs() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


ensure_dirs()
