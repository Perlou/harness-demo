# harness/scenarios

控制平面**场景检查**目录。与 policy 的差异：
- policy 是**静态规则**，看 SQL 文本就能判断
- scenario 是**状态相关**的检查，需要看真实 DB 状态（行数、explain 计划等）

---

## 当前 scenario 清单

| 文件 | 关心的事 | 决策 |
|---|---|---|
| `row-budget.yaml` | 一次查询估算返回行数过多 | reject |

---

## yaml 字段说明

```yaml
id: <稳定 id>
description: <简介>
type: <封闭 scenario 类型>
applies_to:
  steps: [read | write]
threshold:
  source: env | inline
  read?: <数字 — 仅 source=inline>
  write?: <数字 — 仅 source=inline>
on_exceed:
  decision: reject
  message: <模板，{rows} {threshold} 等占位符>
  suggestion: ...
```

### 当前支持的 scenario type（封闭）

| type | 行为 |
|---|---|
| `explain-row-estimate` | 把 step 的 SELECT 包成 `SELECT COUNT(*) FROM (...)`，与阈值比较 |

源的两种形态：
- `source: env` —— 阈值来自 `HARNESS_ROW_BUDGET_READ` / `HARNESS_ROW_BUDGET_WRITE`
- `source: inline` —— 直接在 yaml 里写死

---

## 演进规则

新 scenario type 必须先在 `src/pipeline/scenarioEval.ts` 中注册才能在 yaml 中使用。
yaml 永远是数据，不是 mini DSL。
