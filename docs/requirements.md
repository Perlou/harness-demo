# Harness Demo 需求文档

## 1. 项目定位

`harness-demo` 是一个**教学导向的 SQL 查询助手**，用 CLI 形态承载，唯一目的是把 OpenAI 在 2026 年 2 月提出的 **Harness Engineering** 工程范式具象化为可运行、可审阅的代码与工件。

业务功能（自然语言 → SQL → 查询电商订单库）刻意保持简单。**主角是控制平面**：意图规范化、计划生成、Schema/Policy/Scenario 检查、人工审批门、轨迹工件。

## 2. 受众

- **内部工程师**：作为可落地的参考实现样板
- **外部读者**：作为快速理解 harness engineering 的最小可触摸 demo
- **教学场景**：作为分享、blog、内部讲座的演示素材

## 3. 核心目标

1. 在本地零依赖跑通完整 harness 生命周期（无需 OpenAI API key 即可演示全流程）
2. 让 `Intent → Plan → Check → Approve → Execute → Trace` 五个阶段在 CLI 输出和 `runs/<id>/` 工件中**清晰可见**
3. 同一套 pipeline 同时支持 Demo Mode（确定性）和 Live Mode（真调 OpenAI），证明"环境约束作用于规则系统和真实模型时是同构的"
4. `harness/` 目录下的契约、规则、模板**全部以数据文件形式存在**，不夹带业务代码
5. 每次运行产出 `runs/<id>/` 目录，作为 git 可追踪的运行工件

## 4. 非目标

- 不构建一个功能丰富的 SQL IDE
- 不模拟通用多智能体编排框架
- 不追求高性能 / 高并发
- 不依赖外部 API 才能跑通基本演示
- 不做花哨 UI；CLI + markdown 工件即可

## 5. 用户场景

### 场景 A：Happy Path（只读查询）

```
$ harness ask "上个月销售前 5 的产品"
```
系统行为：
1. 生成 IntentSpec（目标=聚合查询、风险=read）
2. 生成 Plan（包含一条 SELECT SQL）
3. Schema 检查通过 → Policy 检查通过 → Scenario 检查通过
4. 风险等级=read，自动审批通过
5. 执行 SQL，返回结果，写入 `runs/<id>/`
6. 终端输出查询结果摘要 + 工件路径

### 场景 B：Policy 拦截（PII 字段）

```
$ harness ask "导出所有客户的邮箱和手机号"
```
系统行为：
1. 生成的 SQL 引用 `customers.email` / `customers.phone`
2. `pii-fields.yaml` 规则识别为 PII 字段访问
3. Policy 检查失败，标记为 `rejected_by_policy`
4. 终端打印失败原因 + 工件路径
5. 不写入业务库，不进入 approval

### 场景 C：可修复拦截（缺时间范围）

```
$ harness ask "orders 表里有多少行"
```
系统行为：
1. 生成的 SQL 是 `SELECT COUNT(*) FROM orders`
2. `require-time-bounds.yaml` 规则要求 orders 表查询必须带 WHERE 时间过滤
3. Policy 检查失败，trace 给出修复建议
4. 用户重跑：`harness ask "过去 30 天 orders 表的行数"` → 通过

### 场景 D：写操作 + 审批门

```
$ harness ask "把已经发货 90 天还没确认收货的订单标记为已完成"
```
系统行为：
1. 生成的 Plan 含 UPDATE 语句
2. `destructive-needs-approval.yaml` 识别为写操作
3. 检查全部通过，但状态进入 `pending-approval`
4. `runs/<id>/report.md` 记录待批信息
5. 用户读完 report 后：
   ```
   $ harness approve <run-id>
   ```
   或
   ```
   $ harness reject <run-id> --reason "..."
   ```
6. 批准后才真正执行 UPDATE，写入 audit_log，提交事务

## 6. 功能需求

### F-1 CLI 命令集

| 命令 | 功能 |
|---|---|
| `harness ask "<问题>"` | 提交意图，跑 Intent → Plan → Check，最后写 `runs/<id>/`；只读动作直接执行；写动作进入待审批 |
| `harness approve <run-id>` | 批准并执行待审批的运行 |
| `harness reject <run-id> --reason "<理由>"` | 拒绝运行，记录理由 |
| `harness runs` | 列出所有运行（id、状态、意图摘要、时间） |
| `harness show <run-id>` | 打印 `runs/<id>/report.md` |
| `harness mode` | 显示当前模式（demo / live） |
| `harness seed` | 初始化 / 重置示例 SQLite 数据库 |

### F-2 双执行模式

- **Demo Mode**（默认）：planner 是确定性规则引擎，包含故障注入能力（让用户能稳定演示场景 B/C/D）
- **Live Mode**：通过 `HARNESS_MODE=live` 启用，调用 OpenAI API；输出必须满足相同的结构化契约

两种模式**共用同一套 pipeline 下游**（intent / schema / policy / scenario / approval / executor / trace 都不变）。

### F-3 控制平面工件

`harness/` 目录下必须有：

- `contracts/intent.schema.ts`——IntentSpec 的 Zod schema
- `contracts/plan.schema.ts`——Plan / SqlAction 的 Zod schema
- `contracts/evaluation.schema.ts`——EvaluationResult / TraceEvent 的 Zod schema
- `policies/pii-fields.yaml`——禁止 SELECT 的 PII 字段列表
- `policies/require-time-bounds.yaml`——必须带 WHERE 时间过滤的表
- `policies/destructive-needs-approval.yaml`——写操作清单
- `scenarios/row-budget.yaml`——单次查询行数上限
- `prompts/intent.tmpl`——Live Mode 意图规范化 prompt
- `prompts/planner.tmpl`——Live Mode plan 生成 prompt

**红线：`harness/` 下不允许出现业务逻辑代码。**

### F-4 运行工件

每次 `ask` 产生一个目录 `runs/<timestamp>-<short-id>/`，至少包含：

- `intent.json`——规范化后的 IntentSpec
- `plan.json`——生成的 Plan
- `evaluation.json`——三道检查的合并结果
- `report.md`——人类可读报告
- `trace.jsonl`——完整事件流
- `status`——单行文本：`pending-approval` / `approved` / `rejected` / `committed` / `failed`

`runs/` 目录默认 gitignore，但保留 `.gitkeep` 与一份示范运行（在文档里指引）。

### F-5 业务平面（Todo / SQL 库）

电商订单 SQLite 库，6 张表：

| 表 | 字段（关键） |
|---|---|
| `customers` | id, name, email (PII), phone (PII), created_at |
| `products` | id, name, sku, price, category |
| `orders` | id, customer_id, status, ordered_at, shipped_at, total |
| `order_items` | id, order_id, product_id, quantity, unit_price |
| `inventory` | product_id, on_hand, reserved, updated_at |
| `audit_log` | id, run_id, action, target_table, target_id, before_json, after_json, at |

种子数据：约 50 名客户、20 个产品、200 个订单、500 个订单项，覆盖最近 6 个月。

### F-6 反馈回路

- **Schema 检查失败**：写入 trace，标记 run 状态为 `rejected_by_schema`
- **Policy 检查失败**：trace 中包含规则 id、字段位置、修复建议（结构化）
- **Scenario 检查失败**：trace 中包含触发的 scenario 与具体阈值
- **审批拒绝**：保留原始 plan、保留拒绝理由
- **执行失败**：事务回滚，写入 `failed` 状态与错误明细

## 7. 非功能需求

| 维度 | 要求 |
|---|---|
| 可离线 | 默认模式不需要任何外部 API |
| 可重复 | Demo Mode 对同一输入产出稳定输出 |
| 可审阅 | 每次运行的工件可被 git diff 阅读 |
| 类型严格 | TypeScript strict 模式；契约用 Zod 双向（运行时 + 编译期） |
| 易上手 | 新用户从 clone 到看到第一份 trace 不超过 2 分钟 |
| 性能 | 单次 ask 延迟 < 1 秒（Demo Mode）；Live Mode 受 API 限制 |
| 测试覆盖 | 4 个出厂场景必须有端到端测试；每个 pipeline stage 必须有单元测试 |

## 8. 验收标准

项目交付完成的判定条件：

1. ✅ 新用户克隆仓库后，`pnpm install && pnpm seed && pnpm harness ask "..."` 可以跑通
2. ✅ 4 个出厂场景（happy / PII / fixable / approval）的演示脚本（`scripts/demo-walkthrough.sh`）一键运行无错
3. ✅ `harness/policies/` 全部为 yaml，删除任何一条规则后系统行为发生可观察变化
4. ✅ Demo Mode 与 Live Mode 共用同一套 pipeline；切换模式只改一个环境变量
5. ✅ 每次运行产生完整的 `runs/<id>/` 工件目录
6. ✅ `report.md` 不读源码就能看懂"这次发生了什么、为什么"
7. ✅ `tests/scenarios/` 下 4 个端到端测试全部通过
8. ✅ 文档（README、CONCEPT、architecture、requirements、roadmap）覆盖完整

## 9. 范围外（v1 不做）

- 多用户、并发运行
- 远程数据库（仅 SQLite 本地）
- Web UI / TUI
- 自定义 policy DSL（v1 用 yaml 即可）
- 多 LLM 提供方（v1 仅 OpenAI）
- 自动从历史 trace 学习规则
- 国际化（仓库默认中文）

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Demo Mode 被误认为"假 demo" | CONCEPT.md 明确说明它只是把 planner 替换为确定性实现，下游 pipeline 完全相同 |
| Live Mode API 失败导致演示中断 | 默认 Demo Mode；`scripts/demo-walkthrough.sh` 强制用 Demo Mode |
| Policy yaml 表达力不足 | v1 不引入 DSL；v1 规则范围有限可以全用静态字段匹配；后续如需要再升级 |
| 用户跳过 approval 直接读源码 | report.md 显式描述待审批项；`harness ask` 在终端打印阻塞提示 |
