# syntax=docker/dockerfile:1.7
#
# Harness Demo —— 用于本地试跑或一键演示的容器镜像。
#
# 设计取舍：
#   - 使用 debian-slim 而不是 alpine：better-sqlite3 v12 在 glibc 上有
#     prebuild，不需要源码编译；alpine (musl) 则会触发 node-gyp。
#   - 单阶段：保持镜像构建简单。runtime 也保留 tsx，让 CLI 入口直接跑
#     TypeScript 源码，避免编译步骤引入的路径解析问题（policies/scenarios
#     yaml 与 schema.sql 都通过 fileURLToPath 在源码相对位置查找）。
#   - 默认数据目录通过 VOLUME 暴露，便于 host 挂载持久化 runs/ 与 demo.sqlite。

FROM node:20-bookworm-slim

WORKDIR /app

# pnpm via corepack（Node 20 内置 corepack）
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# 先 copy 依赖清单以最大化构建缓存命中率
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 源码与控制平面工件
COPY tsconfig.json ./
COPY src ./src
COPY harness ./harness
COPY bin ./bin

# 默认数据目录（被 VOLUME 覆盖时用户自带的目录优先）
RUN mkdir -p /app/data /app/runs

ENV HARNESS_RUNS_DIR=/app/runs \
    HARNESS_DB_PATH=/app/data/demo.sqlite

# 显式声明 volume 让 host 挂载语义清晰
VOLUME ["/app/runs", "/app/data"]

# 元数据 —— OCI label 让 GHCR 上的镜像页能展示来源
LABEL org.opencontainers.image.title="harness-demo" \
      org.opencontainers.image.description="Teaching demo of OpenAI's Harness Engineering paradigm" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["pnpm", "--silent", "harness"]
CMD ["--help"]
