# Changelog

记录每次发布的显著变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

每次发版的"机器生成"列表（git log）会写到 GitHub Release notes；本文件
只记录**人会回头读**的内容。

---

## [Unreleased]

待下一次 `pnpm version` 时归档。

---

## [0.1.0] · 首次发布

### 主线（M0–M10）

- 完整 Harness Engineering 五阶段 pipeline：Intent → Plan → Check → Approve → Execute → Trace
- 控制平面工件目录 `harness/`：Zod 契约 + 3 条 yaml policy + 1 个 scenario + 2 个 prompt 模板
- 业务平面：6 表电商 SQLite 库 + 确定性 seed（Mulberry32 PRNG，锚定时间）
- 双执行模式：Demo Mode（关键词分类 + case-based 出厂剧本）与 Live Mode
  （OpenAI Chat Completions + Plan zod 校验）共用下游 pipeline
- 4 个出厂剧本：happy path / PII 拦截 / 缺时间过滤 / 写操作 approval gate
- 7 个 CLI 子命令：`ask` / `approve` / `reject` / `runs` / `show` / `mode` / `seed`
- 两阶段审批：`approve` / `reject` 独立命令边界 + 防重放
- 运行工件：每次运行产出 `runs/<id>/`（intent.json / plan.json /
  evaluation.json / report.md / trace.jsonl / status / result.json）
- 一键演示脚本：`pnpm walkthrough`
- 98 个测试 / 整体覆盖率 93.89%

### Stage A · 发布管线（D0–D5）

- **Docker**：单阶段 `node:20-bookworm-slim` + tsx runtime；多架构（amd64 + arm64）
- **docker-compose**：本地一键容器演示，volume 挂载 + env 透传
- **npm 包**：`@your-scope/harness-demo` scoped 公开 + provenance attestation +
  files allowlist + `prepublishOnly` typecheck/test gate
- **CI**：`ci.yml` typecheck + test + coverage 上传 + Docker build smoke test
- **Release 工作流**：`release.yml` tag 驱动；check → verify-version →
  npm publish + GHCR multi-arch push → GitHub Release with auto-changelog
- **MIT LICENSE**

### 文档

- `CONCEPT.md`（1626 行）：Harness Engineering 从零深入解析（11 节）
- `docs/requirements.md`：需求 / 用户场景 / 验收标准
- `docs/architecture.md`：技术架构 15 节，含发布管线
- `docs/roadmap.md`：开发进度（M0–M10 + Stage A）
- `docs/deployment.md`：安装方式 / 发布流程 / CI/CD 流水线 / 出错排查
- `harness/contracts/README.md`、`harness/policies/README.md`、`harness/scenarios/README.md`
- `CLAUDE.md`：给 AI 协作者的工作约束
- `README.md`：项目入口 + 五分钟上手 + 安装

### 已知限制

- 单文件二进制（`bun --compile`）因 better-sqlite3 native 模块与 bun 虚拟
  文件系统不兼容而未发布；详见 `docs/deployment.md` §二进制分发为什么没有
- 多语言意图理解仅限关键词分类；真实 NLP 走 Live Mode 接 LLM
- v1 不实现审批超时、不实现并发、不做 `runs/` 自动归档

---

[Unreleased]: https://github.com/your-scope/harness-demo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-scope/harness-demo/releases/tag/v0.1.0
