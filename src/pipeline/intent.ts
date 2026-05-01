/**
 * Intent 阶段 —— 自然语言 → IntentSpec。
 *
 * M3 占位实现：把 rawText 包装成最简单的合法 IntentSpec
 * （goal=query / risk=read / scope.tables=["products"]）。
 *
 * M5 会根据关键词命中预设 case 产出更有内容的 IntentSpec；M8 会接入
 * Live Mode 用 LLM 真正做规范化。下游 Check / Approval / Execute
 * 在那之后**完全不需要修改**——这是 harness engineering 的核心论点。
 */

import { IntentSpec } from "../../harness/contracts/index.js"
import type { RunContext } from "./context.js"

export function normalizeIntent(rawText: string, ctx: RunContext): IntentSpec {
  ctx.trace.emit({
    stage: "intent",
    kind: "intent.received",
    payload: { rawText },
  })

  const intent = IntentSpec.parse({
    rawText,
    goal: "query",
    scope: { tables: ["products"] },
    assumptions: ["M3 占位实现：未做真正的意图解析"],
    riskLevel: "read",
    successCriteria: ["pipeline 五阶段全部 emit 事件并落盘"],
  })

  ctx.trace.emit({
    stage: "intent",
    kind: "intent.normalized",
    payload: { intent },
  })

  ctx.artifacts.writeIntent(intent)
  return intent
}
