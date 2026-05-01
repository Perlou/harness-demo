/**
 * Approval 阶段 —— 决定一个 Plan 是自动通过、需要人工审批，还是被拒绝。
 *
 * 决策表：
 *   1. 三道检查未全过 → "rejected"
 *   2. 任一 finding 标记 requiresApproval=true → "pending"（无视 riskLevel）
 *   3. riskLevel = read / write-low → "auto"
 *   4. riskLevel = write-high → "pending"
 *
 * 第 2 条是 policy 触发的"升级"路径：例如
 * destructive-needs-approval.yaml 命中 UPDATE 后，会在 finding 上打
 * requiresApproval=true，让本来 read 风险的 plan 也被升级到人工审批。
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

  // 任何一道检查的 finding 标记了 requiresApproval 都升级成 pending
  const allFindings = [
    ...evalResult.schemaCheck.findings,
    ...evalResult.policyCheck.findings,
    ...evalResult.scenarioCheck.findings,
  ]
  const escalation = allFindings.find((f) => f.requiresApproval === true)
  if (escalation !== undefined) {
    ctx.trace.emit({
      stage: "approve",
      kind: "approval.required",
      payload: {
        reason: "policy_escalation",
        ruleId: escalation.ruleId,
        planSteps: plan.steps.length,
      },
    })
    return "pending"
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
        payload: {
          reason: "high_risk",
          riskLevel: intent.riskLevel,
          planSteps: plan.steps.length,
        },
      })
      return "pending"
    default: {
      const _exhaustive: never = intent.riskLevel
      throw new Error(`未知 riskLevel: ${String(_exhaustive)}`)
    }
  }
}
