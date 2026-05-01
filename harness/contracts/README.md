# harness/contracts

控制平面契约目录。本目录里的所有 `.schema.ts` 文件都是 **Zod schema** —— 同时承担三个角色：

1. **编译期类型** —— `type Foo = z.infer<typeof Foo>` 让 TypeScript 在 import 处获得静态类型
2. **运行时校验** —— `Foo.parse(unknownJson)` 在跨边界（LLM 输出、CLI 输入、yaml 加载）处守门
3. **可被 review 的工件** —— 契约的 git 演化史 = 系统输入输出形状的演化史

> **红线**：`src/` 下不允许重新声明这些类型。所有 pipeline 阶段、planner、CLI、测试都从 `@harness/contracts` 导入。

---

## 文件清单

| 文件 | 主要导出 | 阶段 |
|---|---|---|
| `intent.schema.ts` | `IntentSpec` `Goal` `RiskLevel` `Scope` `TimeWindow` | Intent |
| `plan.schema.ts` | `Plan` `Action` `SqlAction` | Plan |
| `evaluation.schema.ts` | `EvaluationResult` `CheckOutcome` `CheckFinding` `TraceEvent` `TraceStage` `RunStatus` `isTerminal` | Check / Trace / 状态机 |
| `index.ts` | 总入口（re-export） | — |

---

## 各 schema 的语义边界

### `IntentSpec`

第一阶段的最终产物。`rawText` 字段仅用于展示和 trace，**不允许任何 stage 拿它做决策** —— 一切判断必须基于 `goal`/`scope`/`riskLevel`/`assumptions` 等结构化字段。

`assumptions` 是教学价值最高的字段：让"系统怎么理解了我"完全可见。

### `Plan`

第二阶段的最终产物。两条核心规则：

- **Plan 是建议，不是事实** —— 这里描述"agent 想做什么"，写入要等到 Execute 阶段
- **steps 必须是结构化对象** —— 不允许自由文本，因为下游 Check 要做程序化分析

`SqlAction.mode` 决定后续审批分支：`read` 默认自动放行，`write` 默认进入 Approval。

当前 `Action` 只有 `SqlAction` 一种 kind；后续要扩展（例如发邮件、调外部 API）请用 discriminated union 添加新 kind。

### `EvaluationResult`

Check 阶段的合并结果。三道检查（Schema / Policy / Scenario）**独立运行、不短路**，每一道产出一个 `CheckOutcome`。`passed` 字段的含义：三道全过且没有 `error` 级别 finding。

`CheckFinding.suggestion` 是反馈回路的关键 —— agent 在重试时会消费这个字段，所以写规则的时候要尽量给出可执行的修复建议。

### `TraceEvent`

写入 `runs/<id>/trace.jsonl` 的单条记录。`payload` 是开放的 `record`，但同一个 `(stage, kind)` 组合在系统里应当**始终携带同样的字段集合**（约定大于强制）。事件 kind 清单见 `docs/architecture.md §8.3`。

### `RunStatus`

一个完整 run 的状态机：

```
created
   │
   ▼
checked ──┬──→ rejected_by_schema      (终态)
          ├──→ rejected_by_policy      (终态)
          ├──→ rejected_by_scenario    (终态)
          ├──→ pending-approval ──→ approved ──→ committed         (终态)
          │                       └→ rejected                       (终态)
          └──→ auto-approved ──→ committed                          (终态)
                               └→ committed_failed                  (终态)
```

`failed` 是兜底终态，捕获所有未预期异常。`isTerminal()` 用来判断状态是否还可能变化。

---

## 演进规则

1. **新字段优先用 `.optional()`**，避免破坏已经写好的工件
2. **新枚举值要同步更新对应的 yaml 规则**（matcher 注册表 / scenario 阈值）
3. **删除字段必须先经过一次"标记 deprecated"的过渡 commit**
4. **改 schema 必走 PR**：契约的 git 演化史是系统行为的演化史
