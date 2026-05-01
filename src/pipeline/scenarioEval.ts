/**
 * Scenario 评估 —— 在当前 DB 状态下检查 Plan 是否合理（行数估算等）。
 *
 * M3 占位实现：直接返回 passed=true。
 * M4 会接入 EXPLAIN QUERY PLAN + harness/scenarios/row-budget.yaml 阈值。
 */

import {
  type CheckOutcome,
  type Plan,
} from "../../harness/contracts/index.js"
import type { RunContext } from "./context.js"

export function evaluateScenario(plan: Plan, ctx: RunContext): CheckOutcome {
  ctx.trace.emit({
    stage: "check",
    kind: "check.scenario.started",
    payload: { stepCount: plan.steps.length },
  })

  // M3 占位：永远通过。
  const outcome: CheckOutcome = { passed: true, findings: [] }

  ctx.trace.emit({
    stage: "check",
    kind: outcome.passed ? "check.scenario.passed" : "check.scenario.failed",
    payload: { findings: outcome.findings },
  })
  return outcome
}
