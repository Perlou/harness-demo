# Harness Demo 开发进度表

本表按"先骨架后剧本、先离线后联网"的顺序组织里程碑。每个阶段都对应一个可演示的中间形态，避免到最后才能跑通。

---

## 阶段总览

| 阶段 | 主题 | 完成标志 |
|---|---|---|
| M0 | 项目脚手架 | `pnpm install` 成功，空 CLI 可被调用 |
| M1 | 业务平面（DB + seed） | `harness seed` 生成稳定 SQLite |
| M2 | 控制平面契约 | `harness/contracts/*.schema.ts` 完成，类型导出 |
| M3 | Pipeline 骨架 + Trace | 一个 Demo Planner 写死返回的 happy path 可跑完整 5 阶段，产出 `runs/<id>/` |
| M4 | Schema / Policy / Scenario 检查 | 所有 yaml 工件就位，三道检查独立可测 |
| M5 | Demo Planner 完整剧本 | 4 个出厂场景全部跑通 |
| M6 | 审批两阶段命令 | `ask` → `approve`/`reject` 流程跑通 |
| M7 | Report 渲染 | `report.md` 人类可读 |
| M8 | Live Mode | OpenAI 适配器完成，与 Demo Mode 共用下游 pipeline |
| M9 | 测试与文档收尾 | 4 个 e2e 测试 + 阶段单测全绿；README 与 CONCEPT 走查通过 |
| M10 | 演示打包 | `scripts/demo-walkthrough.sh` 一键跑完 |

---

## M0：项目脚手架

**目标**：把 Node + TypeScript + commander 跑起来，能 `harness --help`。

- [ ] `package.json`（pnpm workspace 不需要，单包）
- [ ] `tsconfig.json`（strict + ESM）
- [ ] `bin/harness` 入口（commander）
- [ ] `src/cli/index.ts` 注册子命令占位
- [ ] `src/config.ts` 用 Zod 解析 `.env`
- [ ] `.env.example`、`.gitignore`、`.editorconfig`
- [ ] `vitest.config.ts`
- [ ] CI（GitHub Actions）跑 `tsc --noEmit` + `vitest run`

**Done when**：`pnpm harness --help` 输出 `ask / approve / reject / runs / show / mode / seed`。

---

## M1：业务平面

**目标**：确定性 SQLite 数据库就位，`harness seed` 可重复执行。

- [ ] `src/db/schema.sql` — 6 张表 DDL
- [ ] `src/db/client.ts` — better-sqlite3 单例
- [ ] `src/db/seed.ts` — 用固定 seed 生成 50 customers / 20 products / 200 orders / 500 order_items / inventory / audit_log
- [ ] `src/cli/seed.ts` — `harness seed` 实现
- [ ] 单测：相同 seed 产出相同数据（行数、总和、最早/最新时间戳）

**Done when**：连续两次 `harness seed && sqlite3 demo.sqlite "select count(*) from orders"` 输出相同数字。

---

## M2：控制平面契约

**目标**：`harness/contracts/` 全部 Zod schema 就位，可被 src 各处 import。

- [ ] `harness/contracts/intent.schema.ts` — IntentSpec
- [ ] `harness/contracts/plan.schema.ts` — Plan / SqlAction
- [ ] `harness/contracts/evaluation.schema.ts` — EvaluationResult / CheckFinding / TraceEvent
- [ ] `harness/contracts/README.md` — 解释每个 schema 的语义边界
- [ ] 单测：每个 schema 的合法/非法样例

**Done when**：`pnpm tsc --noEmit` 通过；契约文件可作为 import source of truth。

---

## M3：Pipeline 骨架 + Trace

**目标**：一条最简单的 happy path 能从 `ask` 跑到 `runs/<id>/` 写出来；每个阶段都 emit trace。

- [ ] `src/trace/events.ts` — TraceEvent emitter
- [ ] `src/trace/writer.ts` — 写 `runs/<id>/trace.jsonl`
- [ ] `src/pipeline/intent.ts` — 占位实现：把 rawText 包进 IntentSpec（goal=query / risk=read）
- [ ] `src/planners/demo.ts` — 占位：返回固定 Plan（一条 SELECT 1）
- [ ] `src/pipeline/planner.ts` — dispatch（M3 阶段只有 demo 一种）
- [ ] `src/pipeline/schemaCheck.ts` `policyCheck.ts` `scenarioEval.ts` — 占位：直接 passed=true
- [ ] `src/pipeline/approval.ts` — 占位：read 自动通过
- [ ] `src/pipeline/executor.ts` — 执行 SQL，写 result
- [ ] `src/pipeline/engine.ts` — 串起来
- [ ] `src/cli/ask.ts` — 调用 engine

**Done when**：`harness ask "select 1"` 写出完整 `runs/<id>/` 目录，5 阶段事件全部出现在 trace.jsonl。

---

## M4：Schema / Policy / Scenario 检查

**目标**：三道检查是真实的，规则全部从 `harness/` 加载。

- [ ] `harness/policies/pii-fields.yaml`
- [ ] `harness/policies/require-time-bounds.yaml`
- [ ] `harness/policies/destructive-needs-approval.yaml`
- [ ] `harness/scenarios/row-budget.yaml`
- [ ] `harness/policies/README.md` — 规则的人类语言总结
- [ ] `src/pipeline/schemaCheck.ts` — 解析 SQL，对照 sqlite_master 的实际 schema
- [ ] `src/pipeline/policyCheck.ts` — 加载 yaml + matcher 注册表（column-reference / table-without-where / statement-kind）
- [ ] `src/pipeline/scenarioEval.ts` — `EXPLAIN QUERY PLAN` + 行数估算
- [ ] 单测：每条规则一个测试文件，覆盖命中和不命中
- [ ] 验证：删除任意 yaml 文件后行为发生可观察变化（在 README 中说明）

**Done when**：`tests/pipeline/` 下三道检查的单测全绿。

---

## M5：Demo Planner 完整剧本

**目标**：四个出厂场景在 Demo Mode 下稳定可跑。

- [ ] `src/planners/demo.ts` 重写为 case-based dispatch
  - [ ] 场景 A：`"上个月销售前 5"` → 合法 SELECT
  - [ ] 场景 B：`"导出客户邮箱"` → 故意生成含 `customers.email` 的 SELECT
  - [ ] 场景 C：`"orders 表有多少行"` → 故意生成无 WHERE 的 COUNT(*)
  - [ ] 场景 D：`"标记 90 天未确认订单为已完成"` → UPDATE
- [ ] 任何无法命中的输入返回保底 IntentSpec + 空 Plan + trace 一条 `plan.no_case_matched`
- [ ] `tests/scenarios/` 四个 e2e 测试

**Done when**：四个 e2e 测试全绿，且 `runs/<id>/status` 分别落到 `committed` / `rejected_by_policy` / `rejected_by_policy` / `pending-approval`。

---

## M6：审批两阶段命令

**目标**：写动作不会自动执行；`approve` / `reject` 命令独立工作。

- [ ] `src/pipeline/approval.ts` — write-high 风险写入 `pending-approval` 后停下
- [ ] `src/cli/approve.ts` — 读 `runs/<id>/`，校验 status=pending-approval，重新加载 plan，调用 executor
- [ ] `src/cli/reject.ts` — 强制 `--reason`，写入 trace，状态置 `rejected`
- [ ] `src/cli/runs.ts` / `src/cli/show.ts` — 列出与查看
- [ ] 防重放：已 committed/rejected 的 run 不能再次 approve
- [ ] 端到端测试：场景 D 的完整双阶段路径

**Done when**：`harness ask "<场景D>"` → `harness approve <id>` → audit_log 出现新记录；`harness approve <已 committed>` 报错。

---

## M7：Report 渲染

**目标**：`runs/<id>/report.md` 人类可读，不看源码也能理解每次运行。

- [ ] `src/trace/writer.ts` 在 finalize 时合成 report.md
- [ ] 模板涵盖：Intent / Plan / Evaluation 摘要 / Decision / Result
- [ ] CLI 输出尾部打印工件路径
- [ ] 单测：四个剧本的 report.md 包含预期片段（用 inline-snapshot）

**Done when**：把任意 run 的 report.md 拿给陌生人看，他能复述这次运行发生了什么。

---

## M8：Live Mode

**目标**：`HARNESS_MODE=live` 跑通真实 OpenAI；下游 pipeline 完全不变。

- [ ] `harness/prompts/intent.tmpl`
- [ ] `harness/prompts/planner.tmpl`
- [ ] `src/planners/live.ts` — 调用 OpenAI Chat Completions（`response_format: json_schema`）
- [ ] `src/pipeline/planner.ts` 增加 dispatch
- [ ] Live planner 输出 Zod 校验失败 → trace `plan.invalid_structure` → run failed
- [ ] `tests/planners/live.fixture.test.ts` — mock SDK 测试解析路径
- [ ] 可选：`pnpm test:live` 走真实 API（不进默认 CI）

**Done when**：同样的"上个月销售前 5"输入，Live Mode 走完整 pipeline，且 evaluation/approval/execute 阶段使用的是 M3-M6 同一份代码。

---

## M9：测试与文档收尾

**目标**：CI 全绿，文档可发布。

- [ ] `tests/pipeline/` 阶段单测覆盖率 ≥ 80%
- [ ] `tests/scenarios/` 4 个剧本端到端测试稳定
- [ ] README.md 走查：从 clone 到看到第一份 trace 不超过 2 分钟
- [ ] CONCEPT.md 校对
- [ ] requirements.md / architecture.md / roadmap.md 与代码对账（出现偏差就改文档）
- [ ] CLAUDE.md 走查：让 Claude 用这个文件能正确接手项目

**Done when**：CI 绿；陌生开发者按 README 能跑通 happy path 和 approval gate。

---

## M10：演示打包

**目标**：一键演示。

- [ ] `scripts/demo-walkthrough.sh`：依次跑四个场景，输出排版好的终端摘要 + 工件路径
- [ ] `scripts/reset.sh`：清 `runs/`、重建 SQLite
- [ ] 在 README 顶部加 demo 截图（终端输出 + report.md 片段）

**Done when**：`bash scripts/demo-walkthrough.sh` 一次跑完，stdout 输出可直接当 talk material。

---

## 工作量预估（参考）

| 阶段 | 估时（专注开发，单人） |
|---|---|
| M0 | 0.5 天 |
| M1 | 0.5 天 |
| M2 | 0.5 天 |
| M3 | 1 天 |
| M4 | 1.5 天 |
| M5 | 1 天 |
| M6 | 0.5 天 |
| M7 | 0.5 天 |
| M8 | 1 天 |
| M9 | 1 天 |
| M10 | 0.5 天 |
| **合计** | **~8.5 天** |

---

## 风险与依赖

| 风险 | 影响阶段 | 缓解 |
|---|---|---|
| SQL 解析复杂度（schemaCheck） | M4 | 用现成 parser；不行就用 better-sqlite3 prepared statement 的隐式校验兜底 |
| 行数估算不可靠 | M4 | scenario 阈值留宽；以"明显超限才拦"为目标 |
| OpenAI 输出格式不稳定 | M8 | 用 `response_format: json_schema`；失败立即 trace 错误，不无限重试 |
| yaml 表达力撑不住第 5 条规则 | 长期 | v1 不引入 DSL；新规则需求触发 matcher 扩展（在 README 里写明这条边界） |

---

## 完成定义

整个项目在以下条件全部满足时算交付：

1. ✅ `requirements.md §8` 列出的 8 条验收标准全部通过
2. ✅ `pnpm test` 全绿
3. ✅ `bash scripts/demo-walkthrough.sh` 一次成功跑完
4. ✅ README 顶部的"快速上手"五分钟内能复现
5. ✅ CONCEPT.md 与 architecture.md 在指向上没有矛盾
