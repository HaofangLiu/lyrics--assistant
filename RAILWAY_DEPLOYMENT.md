# Railway 部署说明

这个项目在 Railway 上部署成两个服务：

```text
backend  -> Python FastAPI + ffmpeg + ACRCloud/DashScope
frontend -> React 静态站点 + Nginx
```

不要把密钥放到前端。ACRCloud 和 DashScope key 只配置在 backend 服务里。

> ⚠️ **务必启用防滥用。** backend 是公网可达的付费代理（每次识曲/歌词都消耗 ACRCloud 配额和 DashScope token）。
> 不加保护的话，任何人扫到域名就能写脚本把你的配额刷爆。本说明里的 `APP_ACCESS_TOKEN`（共享密钥）
> 和 `RATE_LIMIT_PER_MIN`（按 IP 限流）两步是**必做项**，不是可选项。
> 先生成一个随机 token 备用：`openssl rand -hex 24`。

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
ACRCLOUD_HOST=identify-cn-north-1.acrcloud.cn
ACRCLOUD_ACCESS_KEY=你的 ACRCloud access key
ACRCLOUD_ACCESS_SECRET=你的 ACRCloud access secret

DASHSCOPE_API_KEY=你的 DashScope key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=deepseek-v4-flash

# 防滥用（必做）
APP_ACCESS_TOKEN=刚才生成的随机串
RATE_LIMIT_PER_MIN=30

# 先临时用 *，第 4 步拿到前端域名后立刻收紧
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
VITE_APP_TOKEN=和 backend 的 APP_ACCESS_TOKEN 完全一致的那串
```

注意：`VITE_API_BASE_URL` 和 `VITE_APP_TOKEN` 都是前端**构建期**变量，会被打进静态文件。改完以后必须重新部署 frontend。两个 token 不一致的话，后端会对前端请求返回 401。

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

### 前端请求返回 401 / 429

`401` = 前端的 `VITE_APP_TOKEN` 和后端 `APP_ACCESS_TOKEN` 不一致（或前端改了 token 没重新部署）。
`429` = 触发了按 IP 限流，等一会儿或调高 backend 的 `RATE_LIMIT_PER_MIN`。

### 关于 VITE_APP_TOKEN 的安全边界

`VITE_APP_TOKEN` 会被打进前端静态文件，懂技术的人能从浏览器里读到它，所以它**不是强密钥**。
它的作用是挡住顺手刷和扫描器，真正兜底防刷的是 backend 的 `RATE_LIMIT_PER_MIN`。
如果要更强的保护，得给应用加真正的用户登录，这超出本说明范围。

### 不要暴露哪些变量

这些只能放 backend：

```text
ACRCLOUD_ACCESS_KEY
ACRCLOUD_ACCESS_SECRET
DASHSCOPE_API_KEY
APP_ACCESS_TOKEN
```

不要创建任何 `VITE_*_API_KEY`。
