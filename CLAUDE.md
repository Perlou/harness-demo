# CLAUDE.md

> 这份文件给 Claude 看。当你（Claude）接手这个项目时，按下面的约束工作，不要绕过。

## 项目是什么

`harness-demo` 是一个**教学导向的 SQL 助手 CLI**，目的是把 OpenAI 在 2026/2 提出的 **Harness Engineering** 工程范式具象化为可运行代码。

业务功能（自然语言 → SQL → 查电商订单库）刻意保持简单。**主角是控制平面**：意图规范化、计划生成、Schema/Policy/Scenario 检查、人工审批门、运行工件。

如果你不熟悉 harness engineering，先读 `CONCEPT.md`。然后再读 `docs/architecture.md`。

## 三条不可妥协的边界

下面这三条是项目的"红线"，违反任何一条都属于回归：

### 1. `harness/` 目录里只能放数据，不能放代码

允许的文件类型：
- `harness/contracts/*.schema.ts`（Zod schema，纯类型与校验声明）
- `harness/policies/*.yaml`
- `harness/scenarios/*.yaml`
- `harness/prompts/*.tmpl`
- `*.md`（说明）

**禁止**：在 `harness/` 下放 `if`/`for`/业务逻辑函数。规则的解释器在 `src/pipeline/policyCheck.ts` 等处，规则本身在 `harness/`。

判断标准：**如果删掉所有 `harness/*.yaml`，系统行为应当变化**。如果不变，说明你把规则写到代码里了。

### 2. 业务 DB 只能由 `src/pipeline/executor.ts` 触碰写

任何对 `customers / products / orders / order_items / inventory / audit_log` 的写入必须经过 executor，且 executor 只在所有检查 + 审批通过后被调用。**不允许**任何 stage 直接 `db.exec("UPDATE ...")`。

### 3. Demo Mode 与 Live Mode 共用下游 pipeline

切换模式只换 `Planner` 实现，**不允许**为 Demo Mode 提供"特殊路径"绕过 schema/policy/scenario/approval/executor。这是项目最重要的教学论点。

## 五阶段名词（本项目术语表）

| 名词 | 含义 |
|---|---|
| **Intent** | 用户自然语言被规范化为的 `IntentSpec`（结构化对象） |
| **Plan** | Planner 产出的结构化执行计划，包含一个或多个 `SqlAction` |
| **Check** | Schema / Policy / Scenario 三道并联检查 |
| **Approval** | 高风险动作的人工显式批准（通过两阶段 CLI 命令） |
| **Execute** | 在事务内提交业务变更 + audit_log |
| **Trace** | 每次运行的事件流，落盘为 `runs/<id>/trace.jsonl` 与 `report.md` |
| **Run** | 一次完整的 `Intent → ... → Trace` 实例，对应 `runs/<id>/` 一个目录 |

## 技术栈

- **语言**：TypeScript（strict）
- **运行时**：Node 20 LTS
- **包管理**：pnpm
- **CLI**：commander
- **校验**：zod（contracts）+ js-yaml（rules）
- **DB**：better-sqlite3
- **LLM**：openai（仅 Live Mode）
- **测试**：vitest

## 目录速查

```
harness/        控制平面（数据 / 工件，无代码逻辑）
src/pipeline/   harness 引擎本体（薄壳、不持有规则）
src/planners/   demo / live 两个 Planner 实现
src/db/         业务 DB（schema.sql + seed.ts + client.ts）
src/cli/        commander 子命令
src/trace/      事件总线 + 工件写入
runs/           每次运行的工件（gitignored）
docs/           需求 / 架构 / 进度
tests/          pipeline 单测 + scenarios e2e 测试
```

完整结构见 `docs/architecture.md §3`。

## 开发约定

### 提交粒度

按 `docs/roadmap.md` 的 M0–M10 阶段推进，每完成一个阶段提一次 commit。**不要把多个阶段塞进一个 commit。**

### 在动手之前

1. 读 `docs/architecture.md` 中你要改的那一节
2. 读 `docs/roadmap.md` 确认当前在哪个 M
3. 如果你的改动会动到三条红线，先停下来确认再写

### 写代码时

- 类型严格——任何 `any` 都需要在 PR 中解释
- 业务实体（IntentSpec / Plan / EvaluationResult / TraceEvent）必须从 `harness/contracts/` 导入，**不要在 src 里重声明**
- 规则解释器（matcher）只能在 `policyCheck.ts` / `scenarioEval.ts` 里扩展，扩展后才能在 yaml 里引用
- 每个 pipeline stage 必须 emit 至少一个 trace 事件
- 每个 stage 的副作用必须只是 trace；除了 executor

### 测试要求

- 改动 pipeline stage → 改 / 加 `tests/pipeline/<stage>.test.ts`
- 改动出厂剧本 → 改 / 加 `tests/scenarios/<scene>.test.ts`
- 改动 yaml 规则 → 改 / 加对应 matcher 单测
- e2e 测试断言 `runs/<id>/status` + `trace.jsonl` 关键事件序列

### 不要做的事

- 不要为了"用户体验"在 CLI 里加确认提示绕过 approval gate；approval **必须**走两阶段命令
- 不要在 Live Mode 加重试（v1 内）；invalid 输出就 trace + fail
- 不要给 yaml 加新语法字段而不在 matcher 注册表里实现对应代码——这会让 yaml 变成 DSL 的 mini 实现，违反"规则即数据"
- 不要把 `runs/<id>/` 写到 git——它是工件，gitignored
- 不要写无关的"顺手优化"；改动应聚焦当前 milestone

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm seed                 # 生成 / 重置 SQLite 种子数据
pnpm harness ask "<问题>"  # 跑一次完整 pipeline
pnpm harness approve <id> # 批准待审批运行
pnpm harness reject <id> --reason "..."
pnpm harness runs         # 列出运行
pnpm harness show <id>    # 打印 report.md
pnpm test                 # 跑测试
pnpm test:coverage        # 跑测试 + 输出覆盖率
pnpm typecheck            # 类型检查
pnpm walkthrough          # 一键演示 4 个剧本（含 approve）
pnpm reset                # 清 runs/ + 重新 seed
```

容器化运行（不依赖宿主机 Node）：

```bash
docker compose run --rm harness mode
docker compose run --rm harness seed
docker compose run --rm harness ask "上个月销售前 5 的产品"
```

发布（仅维护者）：

```bash
pnpm version patch         # bump + commit + git tag
git push --follow-tags     # 触发 .github/workflows/release.yml
```

完整发布流程见 `docs/deployment.md`。

## 当你不确定时

- 触及红线 → 停下来读 `CONCEPT.md` 第 6 节"约束即工件"
- 不知道某段代码该放哪 → 先看 `docs/architecture.md §3` 的目录注释
- 不知道某个 stage 要 emit 哪种事件 → 看 `architecture.md §8.3` 的事件 kind 清单
- 觉得现有结构挡住了你 → 不要绕；提出来，让人来调整结构

## 推荐阅读顺序（接手时）

1. `CONCEPT.md` —— 范式
2. `docs/requirements.md §3, §6` —— 目标与功能边界
3. `docs/architecture.md §1–§4` —— 架构骨架与 pipeline
4. `harness/contracts/` —— 实际契约
5. `harness/policies/` —— 实际规则
6. `docs/roadmap.md` —— 当前进度（M0–M10 全部完成 + Stage A 发布管线）
7. `docs/deployment.md` —— 发布上线流程（按需）
