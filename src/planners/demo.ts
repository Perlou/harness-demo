/**
 * Demo 模式的 Planner —— 按出厂剧本生成结构化 Plan。
 *
 * 这里和 src/pipeline/intent.ts 共用 detectCase() 决策。intent 负责把请求
 * 归类、设 riskLevel/scope；planner 负责对每个剧本写出对应的 SQL。
 *
 * 出厂剧本（与 docs/requirements.md §5 对齐）：
 *
 *   A · top-sales       SELECT 聚合 → happy path
 *   B · export-pii      SELECT customers.email/phone → 触发 pii-fields policy
 *   C · count-orders    SELECT COUNT(*) FROM orders → 触发 require-time-bounds
 *   D · mark-completed  UPDATE orders → 触发 destructive-needs-approval
 *   default             SELECT 1 AS one + emit plan.no_case_matched
 */

import { Plan, type IntentSpec } from "../../harness/contracts/index.js"
import type { Planner } from "../pipeline/planner.js"
import type { RunContext } from "../pipeline/context.js"
import { detectCase } from "./cases.js"

export const demoPlanner: Planner = {
  name: "demo",
  generate(intent: IntentSpec, ctx?: RunContext): Plan {
    const intentId = ctx?.runId ?? (intent.rawText.slice(0, 32) || "demo")
    const detected = detectCase(intent.rawText)
    switch (detected) {
      case "top-sales":
        return planTopSales(intentId)
      case "export-pii":
        return planExportPii(intentId)
      case "count-orders":
        return planCountOrders(intentId)
      case "mark-completed":
        return planMarkCompleted(intentId)
      default:
        ctx?.trace.emit({
          stage: "plan",
          kind: "plan.no_case_matched",
          payload: { rawText: intent.rawText },
        })
        return planFallback(intentId)
    }
  },
}

// ---------------------------------------------------------------------------
// 剧本 A：上个月销售前 5（happy path）
// ---------------------------------------------------------------------------

function planTopSales(intentId: string): Plan {
  return Plan.parse({
    intentId,
    rationale:
      "join order_items + orders + products，按 quantity*unit_price 聚合，" +
      "时间窗口 2026-04，按销售总额降序取前 5",
    steps: [
      {
        kind: "sql",
        mode: "read",
        sql: [
          "SELECT",
          "  p.id   AS product_id,",
          "  p.name AS product_name,",
          "  ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue,",
          "  SUM(oi.quantity) AS units_sold",
          "FROM order_items oi",
          "JOIN orders o   ON o.id = oi.order_id",
          "JOIN products p ON p.id = oi.product_id",
          "WHERE o.ordered_at >= '2026-04-01T00:00:00.000Z'",
          "  AND o.ordered_at <  '2026-05-01T00:00:00.000Z'",
          "GROUP BY p.id, p.name",
          "ORDER BY revenue DESC",
          "LIMIT 5",
        ].join("\n"),
        expectedColumns: ["product_id", "product_name", "revenue", "units_sold"],
        estimatedRows: 5,
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// 剧本 B：导出客户 PII（被 policy 拦下）
// ---------------------------------------------------------------------------

function planExportPii(intentId: string): Plan {
  return Plan.parse({
    intentId,
    rationale:
      "导出客户联系方式列表（演示 pii-fields policy 如何在执行前阻止 PII 暴露）",
    steps: [
      {
        kind: "sql",
        mode: "read",
        sql:
          "SELECT customers.id, customers.name, customers.email, customers.phone " +
          "FROM customers",
        expectedColumns: ["id", "name", "email", "phone"],
        estimatedRows: 50,
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// 剧本 C：orders 全表 COUNT（被 policy 拦下）
// ---------------------------------------------------------------------------

function planCountOrders(intentId: string): Plan {
  return Plan.parse({
    intentId,
    rationale:
      "数 orders 表行数（演示 require-time-bounds policy 如何要求时间过滤）",
    steps: [
      {
        kind: "sql",
        mode: "read",
        sql: "SELECT COUNT(*) AS row_count FROM orders",
        expectedColumns: ["row_count"],
        estimatedRows: 1,
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// 剧本 D：标记长时间未确认订单为 completed（写操作 → 走审批）
// ---------------------------------------------------------------------------

function planMarkCompleted(intentId: string): Plan {
  return Plan.parse({
    intentId,
    rationale:
      "把发货 90 天前仍处 shipped 状态的订单标记为 completed（演示 approval gate）",
    steps: [
      {
        kind: "sql",
        mode: "write",
        sql: [
          "UPDATE orders",
          "SET status = 'completed'",
          "WHERE status = 'shipped'",
          "  AND shipped_at < '2026-02-01T00:00:00.000Z'",
        ].join("\n"),
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// fallback：未命中剧本时，安全占位 plan
// ---------------------------------------------------------------------------

function planFallback(intentId: string): Plan {
  return Plan.parse({
    intentId,
    rationale: "未命中任何出厂剧本，返回 SELECT 1 AS one 作为安全占位",
    steps: [
      {
        kind: "sql",
        mode: "read",
        sql: "SELECT 1 AS one",
        expectedColumns: ["one"],
        estimatedRows: 1,
      },
    ],
  })
}
