/**
 * Schema 检查 —— 确认 Plan 中引用的列、表都在真实 SQLite schema 中存在。
 *
 * M3 占位实现：直接返回 passed=true。
 * M4 会接入真实的 SQL 解析 + sqlite_master 比对。
 */

import {
  type CheckOutcome,
  type Plan,
} from "../../harness/contracts/index.js"
import type { RunContext } from "./context.js"

export function checkSchema(plan: Plan, ctx: RunContext): CheckOutcome {
  ctx.trace.emit({
    stage: "check",
    kind: "check.schema.started",
    payload: { stepCount: plan.steps.length },
  })

  // M3 占位：永远通过。
  const outcome: CheckOutcome = { passed: true, findings: [] }

  ctx.trace.emit({
    stage: "check",
    kind: outcome.passed ? "check.schema.passed" : "check.schema.failed",
    payload: { findings: outcome.findings },
  })
  return outcome
}
