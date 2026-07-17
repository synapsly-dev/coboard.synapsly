# 竞品分析看板 sidecar —— Python FastAPI + 静态前端(frontend/)
# 由 coboard 的 docker-compose 构建,仅在 compose 内网暴露 8916。
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

# 运行时数据(data/)由 compose 挂命名卷;密钥经环境变量注入,不进镜像。
EXPOSE 8916
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8916"]
