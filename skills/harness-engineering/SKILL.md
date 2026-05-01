---
name: harness-engineering
description: Use when designing or building any system where an AI agent will take actions with real-world consequences (DB writes, external API calls, file operations, deployments, money movement, content publishing). Override the default "let the LLM just do it" instinct. Apply Intent → Plan → Check → Approve → Execute → Trace pipeline, constraints-as-data, and run-as-artifact patterns.
version: 1.0.0
license: MIT
---

# Harness Engineering

> 工程范式：工程师不再亲手写代码，而是设计环境、明确意图、构建反馈回路，
> 让 AI 智能体可靠地完成工作。一句话——**设计世界，而不是直接动手**。

## 何时调用本 skill

**应当**调用：

- 构建任何让 agent 写入 DB / 调外部 API / 操作文件系统 / 触发部署 /
  发邮件 / 移动资金 / 发布内容 等**有现实副作用**的系统
- 需要"高风险动作走人工确认"的工程场景
- 团队需要审计 agent 决策的可追溯性
- 想把"agent 行为约束"从代码挪到可被 review 的工件里
- 用户说："agent 直接动数据库我不放心" / "出错了能回溯吗" /
  "怎么让 LLM 输出可靠"

**不应**调用：

- 纯对话机器人（无副作用）
- 一次性文本生成（写诗、改写文案、翻译）
- 只读知识检索工具
- 简单的纯函数库
- 单步、低风险、可逆的动作（强行套 5 阶段是过度工程）

## 三条核心理念（红线）

### 理念 A · 仓库内工件就是事实来源

把"系统怎么决策"从代码 / 数据库 feature flag / 工程师脑子里的隐式规则 /
Slack thread 里的口头共识 —— **全部上移到仓库里成为显式工件**：

```
<project>/
  contracts/   输入输出契约（Zod / Pydantic / JSON Schema）
  policies/    声明式规则（yaml / json / TOML）
  prompts/     LLM 指令模板（templated 文本）
  scenarios/   状态相关的检查规则
  runs/        每次运行的工件目录（git 可追踪）
```

**判别标准**：删掉任意一份 yaml / 修改一份 prompt，**系统行为应当发生
可观察变化**。如果不变，规则没有真正被外化。

### 理念 B · 约束被编码为显式、可检查的规则

不确定性发生在 agent 内部，但 **agent 与世界之间的接口必须是确定的**。

具体落实：

1. agent 的输出**必须是结构化对象**，schema 在跨边界处守门
2. 决策规则**写在 yaml**，由代码里**封闭的 matcher 注册表**解释
3. 增加规则**只需新增 yaml 文件**，不需要改引擎代码
4. 高风险动作**强制阻塞**等待显式批准

### 理念 C · 工程师的高价值产出物在变化

| 旧 | 新 |
|---|---|
| 写出能跑的代码 | 设计能让 agent 写出的代码可靠运行的环境 |
| 处理 95% 输入的函数 | 拦下 5% 危险输入的 policy |
| 业务逻辑 | 契约 / 规则 / 反馈回路 / 审计工件 |

## 五阶段生命周期

任何 agent 工作都拆成五个明确阶段（外加 trace 贯穿全程）：

```
Intent → Plan → Check → Approve → Execute → Trace
```

### 1 · Intent（意图规范化）

- **输入**：用户的自然语言请求
- **输出**：结构化 `IntentSpec`，至少含
  - `goal` —— 业务目标类型（query / mutate / export / ...）
  - `scope` —— 涉及的资源 / 表 / 文件
  - `riskLevel` —— `read` / `write-low` / `write-high`
  - `assumptions` —— 系统做了哪些隐式假设（**这一字段是教学要点**）
  - `successCriteria` —— 成功的判断标准
- **关键**：`rawText` 字段仅用于展示，**任何下游 stage 不允许拿它做决策**

### 2 · Plan（计划生成）

- **输入**：IntentSpec
- **输出**：结构化 `Plan`，`steps[]` 是结构化对象——**禁止自由文本**
- **关键**：Plan 是**建议**不是**事实**。真正的写入要等到 Execute

### 3 · Check（三道并联检查）

```
              Plan
                │
  ┌─────────────┼──────────────┐
  ▼             ▼              ▼
Schema       Policy        Scenario
检查         检查           检查
（结构）     （规则）       （状态）
```

| 检查 | 关心 | 例子（具体业务自适配） |
|---|---|---|
| **Schema** | 结构是否合法 | 引用的表 / 列 / 字段 / 资源 ID 是否存在 |
| **Policy** | 是否违反显式规则 | PII 字段、写权限、白名单、必带某条件 |
| **Scenario** | 当前状态下是否合理 | 行数估算、副作用预测、跨资源依赖深度 |

**关键约束**：三道**独立运行不短路**，结果合并到一个 `EvaluationResult`，
trace 一次性看到所有问题。

### 4 · Approve（审批门）

决策表：

| 风险 / 检查 | 决策 |
|---|---|
| read 且检查全过 | 自动通过 |
| write-low 且检查全过 | 自动通过 |
| write-high 且检查全过 | **等待人工显式批准** |
| 检查未过 | 拒绝 |
| 任一 finding 标记 `requiresApproval: true` | 等待人工（policy 升级路径） |

**关键边界**：审批是**独立的命令边界**。不在原 ask 进程里阻塞等待 ——
两阶段命令（CLI: `ask` → `approve`）或两个 endpoint（HTTP: `POST /ask`
→ `POST /approve/:id`）让审批是显式动作，**留下"谁批了什么"的工件**，
**拒绝必须有理由字段**。

### 5 · Execute（执行）

- **必须事务性**：全部成功 OR 全部回滚
- **必须留 audit**：每条变更写一条 audit 记录（含 before/after JSON）
- **失败必须明确**：不允许静默吞异常，必须 emit 失败事件

### 6 · Trace（轨迹）

每个阶段切换 / 检查 / 决策都 emit 一个**结构化** TraceEvent：

```json
{
  "ts": "2026-05-01T...",
  "runId": "...",
  "stage": "check",
  "kind": "check.policy.failed",
  "payload": { "ruleId": "pii-fields", ... }
}
```

写到 `runs/<id>/trace.jsonl`，append-only。配合 `report.md` 合成给人读。

Trace 同时承担三种角色：**调试工具** / **审计工件** / **教学材料**。

## 控制平面四类工件

| 类别 | 形态 | 角色 |
|---|---|---|
| **Contracts** | Zod / Pydantic / JSON Schema 文件 | 定义输入输出形状 |
| **Policies** | 声明式 yaml | 静态规则（不依赖运行时状态） |
| **Scenarios** | 声明式 yaml + 状态查询 | 运行时状态相关规则 |
| **Prompts** | 模板文本 | LLM 指令（仅 LLM 模式需要） |

加上 `runs/<id>/` 这一类**运行工件**，构成完整的控制平面。

## 封闭 matcher 注册表（极重要）

yaml **只能引用代码中已注册的 matcher type**。这条边界保证 yaml 永远是
数据，不是 mini DSL。

```yaml
# 合法：引用已注册的 matcher
match:
  type: column-reference        # 必须在代码 matcher 注册表中已声明
  columns: [customers.email]
```

```yaml
# 反模式：在 yaml 里写表达式 / 条件
match:
  condition: "x.foo > 100 && y.bar == 'baz'"   # 这是在 yaml 里写代码
```

**判别标准**：扩展能力**先在解释器中注册新 matcher**，**再在 yaml 中使用**。

适用于不同业务的 matcher 例子（请按业务自定义）：

| 业务 | 可能的 matcher 类型 |
|---|---|
| SQL 助手 | column-reference / table-without-where / statement-kind / row-budget |
| 部署 bot | env-name / branch-name / time-window / rollout-stage |
| PR 审阅 | file-path-glob / line-count / has-tests / lgtm-on-protected |
| 客服退款 | amount-threshold / customer-blacklist / order-age |
| 文件整理 | path-glob / mime-type / age / size-budget |

## 模式双轨（同一下游证明）

当系统同时支持确定性 planner 和 LLM planner：

- 两种实现**共用同一套下游 pipeline**（Check / Approve / Execute / Trace）
- 只在 **Planner 这一层**换实现
- 这是 harness engineering "同一套环境同时约束规则系统和真实模型" 的
  **可执行证明**

**最强测试**：写一个测试，让假 LLM 故意输出违规内容（例如含 PII 的 SQL），
验证 Policy 照样拦下。这是范式落到位的最强信号。

## 反模式（红旗清单）

| 反模式 | 判别 | 修正方向 |
|---|---|---|
| 规则写在 if/else 里 | 删 yaml 行为不变 | 规则外化到 yaml |
| 审批是个 toast 弹窗 | 不阻塞、无理由记录 | 两阶段命令 + 强制 reason |
| Trace 只是 `logger.info()` | 字符串、非结构化 | 结构化事件 + JSONL append-only |
| Demo / mock 模式走特殊路径 | demo 跳过检查 | 共用下游 pipeline，仅换 Planner |
| yaml 里有表达式 | yaml 看着像代码 | matcher 注册表封闭 |
| Harness 包装一切动作 | 简单读也走 5 阶段 | 按风险分级，read 跳过 Approve |
| 契约只是 TS interface / dataclass | 看不到工件 | 专门 contracts/ 目录，schema 是文件 |

## 与相邻概念的边界

| 概念 | 关注 | 与 Harness 的关系 |
|---|---|---|
| Prompt Engineering | agent 内部 | **互补**（前者优化"输出正确"，本者优化"输出不正确时如何处理"） |
| Agent Framework（LangChain / AutoGen / CrewAI） | 多 agent 协作 | **独立**（不依赖任何 framework） |
| RAG | 让 agent 知道更多 | **互补** |
| Tool Use | 让 agent 能做更多 | **互补** |
| Guardrails | 内容层面过滤 | Harness 的**子集**（仅一道检查的一种） |
| MLOps | 模型生命周期 | **互补**（前者管训练 / 部署，本者管运行约束） |

## 启动新 harness 的检查清单

设计一个新的 harness 系统时，按顺序回答：

```
□ 谁是 agent？（规则引擎 / LLM / 多 agent / 用户输入加规则）
□ agent 的"动作空间"有哪些？
□ 哪些动作是高风险（必须人工 approve）？
□ IntentSpec / Plan / EvaluationResult 的字段长什么样？
   先写 schema 再写代码
□ 规则放哪里？（yaml 文件 + 代码里封闭的 matcher 注册表）
□ scenarios（状态相关检查）需要什么？
□ runs/<id>/ 目录里放哪些文件？
   intent / plan / evaluation / report / trace / status / result
□ 五阶段每个 stage emit 哪些事件 kind？（设计事件 taxonomy）
□ 审批走什么命令边界？
   CLI 两阶段 / HTTP 两 endpoint / GUI 两次提交
□ 模式策略：单 planner / 双 planner / 多 planner？
□ 验证：删任意一份 yaml，行为是否变化？
   如果不变，规则没有真正外化
```

## 反馈回路（让系统会学习）

三种典型回路：

### 回路 1 · 检查 → 修复 → 重试

agent 输出 → policy 拦下 → 把"为什么被拦下"作为**结构化反馈**喂回 agent →
agent 重写 → 再次进入 check。**关键约束**：必须有重试上限（典型 2-3 次），
否则陷入死循环。

### 回路 2 · 人工干预 → 学习

人审批 / 拒绝的决策 + 理由 → 写进 trace → 喂回下次 plan 的 prompt 上下文
OR 转写为新 policy。

### 回路 3 · 场景演化 → 规则演化

真实运行被 trace 记录 → 工程师 review → "这种情况下次该被自动拦下" →
转写为新 yaml 规则 → 部署后自动生效。

**这一回路里，工程师写的不是代码，是规则。**

## 工作流程（Claude 应用本 skill 时的行动准则）

当 Claude 按本 skill 帮用户做事时：

1. **先定 schema 再写代码** —— IntentSpec / Plan / EvaluationResult 的
   schema 是项目演化的事实来源
2. **每写一道检查就配一份 yaml + 一条单测** —— matcher 是注册表里的，
   yaml 是数据
3. **严格遵守"控制平面 / 业务平面"分离** —— 业务库 / 文件 / API 的写入
   只能由 executor 触碰
4. **测试覆盖反向场景** —— 让假 LLM / 假 planner 故意输出违规内容，验证
   下游能拦下
5. **每个 finalize 路径都写 report.md** —— 让陌生人能复述这次运行发生了
   什么
6. **先按风险分级再决定阶段数** —— read 不需要 Approve；纯探索性的低风险
   动作可以省去 Plan
7. **trace 事件 kind 要稳定可枚举** —— 设计 taxonomy 后纳入文档

## 一段话回到起点

软件工程的核心产出物正在变化。过去工程师交付代码；现在最有价值的交付物
正在变成 —— **契约**（系统该接受什么）、**规则**（什么情况下做什么决定）、
**环境**（agent 能看到什么、能动什么）、**反馈回路**（系统如何从每次运行
学到经验）。

代码仍然要写，但写代码的工作正在被 agent 接管。**为 agent 设计能跑得稳
的世界 —— 这件事是当下工程师真正的杠杆所在。**
