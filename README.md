# harness-demo

> 一个用来理解 **Harness Engineering** 的最小可运行 demo。
> 业务功能故意保持简单（自然语言 → SQL → 查电商订单库），主角是控制平面。

**状态**：M0–M10 完成，93 个测试全绿，整体覆盖率 93.89%。

如果你想先理解概念，请直接读 [`CONCEPT.md`](./CONCEPT.md)。
如果你想理解这个仓库的结构和约束，请读 [`CLAUDE.md`](./CLAUDE.md) 与 [`docs/architecture.md`](./docs/architecture.md)。

---

## 它到底在演示什么

OpenAI 于 2026/2 提出 **Harness Engineering**：工程师不再写代码，而是**设计环境、明确意图、构建反馈回路**，让 AI 智能体可靠地完成工作。

这个 demo 把这套范式落地成一个 CLI：

```
harness ask "<自然语言问题>"
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ Intent  →  Plan  →  Check  →  Approve  →  Execute  →  Trace │
└─────────────────────────────────────────────────────────────┘
   ↓         ↓         ↓          ↓          ↓         ↓
  规范化    生成     三道并联     人工或     事务执行   工件落盘
            SQL      检查         自动                 runs/<id>/
```

每次运行都产出一个 `runs/<id>/` 目录，里面是 `intent.json`、`plan.json`、`evaluation.json`、`report.md`、`trace.jsonl`、`status` —— 这就是这次运行的工件，可以被 commit、被 review、被 diff。

---

## 五分钟上手

### 先决条件

- Node 20+
- pnpm

### 步骤

```bash
git clone <repo-url> harness-demo
cd harness-demo
pnpm install
pnpm seed                              # 生成示例 SQLite
pnpm harness ask "上个月销售前 5 的产品"  # 第一次完整运行
```

完成后看一下：

```bash
ls runs/                               # 你刚才的运行
cat runs/*/report.md | head -40        # 人类可读报告
cat runs/*/trace.jsonl | head          # 完整事件流
```

### 一键演示 4 个出厂剧本

```bash
pnpm walkthrough
```

会自动重置环境，依次跑 happy path / PII 拦截 / 缺时间过滤 / 写操作审批
4 个剧本，并演示 approve 流程。输出排版好可直接做 talk 材料。

---

## 四个出厂剧本

每个剧本都对应一份可被反复演示的 trace 工件。一键跑完：

```bash
pnpm walkthrough
```

或者手动一个一个跑：

### 剧本 A — Happy Path（read-only 自动放行）

```bash
pnpm harness ask "上个月销售前 5 的产品"
```
你会看到完整 5 阶段全绿，结果直接打印，状态 `committed`。

### 剧本 B — Policy 拦截：PII 字段

```bash
pnpm harness ask "导出所有客户的邮箱和手机号"
```
SQL 合法，但 `harness/policies/pii-fields.yaml` 把 `customers.email/phone` 标为 PII。状态 `rejected_by_policy`。报告里能看到具体规则 id 与字段位置。

### 剧本 C — 可修复的 Policy 拦截

```bash
pnpm harness ask "orders 表里有多少行"
```
`harness/policies/require-time-bounds.yaml` 要求 `orders` 表查询必须带时间范围。报告中包含修复建议。换成：

```bash
pnpm harness ask "过去 30 天 orders 表的行数"
```
就能通过。

### 剧本 D — 写操作 + Approval Gate

```bash
pnpm harness ask "把已经发货 90 天还没确认收货的订单标记为已完成"
```
这是一个 UPDATE，状态进入 `pending-approval`。读完 `runs/<id>/report.md` 后再决定：

```bash
pnpm harness approve <run-id>
# 或
pnpm harness reject  <run-id> --reason "范围太宽"
```

只有 `approve` 后业务 DB 才会被真正修改，并写入 `audit_log`。

---

## Live Mode（可选，需要 OpenAI API）

```bash
cp .env.example .env
# 在 .env 里填上 OPENAI_API_KEY
HARNESS_MODE=live pnpm harness ask "上个月销售前 5 的产品"
```

**关键点**：Live Mode 与 Demo Mode **共用 schema/policy/scenario/approval/executor 这一整条下游 pipeline**。Live Mode 真调 OpenAI 生成 plan，但下游约束完全不变 —— 这才是 demo 真正想说的事。

---

## 仓库结构

```
harness/         控制平面（数据 / 工件，无代码逻辑）
  contracts/     Zod schemas（IntentSpec / Plan / EvaluationResult / TraceEvent）
  policies/      yaml 规则（PII / 时间范围 / 写操作）
  scenarios/     yaml 场景检查（行数上限）
  prompts/       Live Mode 的 prompt 模板

src/
  pipeline/      harness 引擎（薄壳，linear pipeline）
  planners/      demo 与 live 两个 Planner 实现
  db/            业务平面 SQLite
  trace/         事件总线 + 工件写入
  cli/           commander 子命令

runs/            每次运行的工件（gitignored）
tests/           pipeline 单测 + 4 个剧本 e2e
docs/            requirements / architecture / roadmap
```

完整说明见 [`docs/architecture.md`](./docs/architecture.md)。

---

## 三条不可妥协的边界

1. `harness/` 下**只能放数据 / schema / 模板**，不能放业务逻辑代码
2. 业务 DB 写入**必须经过** `src/pipeline/executor.ts`
3. Demo Mode 与 Live Mode **共用下游 pipeline**，不允许为 Demo Mode 提供绕过路径

如果未来要往这个仓库提 PR，请先读 [`CLAUDE.md`](./CLAUDE.md)。

---

## 更多文档

| 文档 | 内容 |
|---|---|
| [`CONCEPT.md`](./CONCEPT.md) | Harness Engineering 从零开始的深入解析 |
| [`docs/requirements.md`](./docs/requirements.md) | 功能需求、用户场景、验收标准 |
| [`docs/architecture.md`](./docs/architecture.md) | 技术架构、目录结构、契约定义 |
| [`docs/roadmap.md`](./docs/roadmap.md) | 开发进度表（M0–M10） |
| [`CLAUDE.md`](./CLAUDE.md) | 给 AI 协作者的工作约束 |

---

## 许可

待定。
