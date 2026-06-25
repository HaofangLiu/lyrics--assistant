# 跟唱屏产品技术方案

## 产品定位

跟唱屏是一款面向驾驶场景的 Web App / PWA。用户打开应用后点击中间的大圆形按钮，应用通过麦克风采样当前车内播放的音乐，后端调用 ACRCloud 识别歌曲，然后前端展示大字号歌词，并在开启跟唱模式后自动检查下一首歌并切换歌词。

核心目标不是做播放器，而是做一个“车内音乐歌词屏”。

## 当前技术路线

```text
frontend/
  React + Vite + TanStack Router
  Web MediaRecorder 录音
  歌词展示、同步高亮、自动跟唱

backend/
  Python FastAPI
  ffmpeg 转码
  ACRCloud 识曲
  返回歌曲信息和播放 offset

docker-compose.yml
  frontend: Nginx 静态站点
  backend: FastAPI API
```

## 识曲链路

```text
用户点击开启跟唱
-> 浏览器请求麦克风权限
-> 前端录制 8-15 秒音频
-> POST /api/recognize
-> 后端用 ffmpeg 转为 flac
-> 后端签名调用 ACRCloud /v1/identify
-> 返回歌曲标题、歌手、时长、score、play_offset_ms
-> 前端优先用本地候选查询 LRCLIB
-> LRCLIB 未命中时，后端用 DashScope deepseek-v4-flash 生成歌手/歌名候选
-> 前端用 AI 候选再次查询 LRCLIB 并展示
```

## 为什么改用 ACRCloud

早期方案使用 AcousticID + Chromaprint，但真实测试发现它不适合车内麦克风采样识曲：

- 指纹生成可以跑通，但 AcousticID 对短片段/外放录音匹配率不稳定。
- AcousticID 更偏开放音乐指纹数据库，不是商业级“听歌识曲”服务。
- ACRCloud 更贴近当前产品目标，并且能返回 `play_offset_ms`，对歌词同步更有价值。

因此当前方案已移除 AcousticID/Chromaprint/fpcalc 代码，只保留 ACRCloud。

## 前端功能

- 首页：标题 + 居中大圆形"开启跟唱"按钮。
- 歌词页：大字号歌词、当前行高亮、手动快慢校准、自动跟唱开关。
- 自动跟唱：开启后根据当前歌曲时长，在接近结束时重新识曲；无歌曲时长时使用低频兜底检查。歌词页右上角可切换开关。
- 设置页：自动跟唱开关、采样时长（8/12/15 秒）、兜底检查间隔、歌词字号缩放、恢复默认。
- 屏幕常亮：歌词页通过 Wake Lock API 保持屏幕常亮，随"恢复默认"重置，当前未在设置页暴露独立开关。
- PWA：已配置 manifest 和 Service Worker，可通过浏览器自带机制添加到主屏幕；刻意不内置应用内安装引导 UI，保持代码精简。

## 后端功能

- `GET /health`：健康检查。
- `POST /api/recognize`：上传音频并识曲。
- `POST /api/lyrics/candidates`：LRCLIB 本地查询失败后，用 DashScope `deepseek-v4-flash` 清洗歌曲信息并返回搜索候选；不生成整首歌词。
- 环境变量读取 ACRCloud 和 DashScope 配置。
- `ffmpeg` 统一转码为 FLAC，提升浏览器录音兼容性；识曲链路为 ffmpeg→ACRCloud 直连，不做额外的音频探测步骤。
- ACRCloud HMAC-SHA1 签名和请求。
- 将 ACRCloud 结果映射成前端统一的 `RecognitionResult`。
- DashScope LLM 调用失败时静默返回空候选列表，前端降级为仅使用本地候选。

## 环境变量

```env
# ACRCloud 识曲
ACRCLOUD_HOST=
ACRCLOUD_ACCESS_KEY=
ACRCLOUD_ACCESS_SECRET=

# DashScope LLM 歌词搜索候选（留空则跳过 AI 候选）
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=deepseek-v4-flash

# CORS 允许来源，逗号分隔；生产环境应设为前端域名
CORS_ALLOW_ORIGINS=*

# 前端构建期变量
VITE_API_BASE_URL=/api
```

## Docker 部署

```bash
docker compose up --build
```

访问：

```text
http://127.0.0.1:8080
```

容器：

- `frontend`: Nginx 托管前端静态文件并代理 `/api`。
- `backend`: FastAPI + ffmpeg + ACRCloud。

## 后续重点

- 继续实测车内识别率，决定采样时长默认值。
- 用 ACRCloud `play_offset_ms` 优化歌词初始同步。
- 接入更稳定/合规的歌词源。
- AI 只做歌词搜索候选兜底，不生成完整版权歌词。
- 正式部署时将所有 key 保持在后端，不把密钥打进前端包。
