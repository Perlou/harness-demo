# Harness Demo 技术架构文档

## 1. 设计原则

本架构由三条原则驱动，所有结构选择都可回溯到这三条：

1. **控制平面与业务平面物理分离** — `harness/` 与 `src/db/` 互不感知
2. **约束以数据形态存在** — `harness/` 目录里只允许 schema、yaml、prompt 模板，不允许业务逻辑代码
3. **每次运行即工件** — `runs/<id>/` 是 git 可追踪的运行历史

---

## 2. 顶层架构图

```
                ┌────────────────── 用户 ──────────────────┐
                │      harness ask "<自然语言意图>"          │
                └──────────────┬───────────────────────────┘
                               │
                       ┌───────▼────────┐
                       │     CLI 入口    │
                       │   src/cli/*.ts  │
                       └───────┬────────┘
                               │
        ┌──────────────────────▼──────────────────────────┐
        │                Harness Pipeline                  │
        │              src/pipeline/engine.ts              │
        │                                                  │
        │   ┌──────────┐  ┌──────────┐  ┌──────────┐     │
        │   │  Intent  │─▶│  Planner │─▶│   Check  │     │
        │   └──────────┘  └────┬─────┘  └─────┬────┘     │
        │         ▲            │              │           │
        │         │            ▼              ▼           │
        │   ┌─────┴─────┐ ┌──────────┐  ┌──────────┐     │
        │   │  Prompts  │ │  Demo /  │  │ Schema / │     │
        │   │  intent   │ │  Live    │  │ Policy / │     │
        │   │  tmpl     │ │  Planner │  │ Scenario │     │
        │   └───────────┘ └──────────┘  └─────┬────┘     │
        │                                     │           │
        │                       ┌─────────────▼─────┐    │
        │                       │   Approval Gate   │    │
        │                       │ (low-risk: auto)  │    │
        │                       │ (high-risk: wait) │    │
        │                       └─────────┬─────────┘    │
        │                                 │              │
        │                                 ▼              │
        │                       ┌───────────────────┐    │
        │                       │     Executor      │    │
        │                       │  (transactional)  │    │
        │                       └─────────┬─────────┘    │
        │                                 │              │
        │  ┌───────── Trace Bus ──────────┼─────────┐   │
        │  │   每个阶段 emit TraceEvent     │         │   │
        │  └────────────────┬─────────────┴─────────┘   │
        └───────────────────┼──────────────────────────┘
                            ▼
            ┌───────────────────────────────────┐
            │      runs/<id>/                    │
            │   intent.json | plan.json |        │
            │   evaluation.json | report.md |    │
            │   trace.jsonl | status             │
            └───────────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────────┐
            │      Business DB (SQLite)          │
            │   customers / products / orders /  │
            │   order_items / inventory /        │
            │   audit_log                        │
            └───────────────────────────────────┘
```

---

## 3. 目录结构

```
harness-demo/
├─ harness/                                控制平面（数据 / 工件，无代码逻辑）
│  ├─ contracts/
│  │  ├─ intent.schema.ts                  Zod: IntentSpec / Goal / RiskLevel / Scope / TimeWindow
│  │  ├─ plan.schema.ts                    Zod: Plan / Action / SqlAction
│  │  ├─ evaluation.schema.ts              Zod: CheckFinding / CheckOutcome / EvaluationResult
│  │  │                                    + TraceEvent / TraceStage / RunStatus / isTerminal
│  │  ├─ index.ts                          re-export 总入口
│  │  └─ README.md                         契约语义边界 + 演进规则
│  ├─ policies/
│  │  ├─ pii-fields.yaml                   column-reference matcher
│  │  ├─ require-time-bounds.yaml          table-without-where matcher
│  │  ├─ destructive-needs-approval.yaml   statement-kind matcher
│  │  └─ README.md                         规则总结 + matcher 注册表
│  ├─ scenarios/
│  │  ├─ row-budget.yaml                   explain-row-estimate scenario
│  │  └─ README.md                         scenario 类型注册表
│  └─ prompts/
│     ├─ intent.tmpl                       占位（未来 LLM intent 用）
│     └─ planner.tmpl                      Live Mode plan 生成 prompt
│
├─ src/
│  ├─ pipeline/                            harness 引擎本体（薄壳，无业务规则）
│  │  ├─ engine.ts                         linear pipeline composition + finalize
│  │  ├─ context.ts                        RunContext 接口
│  │  ├─ intent.ts                         自然语言 → IntentSpec（detectCase 分类）
│  │  ├─ planner.ts                        Planner 协议 + dispatch（demo / live）
│  │  ├─ sqlInspect.ts                     正则 SQL 检查器（动词/表/列/WHERE/LIMIT）
│  │  ├─ schemaCheck.ts                    SQL vs sqlite_master 真 schema
│  │  ├─ policyCheck.ts                    加载 policies/*.yaml + matcher 注册表
│  │  ├─ scenarioEval.ts                   加载 scenarios/*.yaml + 行数探查
│  │  ├─ approval.ts                       决策表（auto / pending / rejected）
│  │  └─ executor.ts                       单事务执行 + audit_log + 回滚
│  ├─ planners/
│  │  ├─ cases.ts                          DemoCase 关键词探测器（intent 与 demo 共用）
│  │  ├─ demo.ts                           4 个出厂剧本 case-based dispatch
│  │  └─ live.ts                           OpenAI 适配器 + 测试钩子
│  ├─ db/
│  │  ├─ schema.sql                        6 张表 DDL
│  │  ├─ seed.ts                           Mulberry32 PRNG 确定性 seed
│  │  └─ client.ts                         better-sqlite3 单例
│  ├─ trace/
│  │  ├─ events.ts                         TraceEmitter + generateRunId
│  │  ├─ writer.ts                         RunArtifacts 工件门面
│  │  └─ report.ts                         report.md 渲染器（6 大节）
│  ├─ cli/
│  │  ├─ index.ts                          commander 入口（注册 7 个子命令）
│  │  ├─ ask.ts                            提交意图，跑 pipeline
│  │  ├─ approve.ts                        两阶段批准 + 重写 report.md
│  │  ├─ reject.ts                         强制 reason + 重写 report.md
│  │  ├─ runs.ts                           列出运行
│  │  ├─ show.ts                           打印 report.md（缺失时现场合成）
│  │  └─ seed.ts                           初始化数据库
│  └─ config.ts                            Zod 校验的 env config 单例
│
├─ runs/                                   运行工件（gitignored）
│  └─ .gitkeep
│
├─ tests/                                  98 个用例
│  ├─ contracts/                           契约 schema 单测
│  ├─ pipeline/                            阶段单测（含 sqlInspect / approval）
│  ├─ scenarios/                           e2e 剧本测试（含 _fixture.ts 工具）
│  ├─ db/                                  seed 确定性验证
│  └─ cli.smoke.test.ts                    config 加载冒烟
│
├─ docs/
│  ├─ requirements.md                      需求 / 用户场景 / 验收标准
│  ├─ architecture.md                      技术架构（本文档）
│  ├─ roadmap.md                           开发进度表
│  └─ deployment.md                        发布流程 + CI/CD 流水线
│
├─ scripts/
│  ├─ demo-walkthrough.sh                  一键跑完 4 个剧本 + approve
│  └─ reset.sh                             清 runs + 重建 SQLite
│
├─ .github/
│  └─ workflows/
│     ├─ ci.yml                            push & PR：typecheck/test/coverage + docker smoke
│     └─ release.yml                       v* tag：npm publish + GHCR multi-arch
│
├─ Dockerfile                              单阶段 node:20-slim + tsx runtime
├─ .dockerignore                           排除 node_modules / runs / data / docs / tests
├─ docker-compose.yml                      本地一键容器演示
├─ CONCEPT.md                              Harness Engineering 知识深入解析
├─ CLAUDE.md                               给 AI 协作者的工作约束
├─ README.md                               项目入口
├─ LICENSE                                 MIT
├─ package.json                            scoped npm 包定义 + scripts
├─ pnpm-lock.yaml
├─ tsconfig.json
├─ vitest.config.ts                        测试 + 覆盖率配置
├─ .env.example                            所有 runtime 旋钮
├─ .editorconfig
└─ .gitignore
```

---

## 4. Harness Pipeline 详细设计

### 4.1 Pipeline 形态

`engine.ts` 是一个**纯组合函数**，没有自己的业务规则：

```ts
async function run(rawInput: string, ctx: RunContext): Promise<RunResult> {
  const intent = await intentStage(rawInput, ctx)
  const plan = await plannerStage(intent, ctx)
  const evaluation = await checkStage(plan, ctx)
  if (!evaluation.passed) return finalizeRejected(evaluation, ctx)

  const decision = await approvalStage(plan, evaluation, ctx)
  if (decision === 'pending') return finalizePending(ctx)
  if (decision === 'rejected') return finalizeRejected(...)

  const result = await executor(plan, ctx)
  return finalizeCommitted(result, ctx)
}
```

每个 stage 满足：

- 输入：明确的 typed 对象（由 Zod schema 约束）
- 输出：明确的 typed 对象
- 副作用：仅向 trace bus emit 事件
- 不直接读写业务 DB，除了 executor

### 4.2 阶段契约（Zod schemas）

#### IntentSpec

```ts
export const IntentSpec = z.object({
  rawText: z.string(),
  goal: z.enum(['query', 'aggregate', 'export', 'mutate']),
  scope: z.object({
    tables: z.array(z.string()),
    timeWindow: z.object({ from: z.string(), to: z.string() }).optional(),
  }),
  assumptions: z.array(z.string()),
  riskLevel: z.enum(['read', 'write-low', 'write-high']),
  successCriteria: z.array(z.string()),
})
```

#### Plan

```ts
export const SqlAction = z.object({
  kind: z.literal('sql'),
  mode: z.enum(['read', 'write']),
  sql: z.string(),
  expectedColumns: z.array(z.string()).optional(),
  estimatedRows: z.number().optional(),
})

export const Plan = z.object({
  intentId: z.string(),
  steps: z.array(SqlAction),
  rationale: z.string(),
})
```

#### EvaluationResult

```ts
export const CheckFinding = z.object({
  ruleId: z.string(),
  level: z.enum(['error', 'warning']),
  message: z.string(),
  suggestion: z.string().optional(),
  location: z.string().optional(),
})

export const EvaluationResult = z.object({
  schemaCheck: z.object({ passed: z.boolean(), findings: z.array(CheckFinding) }),
  policyCheck: z.object({ passed: z.boolean(), findings: z.array(CheckFinding) }),
  scenarioCheck: z.object({ passed: z.boolean(), findings: z.array(CheckFinding) }),
  passed: z.boolean(),
})
```

#### TraceEvent

```ts
export const TraceEvent = z.object({
  ts: z.string(),
  runId: z.string(),
  stage: z.enum(['intent', 'plan', 'check', 'approve', 'execute', 'finalize']),
  kind: z.string(),
  payload: z.record(z.unknown()),
})
```

### 4.3 Planner Dispatch

```ts
interface Planner {
  generate(intent: IntentSpec, ctx: RunContext): Promise<Plan>
}
```

- `DemoPlanner` 实现 `Planner`，内部根据 IntentSpec.goal/scope 命中预设 case，可选触发故障注入
- `LivePlanner` 实现 `Planner`，调用 OpenAI Chat Completions（`response_format: json_schema`），生成结果用 Zod 校验

`config.ts` 根据 `process.env.HARNESS_MODE` 选择实现。

### 4.4 Check Stage（三道并联）

| 检查 | 实现方式 | 失败动作 |
|---|---|---|
| Schema | 解析 SQL（`@isaacs/sqlite-parser` 或自写 lite parser）→ 对照 SQLite `pragma_table_info` | 直接拒绝（`rejected_by_schema`） |
| Policy | 加载 `harness/policies/*.yaml`，对每条规则跑判定函数 | 拒绝 / 标记审批 |
| Scenario | `EXPLAIN QUERY PLAN` + 简单启发式（覆盖行数估算） | 拒绝 / 警告 |

三道检查独立运行（不短路），结果合并到一个 `EvaluationResult`。这样 trace 一次性看到所有问题。

### 4.5 Approval Stage

决策表：

| riskLevel | 检查全过 | 决策 |
|---|---|---|
| `read` | 是 | 自动通过 |
| `write-low` | 是 | 自动通过（v1 不区分 low/high；预留扩展点） |
| `write-high` | 是 | 进入 `pending-approval`，写工件，等命令 |

进入 pending 时，pipeline 在 `executor` 之前停止；`harness approve <id>` 命令重新加载 plan 并续跑 executor。

### 4.6 Executor

- 所有写操作在一个 `db.transaction()` 内执行
- 写动作之后追加一条 `audit_log` 记录（before/after JSON）
- 任何异常 → rollback → trace 写 `committed_failed` 事件

---

## 5. 控制平面工件规范

### 5.1 Policy yaml 形态

```yaml
# harness/policies/pii-fields.yaml
id: pii-fields
description: 禁止在 SELECT 中暴露 PII 列
applies_to:
  stages: [plan]
match:
  type: column-reference
  columns:
    - customers.email
    - customers.phone
on_match:
  decision: reject
  message: "字段 {column} 是 PII，不允许出现在 SELECT 中"
  suggestion: "改用 customers.id 或聚合后字段"
```

`policyCheck.ts` 解析这种 yaml 后映射到内置的几种 matcher（`column-reference` / `table-without-where` / `statement-kind` / `row-budget` 等）。
matcher 集合是封闭的；扩展需要先在 `policyCheck.ts` 注册新 matcher，再在 yaml 里使用——**这条边界保证 yaml 永远是数据，不是 DSL**。

### 5.2 Scenario yaml 形态

```yaml
# harness/scenarios/row-budget.yaml
id: row-budget
description: 单次查询估算行数上限
threshold:
  read: 10000
  write: 1000
on_exceed:
  decision: reject
  message: "估算返回 {rows} 行，超过 {threshold} 行上限"
```

### 5.3 Prompt 模板形态

```
# harness/prompts/planner.tmpl
你是一个只能输出结构化 JSON 的 SQL planner。
schema:
{{plan_schema}}

用户意图:
{{intent_json}}

数据库 schema:
{{db_schema}}

只输出符合 schema 的 JSON，不要解释。
```

模板由 `live.ts` 渲染并发送给 OpenAI；输出经过 Zod 校验，失败即 trace 事件 `live_planner_invalid_output` 并标记 run failed。

---

## 6. 运行工件规范

### 6.1 目录形态

```
runs/2026-05-01T10-42-13-r3k9/
├─ intent.json
├─ plan.json
├─ evaluation.json
├─ report.md
├─ trace.jsonl
└─ status
```

### 6.2 status 状态机

```
                  ┌─→ rejected_by_schema  (终态)
                  │
                  ├─→ rejected_by_policy  (终态)
                  │
created ─→ checked├─→ rejected_by_scenario(终态)
                  │
                  ├─→ pending-approval ─→ approved ─→ committed (终态)
                  │                    └→ rejected  (终态)
                  └─→ auto-approved ─→ committed             (终态)
                                    └→ committed_failed     (终态)
```

### 6.3 report.md 模板

```markdown
# Run <id>

**Status**: <status>
**Mode**: demo | live
**Created**: <ts>

## Intent
> <rawText>

- Goal: <goal>
- Risk: <riskLevel>
- Scope.tables: <tables>
- Assumptions:
  - ...

## Plan
```sql
<sql>
```
Rationale: <text>

## Evaluation
- Schema: PASS | FAIL — <findings>
- Policy: PASS | FAIL — <findings>
- Scenario: PASS | FAIL — <findings>

## Decision
- <auto-approved | pending-approval | rejected | committed | failed>

## Result
<rows preview | error | "awaiting approval">
```

---

## 7. 业务平面（DB）

### 7.1 表

详见 `requirements.md §F-5`。Schema DDL 落在 `src/db/schema.sql`。

### 7.2 Seed 策略

`src/db/seed.ts` 用确定性随机种子生成数据，使得：
- 每次 `harness seed` 输出完全一致
- "上个月销售前 5"在 seed 完成后总是能命中 happy path

---

## 8. Trace 设计

### 8.1 事件总线

`trace/events.ts` 暴露 `emit(event: TraceEvent)`；engine 在每个阶段切换、每次检查、每次决策处都 emit 一个事件。

### 8.2 写入器

`trace/writer.ts`：
- 接收事件流，appendOnly 写到 `runs/<id>/trace.jsonl`
- run 结束时合成 `report.md`（基于 trace + intent + plan + evaluation）

### 8.3 事件 kind 清单

```
intent.received
intent.normalized
plan.requested
plan.generated
plan.invalid_structure         ← Live Mode 专属
check.schema.started
check.schema.passed | check.schema.failed
check.policy.started
check.policy.passed | check.policy.failed
check.scenario.started
check.scenario.passed | check.scenario.failed
approval.required
approval.auto_granted
approval.user_approved
approval.user_rejected
execute.started
execute.committed
execute.rolled_back
finalize.<status>
```

---

## 9. 模式切换

### 9.1 Demo Mode

- 默认；`HARNESS_MODE=demo` 或不设置
- `DemoPlanner` 内部维护一个 case 表，按 IntentSpec 的 (goal, scope.tables, keyword) 命中
- 故障注入：`scripts/demo-walkthrough.sh` 通过特定输入触发预设故障路径

### 9.2 Live Mode

- `HARNESS_MODE=live` 启用
- 必需 `OPENAI_API_KEY`
- `LivePlanner.generate()` 流程：
  1. 加载 `prompts/planner.tmpl`
  2. 注入 schema、intent、db schema
  3. 调用 OpenAI（`response_format: json_schema`，附 Plan schema）
  4. 用 Zod 校验返回；不合法 → trace `plan.invalid_structure` → run 标 failed
- **下游 pipeline 完全不变** — schema / policy / scenario / approval / executor 都是同一份代码

---

## 10. 测试架构

### 10.1 阶段单测（`tests/pipeline/`）

每个 pipeline 阶段一个测试文件，断言：
- 合法输入 → 合法输出
- 非法输入 → 明确错误事件
- 副作用仅限 trace（mock trace bus 验证）

### 10.2 端到端剧本（`tests/scenarios/`）

4 个文件对应 4 个出厂场景，断言：
- 终态 status 正确
- `runs/<id>/` 工件结构完整
- trace 事件序列与预期一致
- 业务 DB 状态变化（或不变化）符合预期

### 10.3 Live Mode 测试

不在默认 CI 跑（依赖外部 API）。提供 `pnpm test:live` 走真实 API；提供 fixture-based 测试（mock OpenAI 响应）确保 LivePlanner 的解析路径正确。

---

## 11. 配置

`.env.example`：

```
HARNESS_MODE=demo
OPENAI_API_KEY=
HARNESS_RUNS_DIR=./runs
HARNESS_DB_PATH=./data/demo.sqlite
HARNESS_ROW_BUDGET_READ=10000
HARNESS_ROW_BUDGET_WRITE=1000
```

`config.ts` 用 Zod 解析 env 并提供 typed config 单例。

---

## 12. 错误处理与可观察性

| 失败类型 | 处理 |
|---|---|
| Schema check 失败 | run 标记 `rejected_by_schema`，仍写 `runs/<id>/`，CLI 退出码 1 |
| Policy 失败 | 同上，标记 `rejected_by_policy` |
| Scenario 失败 | 同上，标记 `rejected_by_scenario` |
| 审批超时 | v1 不实现自动超时；运行长期 pending |
| 执行抛错 | 事务回滚 + `committed_failed` |
| Live Mode 输出无效 | `plan.invalid_structure` 事件 + run failed；不重试（v1） |
| `runs/` 写盘失败 | fail-fast，CLI 退出码 2 |

---

## 13. 性能与扩展

- 单次 Demo Mode `ask` 目标 < 1 秒
- 单次 Live Mode `ask` 目标 < 5 秒（受 API）
- v1 不做并发——一个 CLI 进程一次一个 run
- `runs/` 数量增长由用户管理；`harness runs --prune` 在 v2 引入

---

## 14. 安全考虑

- `.env` 进 gitignore
- Live Mode 的 API key 永不写入 trace
- SQL 通过 better-sqlite3 prepared statement 执行
- yaml 加载用 `js-yaml` safeLoad
- 审批命令检查 run 状态防止重放（已 committed 不能再 approve）

---

## 15. 发布管线（CI/CD）

发布与运行时使用相同的"声明式工件"理念 —— `.github/workflows/*.yml` 与
`harness/policies/*.yaml` 在范式上同构：都是把"系统该做什么决定"显式写
进仓库。本节描述发布管线的形态，详细操作手册在
[`docs/deployment.md`](./deployment.md)。

### 15.1 分发产物

两种形态，覆盖 99% 安装场景：

- **npm 全局包**：`@your-scope/harness-demo`，scoped 公开，含 `bin/harness`
  入口。`pnpm publish` 走 OIDC + provenance attestation。
- **Docker 镜像**：`ghcr.io/<owner>/harness-demo`，多架构（linux/amd64 +
  linux/arm64）。镜像内 `tsx` 直接跑 TS 源码，避免编译路径解析问题。

单文件二进制曾在最初设想中，因 better-sqlite3 native 模块与 bun --compile
的虚拟文件系统不兼容而放弃。决策原委见 `docs/deployment.md`。

### 15.2 两条 GitHub Actions

```
.github/workflows/
├─ ci.yml          push & PR 触发
└─ release.yml     push v* tag 触发
```

#### ci.yml（每次 PR / push）

两个并行 job，让 main 分支永远是绿的：

```
test                          docker-smoke
─────                         ────────────
pnpm install --frozen-lockfile  docker buildx build (amd64, no push)
pnpm typecheck                  docker run mode    → "demo"
pnpm test:coverage              docker run --help  → not crash
upload coverage artifact        docker run seed    → fixture loaded
```

#### release.yml（push v* tag）

```
push tag v0.1.1
       │
       ▼
  ┌─────────┐
  │  check  │   typecheck + test，gate
  └────┬────┘
       │
       ▼
  ┌──────────────────┐
  │  verify-version  │   tag (去 v 前缀) === package.json.version
  └────┬─────────────┘
       │
       ▼
 ┌───────┐  ┌─────────┐
 │  npm  │  │ docker  │   并行
 └───┬───┘  └────┬────┘
     │           │
     └─────┬─────┘
           ▼
      ┌─────────┐
      │ release │   git log → RELEASE_NOTES.md → GitHub Release
      └─────────┘
```

### 15.3 一次性准备

发布前要做的事（详见 `docs/deployment.md` §发布流程）：

1. 把 `package.json` 里 `@your-scope` 替换成真正的 npm scope
2. GitHub 仓库 Secrets 加 `NPM_TOKEN`（npm Automation token）
3. Settings → Actions → Workflow permissions 设为 *Read and write*

### 15.4 常规发版

```bash
pnpm version patch           # bump + commit + git tag
git push --follow-tags       # 触发 release.yml
```

完成后：
- `https://www.npmjs.com/package/@your-scope/harness-demo` 出现新版本
- `ghcr.io/<owner>/harness-demo:0.1.1` 可被 pull
- GitHub Releases 页面新增带 changelog 的 Release

### 15.5 教学呼应

`harness/policies/*.yaml`（业务控制平面）与 `.github/workflows/*.yml`
（发布控制平面）在范式上等价：

| 维度 | policies/ | workflows/ |
|---|---|---|
| 形态 | 声明式 yaml | 声明式 yaml |
| 解释器 | `policyCheck.ts` 中封闭注册表 | GitHub Actions runtime |
| 改一行 yaml 的影响 | 系统业务行为变化 | 系统发布行为变化 |
| 演化史 | git log on `policies/` | git log on `workflows/` |
| 工程师价值 | 写规则 | 写流水线 |

这两层加起来构成完整的"控制平面"，是 harness engineering 三条核心
理念在不同抽象层次的一致呈现。
