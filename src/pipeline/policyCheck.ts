/**
 * Policy 检查 —— 加载 harness/policies/*.yaml 并对 Plan 跑 matcher。
 *
 * M3 占位实现：直接返回 passed=true。
 * M4 会引入 yaml 加载 + matcher 注册表（column-reference / table-without-where /
 * statement-kind 等）。
 */

import {
  type CheckOutcome,
  type Plan,
} from "../../harness/contracts/index.js"
import type { RunContext } from "./context.js"

export function checkPolicy(plan: Plan, ctx: RunContext): CheckOutcome {
  ctx.trace.emit({
    stage: "check",
    kind: "check.policy.started",
    payload: { stepCount: plan.steps.length },
  })

  // M3 占位：永远通过。
  const outcome: CheckOutcome = { passed: true, findings: [] }

  ctx.trace.emit({
    stage: "check",
    kind: outcome.passed ? "check.policy.passed" : "check.policy.failed",
    payload: { findings: outcome.findings },
  })
  return outcome
}
