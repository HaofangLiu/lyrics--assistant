# 跟唱屏

面向车载跟唱场景的 Web App / PWA。前端负责录音、识曲触发和歌词展示，Python 后端负责调用 ACRCloud 识曲和 DashScope LLM 生成歌词搜索候选。

## 项目结构

```text
lyrics-assistant/
  frontend/              # React 19 + Vite + TanStack 前端
    src/
      app/               # providers、router
      components/        # AppShell、LyricsViewport、StatusPill
      features/          # lyrics / recognition / settings / singAlong / pwa / storage
      routes/            # HomeRoute、SongRoute、SettingsRoute
      styles/            # tokens.css、app.css
    public/              # manifest、service worker、app-icon
    docker/              # nginx.conf.template
    Dockerfile
    package.json
  backend/               # Python FastAPI 后端（单模块 app/main.py）
    app/
      main.py
    Dockerfile
    requirements.txt
  docker-compose.yml     # 本地/部署编排
  .env.example           # 环境变量模板
  .env.railway.example   # Railway 环境变量模板
  README.md
  RAILWAY_DEPLOYMENT.md
  PRODUCT_TECHNICAL_PLAN.md
```

我也建议保持这个结构：前后端边界清楚，根目录只负责说明、环境变量和 Docker 编排。

## 本地开发

安装前端依赖：

```bash
cd frontend
pnpm install
```

启动 Python 后端：

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

本机还需要安装 `ffmpeg`，用于把浏览器录音转成 ACRCloud 更稳定处理的音频格式。macOS 可以用：

```bash
brew install ffmpeg
```

另开一个终端启动前端：

```bash
cd frontend
pnpm dev
```

访问：

```text
http://127.0.0.1:5173
```

## Docker 启动

在项目根目录运行：

```bash
docker compose up --build
```

访问：

```text
http://127.0.0.1:8080
```

Docker 会启动两个服务：

- `frontend`: Nginx 静态站点，监听 `8080`，代理 `/api` 到 backend。
- `backend`: FastAPI + ffmpeg，监听 `8000`。

## 后端接口

- `GET /health`：健康检查，返回 `{"status":"ok"}`。
- `POST /api/recognize`：上传音频文件，ffmpeg 转码为 FLAC 后调用 ACRCloud 识曲，返回 `RecognitionResult`。
- `POST /api/lyrics/candidates`：传入歌曲元数据，调用 DashScope LLM 生成最多 5 条 LRCLIB 搜索候选（歌手/歌名清洗），不生成整首歌词。LLM 未配置或调用失败时返回空列表。