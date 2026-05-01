/**
 * Approval 阶段 —— 决定一个 Plan 是自动通过、需要人工审批，还是被拒绝。
 *
 * M3 决策表（占位逻辑，M5/M6 会扩充）：
 *   - 检查未通过 → "rejected"
 *   - riskLevel = read → "auto"（自动通过）
 *   - riskLevel = write-low → "auto"（v1 不区分 low/high；保留扩展位）
 *   - riskLevel = write-high → "pending"
 */

import type {
  EvaluationResult,
  IntentSpec,
  Plan,
} from "../../harness/contracts/index.js"
import type { RunContext } from "./context.js"

export type ApprovalDecision = "auto" | "pending" | "rejected"

export function decideApproval(
  plan: Plan,
  intent: IntentSpec,
  evalResult: EvaluationResult,
  ctx: RunContext,
): ApprovalDecision {
  if (!evalResult.passed) {
    ctx.trace.emit({
      stage: "approve",
      kind: "approval.rejected_due_to_check",
      payload: { schema: evalResult.schemaCheck.passed,
                 policy: evalResult.policyCheck.passed,
                 scenario: evalResult.scenarioCheck.passed },
    })
    return "rejected"
  }

  switch (intent.riskLevel) {
    case "read":
    case "write-low":
      ctx.trace.emit({
        stage: "approve",
        kind: "approval.auto_granted",
        payload: { riskLevel: intent.riskLevel, planSteps: plan.steps.length },
      })
      return "auto"
    case "write-high":
      ctx.trace.emit({
        stage: "approve",
        kind: "approval.required",
        payload: { riskLevel: intent.riskLevel, planSteps: plan.steps.length },
      })
      return "pending"
    default: {
      const _exhaustive: never = intent.riskLevel
      throw new Error(`未知 riskLevel: ${String(_exhaustive)}`)
    }
  }
}
