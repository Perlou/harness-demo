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
│  │  ├─ intent.schema.ts                  Zod: IntentSpec
│  │  ├─ plan.schema.ts                    Zod: Plan / SqlAction
│  │  ├─ evaluation.schema.ts              Zod: EvaluationResult / TraceEvent
│  │  └─ README.md
│  ├─ policies/
│  │  ├─ pii-fields.yaml
│  │  ├─ require-time-bounds.yaml
│  │  ├─ destructive-needs-approval.yaml
│  │  └─ README.md
│  ├─ scenarios/
│  │  └─ row-budget.yaml
│  └─ prompts/
│     ├─ intent.tmpl
│     └─ planner.tmpl
│
├─ src/
│  ├─ pipeline/                            harness 引擎本体
│  │  ├─ engine.ts                         linear pipeline composition
│  │  ├─ intent.ts                         自然语言 → IntentSpec
│  │  ├─ planner.ts                        IntentSpec → Plan（dispatch）
│  │  ├─ schemaCheck.ts                    SQL vs SQLite 真 schema
│  │  ├─ policyCheck.ts                    加载 policies/*.yaml 评估
│  │  ├─ scenarioEval.ts                   加载 scenarios/*.yaml + EXPLAIN
│  │  ├─ approval.ts                       写入 runs/<id>/，等待人工
│  │  └─ executor.ts                       事务执行 + 回滚
│  ├─ planners/
│  │  ├─ demo.ts                           确定性规则引擎 + 故障注入
│  │  └─ live.ts                           OpenAI 适配器
│  ├─ db/
│  │  ├─ schema.sql                        建表 DDL
│  │  ├─ seed.ts                           种子数据生成
│  │  └─ client.ts                         better-sqlite3 单例
│  ├─ trace/
│  │  ├─ events.ts                         TraceEvent 类型与 emitter
│  │  └─ writer.ts                         JSONL writer + report.md 合成
│  ├─ cli/
│  │  ├─ index.ts                          commander 入口
│  │  ├─ ask.ts
│  │  ├─ approve.ts
│  │  ├─ reject.ts
│  │  ├─ runs.ts
│  │  ├─ show.ts
│  │  ├─ mode.ts
│  │  └─ seed.ts
│  └─ config.ts                            mode、API key、阈值
│
├─ runs/                                   运行工件（gitignored）
│  └─ .gitkeep
│
├─ tests/
│  ├─ pipeline/                            阶段单测
│  ├─ scenarios/                           4 个端到端剧本测试
│  └─ fixtures/
│
├─ docs/
│  ├─ requirements.md
│  ├─ architecture.md
│  └─ roadmap.md
│
├─ scripts/
│  ├─ demo-walkthrough.sh                  一键跑完 4 个剧本
│  └─ reset.sh
│
├─ CONCEPT.md
├─ CLAUDE.md
├─ README.md
├─ package.json
├─ tsconfig.json
└─ .env.example
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
