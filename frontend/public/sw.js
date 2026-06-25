const VERSION = 'v2'
const SHELL_CACHE = `lyrics-assistant-shell-${VERSION}`
const ASSET_CACHE = `lyrics-assistant-assets-${VERSION}`
const APP_SHELL = ['/', '/manifest.webmanifest', '/app-icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  // 导航请求（HTML 文档）：network-first，确保用户拿到最新版本。
  // 仅在离线时回退到缓存的 index.html，避免部署后一直吃旧缓存。
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
    )
    return
  }

  // 静态资源（JS/CSS/图片等，Vite 构建带 hash）：cache-first。
  // hash 变了就是新文件，旧的自动不会命中，无需手动清理。
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached
      }

      return fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(() => cached)
    }),
  )
})
