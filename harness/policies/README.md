# harness/policies

控制平面规则目录。每个 `.yaml` 文件都是 **声明式规则**，不允许写代码逻辑。
规则的解释器（matcher 注册表）在 `src/pipeline/policyCheck.ts`，**封闭可枚举** ——
要扩展能力必须先在解释器里注册新 matcher，然后才能在 yaml 里使用。

> **判别标准**：删掉任意一份 yaml，系统行为应当发生可观察变化。如果不变，
> 说明规则没有真正被外化。

---

## 当前规则清单

| 文件 | 拦截目标 | 决策 | 触发场景 |
|---|---|---|---|
| `pii-fields.yaml` | SELECT 中引用 `customers.email` 或 `customers.phone` | **reject** | 任何尝试导出 PII |
| `require-time-bounds.yaml` | 对 `orders` 表的查询缺 WHERE | **reject** | 无时间过滤的全表扫 |
| `destructive-needs-approval.yaml` | INSERT / UPDATE / DELETE | **require_approval** | 任何写操作 |

---

## yaml 字段说明

```yaml
id: <稳定 id，对应 CheckFinding.ruleId>
description: <人类可读简介>
applies_to:
  steps: [read | write]   # 仅对此类 step 生效
match:
  type: <封闭 matcher 类型 — 见下表>
  ...                     # 各 matcher 自己的字段
on_match:
  decision: reject | require_approval
  message: <模板，可用 {占位符}>
  suggestion: <给 agent 的修复建议，可用占位符>
```

### Matcher 封闭集合（v1）

| matcher | 字段 | 占位符 | 触发条件 |
|---|---|---|---|
| `column-reference` | `columns: ["table.col", ...]` | `{column}` | step 的 SQL 中出现任一列 |
| `table-without-where` | `tables: ["t", ...]` | `{table}` | step 的 SQL 引用任一表且无 WHERE |
| `statement-kind` | `kinds: ["select", "insert", "update", "delete"]` | `{kind}` | step 的 SQL 顶层动词命中 |

---

## 决策语义

- `reject` → CheckFinding.level = `"error"`，把整道 policy 检查标记为不通过，
  run 终态 = `rejected_by_policy`。
- `require_approval` → CheckFinding.level = `"warning"` 且 `requiresApproval = true`。
  policy 检查仍然通过，但 engine 会在 approval 阶段强制走 pending-approval。

---

## 演进规则

1. **新规则**：直接加新 yaml 文件。仅当 yaml 引用的 matcher 已经在
   `src/pipeline/policyCheck.ts` 注册过才有效。
2. **新 matcher**：先在 `policyCheck.ts` 注册，更新本 README 表格，再写 yaml。
3. **修改既有规则**：通过 PR review，规则历史 = 系统行为历史。
