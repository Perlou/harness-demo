# 部署 / 发布指南

这份文档面向两类读者：

- **使用者**：想装上跑（§ [安装](#安装)、§ [Docker 用法](#docker-用法)）
- **维护者**：想发布新版本（§ [发布流程](#发布流程)、§ [CI/CD 流水线](#cicd-流水线)）

---

## 安装

`harness-demo` 提供两种发布形态：**npm 全局包** 与 **Docker 镜像**。两者
功能完全一致，差别只在你想不想本机有 Node 环境。

### 选项 A：npm 全局安装（需要 Node 20+）

```bash
npm install -g @your-scope/harness-demo
# 或 pnpm add -g @your-scope/harness-demo
# 或 yarn global add @your-scope/harness-demo
```

装完后直接：

```bash
harness --help
harness seed
harness ask "上个月销售前 5 的产品"
```

数据落到当前目录的 `./data/demo.sqlite` 与 `./runs/`，可以通过环境
变量 `HARNESS_DB_PATH` / `HARNESS_RUNS_DIR` 改路径。

### 选项 B：Docker（不依赖宿主机 Node）

```bash
docker pull ghcr.io/your-scope/harness-demo:latest

docker run --rm ghcr.io/your-scope/harness-demo:latest --help

docker run --rm \
  -v "$PWD/data:/app/data" \
  -v "$PWD/runs:/app/runs" \
  ghcr.io/your-scope/harness-demo:latest seed

docker run --rm \
  -v "$PWD/data:/app/data" \
  -v "$PWD/runs:/app/runs" \
  ghcr.io/your-scope/harness-demo:latest ask "上个月销售前 5 的产品"
```

镜像支持 `linux/amd64` 与 `linux/arm64`，覆盖 Intel 服务器、Apple Silicon
本机、ARM 服务器三类宿主。

### 选项 C：本地仓库 + docker-compose（最适合演示）

```bash
git clone <repo-url> harness-demo
cd harness-demo
docker compose run --rm harness mode    # → demo
docker compose run --rm harness seed
docker compose run --rm harness ask "..."
```

`docker-compose.yml` 已经做好 volume 挂载与环境变量透传。Live Mode：

```bash
HARNESS_MODE=live OPENAI_API_KEY=sk-xxx \
  docker compose run --rm harness ask "..."
```

---

## Docker 用法

### 镜像 tag 含义

| Tag | 含义 |
|---|---|
| `latest` | 最近一次发布 |
| `0.1.0` | 精确版本（推荐生产引用） |
| `0.1` | 当前 minor 的最新 patch |
| `0` | 当前 major 的最新 minor |

精确版本保证可重现；`latest` 用于"试试看"。

### 必需的 volume

容器内有两条数据写入路径：

| 容器路径 | 内容 | 是否需要持久化 |
|---|---|---|
| `/app/data` | SQLite 数据库（`demo.sqlite`） | 是（否则每个容器都是空库） |
| `/app/runs` | 每次运行的 trace / report 工件 | 看你 |

### 环境变量透传

镜像识别这些 env：

```
HARNESS_MODE                demo (默认) | live
OPENAI_API_KEY              live 模式必填
HARNESS_LIVE_MODEL          默认 gpt-4o-mini
HARNESS_RUNS_DIR            默认 /app/runs
HARNESS_DB_PATH             默认 /app/data/demo.sqlite
HARNESS_ROW_BUDGET_READ     默认 10000
HARNESS_ROW_BUDGET_WRITE    默认 1000
```

---

## 二进制分发为什么没有？

最初的方案里包括了 `bun build --compile` 产出的单文件二进制。落地时
发现：本项目的 `better-sqlite3` 是 native 模块，bun 编译后的虚拟文件
系统找不到对应的 `.node` 文件，导致 `seed` / `ask` 等所有用到 DB 的
命令都崩。

不做的理由：
- 改造方案要么把 DB 层切到 `bun:sqlite`（破坏 npm 路径上的 better-sqlite3
  生态）、要么切到 `sql.js`（性能损失大）、要么写 runtime 分流 adapter
  （引入永久维护负担）
- "下载二进制直接跑"对一个 SQL CLI 教学 demo 不是核心体验
- npm 与 Docker 已经覆盖了 99% 的安装场景

未来若要重启二进制方案，建议先评估 Node SEA（Single Executable
Applications）是否对 better-sqlite3 这类 native 依赖有更友好的支持。

---

## 发布流程（维护者）

### 一次性准备

发布到 npm 公共 registry 前，需要做几件事：

1. **替换 npm 包名占位符**

   `package.json` 当前 `name` 是 `@your-scope/harness-demo`。把
   `@your-scope` 替换成你真正持有的 npm scope（个人 username 或组织名）。
   `repository` / `homepage` / `bugs` 里的 GitHub URL 同步替换。

   ```bash
   # 例如把所有 @your-scope 替换为 @perlou
   sed -i '' 's|@your-scope|@perlou|g' package.json
   sed -i '' 's|your-scope/harness-demo|perlou/harness-demo|g' package.json
   ```

2. **登录 npm（一次性）**

   ```bash
   npm login
   ```

3. **配置 GitHub Secrets**

   仓库 Settings → Secrets and variables → Actions：

   | Secret | 用途 | 获取方式 |
   |---|---|---|
   | `NPM_TOKEN` | release.yml 用来 publish | https://www.npmjs.com/settings/<你的用户名>/tokens 创建一个 *Automation* token |

   `GITHUB_TOKEN` 是 GitHub Actions 自动注入的，不需要手动配置；它是 GHCR
   推送的认证。

4. **首次发包**

   推荐先在本地 `npm publish --dry-run` 看看会发什么内容。npm 公共
   registry 上 scoped 包默认是 private 的，第一次会被 publish 拒绝；
   `package.json` 里已经写了 `publishConfig.access: public` 解决这个问题。

### 常规发版

```bash
# 1. 把当前 main 拉到最新，确认 CI 是绿的
git pull --ff-only

# 2. 更新版本号 + 自动 commit + 自动 git tag
pnpm version patch    # 0.1.0 → 0.1.1
# 或 pnpm version minor / pnpm version major

# 3. push commit + tag（一行命令）
git push --follow-tags

# 4. 静观其变
# release.yml 自动跑：check → verify-version → npm + docker → release
```

完成后：
- `https://www.npmjs.com/package/@your-scope/harness-demo` 上能看到新版本
- `ghcr.io/your-scope/harness-demo:0.1.1` 可被 pull
- GitHub Releases 页面新增一份带 changelog 的 Release

### 出错怎么办

| 症状 | 排查方向 |
|---|---|
| `verify-version` 失败 | tag 名（去 v 前缀）必须等于 package.json.version |
| `npm publish` 401 | NPM_TOKEN 过期或权限不足；`Automation` token 才能在 OIDC 环境用 |
| `npm publish` 403 | scope 没有 publish 权限，或包名已被占用 |
| GHCR push 403 | 仓库 Settings → Actions → Workflow permissions 改为 *Read and write* |
| 二维平台镜像构建慢 | docker buildx cache 第一次冷起，第二次会快很多 |

---

## CI/CD 流水线

仓库有两条 GitHub Actions：

```
.github/workflows/
├── ci.yml         push & PR 触发
└── release.yml    push v* tag 触发
```

### ci.yml（每次 PR / push 跑）

```
┌──────────────────────────┐  ┌────────────────────────┐
│ test                      │  │ docker-smoke            │
│ ─────                     │  │ ───────────             │
│ pnpm install              │  │ docker buildx build     │
│ pnpm typecheck            │  │   (linux/amd64, no push)│
│ pnpm test:coverage        │  │ docker run mode          │
│ upload coverage artifact  │  │ docker run --help        │
└──────────────────────────┘  │ docker run seed          │
                              └────────────────────────┘
```

跑得快（< 2 分钟），目的是**让 main 分支永远是绿的**：能编译、测试都过、
镜像能 build 且能跑。

### release.yml（push v* tag 才跑）

```
push tag v0.1.1
       │
       ▼
   ┌─────────┐
   │ check   │  typecheck + test，gate
   └────┬────┘
        │
        ▼
   ┌──────────────────┐
   │ verify-version    │  tag vs package.json
   └────┬─────────────┘
        │
        ▼
  ┌───────┐  ┌─────────┐
  │ npm   │  │ docker  │   并行
  └───┬───┘  └────┬────┘
      │           │
      └─────┬─────┘
            ▼
       ┌─────────┐
       │ release │  GitHub Release + auto changelog
       └─────────┘
```

四个 gate：任何一个挂掉，后续不跑。

### Workflow 文件本身就是 harness 工件

注意一件事：`.github/workflows/*.yml` 在这个项目里和 `harness/policies/*.yaml`
扮演相同的角色 —— 它们都是 **声明式工件**，把"系统该做什么决定"显式
写到仓库里。

- 改一行 yaml → 系统行为变化
- yaml 进 git → 行为演化史可被 review、被 diff、被 rollback

这个仓库的两个 yaml 目录加起来，构成了完整的"控制平面"：业务级控制
（policy）和发布级控制（workflow）。harness engineering 的核心主张
"约束即工件" 在这两层都成立。

---

## 观察

发布完成后，几条建议的观察路径：

```bash
# npm 上的版本与下载量
https://www.npmjs.com/package/@your-scope/harness-demo

# Docker 镜像与拉取量
https://github.com/your-scope/harness-demo/pkgs/container/harness-demo

# GitHub Release 与 changelog
https://github.com/your-scope/harness-demo/releases

# CI/CD 历史
https://github.com/your-scope/harness-demo/actions
```

---

## 演进方向

短期可考虑：
- 把 npm tarball 也作为 release 资产 attach（让没有 npm 的用户也能 download）
- ci.yml 加 `lint` step（eslint / prettier --check）
- 给 GHCR 镜像加 SBOM（`syft packages` + GitHub attestation）

中期：
- 真正的 SEA 二进制（Node 22+ 后 native 模块支持改善后再回头看）
- 在 Helm chart / Compose 模板里把 harness 当作一种"通用 agent runtime"

长期：
- 让 `runs/` 流到一个集中的查询层（Postgres / DuckDB），跨多次运行
  做模式分析
- 把 policy 演化和 model 升级也纳入 CI/CD（例如：升 `HARNESS_LIVE_MODEL`
  必须先在 staging 跑过 N 个 runs）
