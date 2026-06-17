# 跟唱屏

面向车载跟唱场景的 Web App。前端负责录音和歌词展示，Python 后端负责调用 ACRCloud 识曲。

## 项目结构

```text
lyrics-assistant/
  frontend/              # React + Vite + TanStack 前端
    src/
    public/
    Dockerfile
    docker/nginx.conf
    package.json
  backend/               # Python FastAPI 后端
    app/
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

- `frontend`: Nginx 静态站点，监听 `8080`
- `backend`: FastAPI API，监听 `8000`
- `POST /api/lyrics/candidates`: LRCLIB 本地查询失败后，调用 DashScope `deepseek-v4-flash` 生成歌手/歌名候选；不生成整首歌词。