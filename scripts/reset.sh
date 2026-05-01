#!/usr/bin/env bash
# 重置 demo 环境：删 runs/ 子项 + 删 SQLite + 重新 seed。
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

echo "→ 清理 runs/ 与 data/demo.sqlite*"
find runs -mindepth 1 -delete 2>/dev/null || true
touch runs/.gitkeep
rm -f data/demo.sqlite data/demo.sqlite-shm data/demo.sqlite-wal

echo "→ 重新 seed 数据库"
pnpm --silent harness seed
