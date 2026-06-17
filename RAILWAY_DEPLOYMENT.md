# Railway 部署说明

这个项目在 Railway 上部署成两个服务：

```text
backend  -> Python FastAPI + ffmpeg + ACRCloud/DashScope
frontend -> React 静态站点 + Nginx
```

不要把密钥放到前端。ACRCloud 和 DashScope key 只配置在 backend 服务里。

## 1. 准备代码

把当前项目推到 GitHub。Railway 从 GitHub 仓库部署最省事。

## 2. 部署 backend 服务

在 Railway 新建 Project，选择 GitHub 仓库后创建第一个服务：

```text
Service name: backend
Root Directory: /backend
Builder: Dockerfile
```

给 backend 服务添加环境变量：

```env
RECOGNITION_PROVIDER=acrcloud
ACRCLOUD_HOST=identify-cn-north-1.acrcloud.cn
ACRCLOUD_ACCESS_KEY=你的 ACRCloud access key
ACRCLOUD_ACCESS_SECRET=你的 ACRCloud access secret

DASHSCOPE_API_KEY=你的 DashScope key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=deepseek-v4-flash

CORS_ALLOW_ORIGINS=*
```

部署完成后，在 backend 服务的 Networking / Public Networking 里生成公开域名。

打开下面地址验证：

```text
https://你的-backend-域名/health
```

正常返回：

```json
{"status":"ok"}
```

## 3. 部署 frontend 服务

在同一个 Railway Project 里再创建一个服务，仍然选择同一个 GitHub 仓库：

```text
Service name: frontend
Root Directory: /frontend
Builder: Dockerfile
```

给 frontend 服务添加环境变量：

```env
VITE_API_BASE_URL=https://你的-backend-域名/api
```

注意：`VITE_API_BASE_URL` 是前端构建期变量。改完以后必须重新部署 frontend。

部署完成后，在 frontend 服务的 Networking / Public Networking 里生成公开域名。

最终访问：

```text
https://你的-frontend-域名
```

## 4. 收紧 CORS

frontend 域名生成后，回到 backend 服务，把：

```env
CORS_ALLOW_ORIGINS=*
```

改成：

```env
CORS_ALLOW_ORIGINS=https://你的-frontend-域名
```

然后重新部署 backend。

## 5. 验证

访问 frontend 域名，点击“开启跟唱”。

如果浏览器请求麦克风，说明 HTTPS 和前端部署正常。

如果识曲失败，先看 backend 日志：

```text
Railway -> backend service -> Logs
```

重点看：

```text
Missing ACRCloud configuration
ACRCloud request failed
ACRCloud no match
Could not decode audio
```

## 6. 常见问题

### 前端打开后识曲请求失败

检查 frontend 的：

```env
VITE_API_BASE_URL
```

必须是 backend 公开域名加 `/api`，例如：

```env
VITE_API_BASE_URL=https://lyrics-backend.up.railway.app/api
```

### 页面能打开但没有麦克风权限

必须使用 Railway 的 HTTPS 域名访问，不能用 HTTP。

### 修改环境变量后没生效

重新部署对应服务。尤其是 frontend 的 `VITE_API_BASE_URL`，它是在构建时写进静态文件里的。

### 不要暴露哪些变量

这些只能放 backend：

```text
ACRCLOUD_ACCESS_KEY
ACRCLOUD_ACCESS_SECRET
DASHSCOPE_API_KEY
```

不要创建任何 `VITE_*_API_KEY`。
