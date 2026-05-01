/**
 * Intent 阶段 —— 自然语言 → IntentSpec。
 *
 * M5 实现：根据关键词把请求归到 4 个出厂剧本之一，剧本未命中时
 * 走安全 fallback（goal=query / risk=read / scope=products）。
 *
 * 这里只做"分类"，不生成 SQL。SQL 是 Planner 阶段的事，由
 * src/planners/demo.ts 基于同一个 detectCase() 结果生成。
 */

import { IntentSpec } from "../../harness/contracts/index.js"
import { detectCase, type DemoCase } from "../planners/cases.js"
import type { RunContext } from "./context.js"

/**
 * 上个月时间窗口。锚定到 seed 数据所用的 REFERENCE_NOW (2026-05-01)，
 * 让演示运行的输出始终稳定。
 */
const LAST_MONTH = {
  from: "2026-04-01T00:00:00.000Z",
  to: "2026-05-01T00:00:00.000Z",
}

export function normalizeIntent(rawText: string, ctx: RunContext): IntentSpec {
  ctx.trace.emit({
    stage: "intent",
    kind: "intent.received",
    payload: { rawText },
  })

  const detected = detectCase(rawText)
  const intent = buildIntent(rawText, detected)

  ctx.trace.emit({
    stage: "intent",
    kind: "intent.normalized",
    payload: { intent, detectedCase: detected ?? "fallback" },
  })

  ctx.artifacts.writeIntent(intent)
  return intent
}

function buildIntent(rawText: string, detected: DemoCase | null): IntentSpec {
  switch (detected) {
    case "top-sales":
      return IntentSpec.parse({
        rawText,
        goal: "aggregate",
        scope: {
          tables: ["orders", "order_items", "products"],
          timeWindow: LAST_MONTH,
        },
        assumptions: [
          "按销售总额聚合（quantity * unit_price 求和）",
          "「上个月」= 2026-04 整月（锚定到 demo 的 REFERENCE_NOW）",
          "「前 N」= top 5",
        ],
        riskLevel: "read",
        successCriteria: ["返回最多 5 行", "包含 product_id 与 revenue"],
      })

    case "export-pii":
      return IntentSpec.parse({
        rawText,
        goal: "export",
        scope: { tables: ["customers"] },
        assumptions: ["要导出客户的联系方式"],
        riskLevel: "read",
        successCriteria: ["每行包含 email / phone 之类联系字段"],
      })

    case "count-orders":
      return IntentSpec.parse({
        rawText,
        goal: "query",
        scope: { tables: ["orders"] },
        assumptions: ["想知道 orders 表的行数"],
        riskLevel: "read",
        successCriteria: ["返回单行单列的整数"],
      })

    case "mark-completed":
      return IntentSpec.parse({
        rawText,
        goal: "mutate",
        scope: { tables: ["orders"] },
        assumptions: [
          "把已发货 90 天未确认的订单状态置为 completed",
          "shipped_at < REFERENCE_NOW − 90 天 = 2026-02-01",
        ],
        riskLevel: "write-high",
        successCriteria: ["仅更新 status='shipped' 且发货 90 天前的订单"],
      })

    default:
      return IntentSpec.parse({
        rawText,
        goal: "query",
        scope: { tables: ["products"] },
        assumptions: ["未命中任何出厂剧本，使用 fallback 意图"],
        riskLevel: "read",
        successCriteria: ["走通 pipeline 的安全骨架"],
      })
  }
}
