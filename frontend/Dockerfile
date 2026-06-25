FROM node:24-alpine AS build

# Railway builds from overseas, so npmjs is the default.
# For domestic China/NAS builds, override with:
#   NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry "$NPM_CONFIG_REGISTRY" \
  && pnpm install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# 付费端点鉴权 token，须与 backend 的 APP_ACCESS_TOKEN 一致
ARG VITE_APP_TOKEN=
ENV VITE_APP_TOKEN=$VITE_APP_TOKEN

RUN pnpm build

FROM nginx:1.27-alpine

ENV PORT=80

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
