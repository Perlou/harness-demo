/**
 * approval 阶段单测：直接覆盖决策表的所有分支，把整体覆盖率从场景驱动
 * 上来的 ~63% 拉到 ~100%。
 *
 * 决策表（与 src/pipeline/approval.ts 对齐）：
 *   1. 检查未通过 → "rejected"
 *   2. 任一 finding 的 requiresApproval=true → "pending"（升级路径）
 *   3. riskLevel = read | write-low → "auto"
 *   4. riskLevel = write-high → "pending"
 */

import { describe, expect, it, vi } from "vitest"

import {
  type CheckFinding,
  type EvaluationResult,
  type IntentSpec,
  type Plan,
  type RiskLevel,
} from "../../harness/contracts/index.js"
import { decideApproval } from "../../src/pipeline/approval.js"
import type { RunContext } from "../../src/pipeline/context.js"

function evalAllPass(findings: CheckFinding[] = []): EvaluationResult {
  return {
    schemaCheck: { passed: true, findings: [] },
    policyCheck: { passed: true, findings },
    scenarioCheck: { passed: true, findings: [] },
    passed: true,
  }
}

function evalSomeFailed(): EvaluationResult {
  return {
    schemaCheck: { passed: true, findings: [] },
    policyCheck: {
      passed: false,
      findings: [
        { ruleId: "x", level: "error", message: "y" },
      ],
    },
    scenarioCheck: { passed: true, findings: [] },
    passed: false,
  }
}

function makeIntent(riskLevel: RiskLevel): IntentSpec {
  return {
    rawText: "test",
    goal: "query",
    scope: { tables: ["products"] },
    assumptions: [],
    riskLevel,
    successCriteria: [],
  }
}

const PLAN: Plan = {
  intentId: "test",
  rationale: "test",
  steps: [{ kind: "sql", mode: "read", sql: "SELECT 1" }],
}

function makeMockCtx(): RunContext {
  const trace = { emit: vi.fn() }
  return {
    runId: "test-run",
    startedAt: "2026-05-01T00:00:00.000Z",
    trace: trace as unknown as RunContext["trace"],
    artifacts: {} as RunContext["artifacts"],
  }
}

describe("M9 — decideApproval 决策表", () => {
  it("read 风险 + 检查全过 → auto", () => {
    const ctx = makeMockCtx()
    const decision = decideApproval(PLAN, makeIntent("read"), evalAllPass(), ctx)
    expect(decision).toBe("auto")
    expect(ctx.trace.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "approval.auto_granted" }),
    )
  })

  it("write-low 风险 + 检查全过 → auto（v1 不区分 low / high 的精细度）", () => {
    const decision = decideApproval(
      PLAN,
      makeIntent("write-low"),
      evalAllPass(),
      makeMockCtx(),
    )
    expect(decision).toBe("auto")
  })

  it("write-high 风险 + 检查全过 + 无 requiresApproval finding → pending", () => {
    const ctx = makeMockCtx()
    const decision = decideApproval(
      PLAN,
      makeIntent("write-high"),
      evalAllPass(),
      ctx,
    )
    expect(decision).toBe("pending")
    expect(ctx.trace.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "approval.required",
        payload: expect.objectContaining({ reason: "high_risk" }),
      }),
    )
  })

  it("升级路径：read 风险 + 任一 finding 标 requiresApproval → pending", () => {
    const ctx = makeMockCtx()
    const escalation: CheckFinding = {
      ruleId: "destructive-needs-approval",
      level: "warning",
      message: "x",
      requiresApproval: true,
    }
    const decision = decideApproval(
      PLAN,
      makeIntent("read"),
      evalAllPass([escalation]),
      ctx,
    )
    expect(decision).toBe("pending")
    expect(ctx.trace.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "approval.required",
        payload: expect.objectContaining({
          reason: "policy_escalation",
          ruleId: "destructive-needs-approval",
        }),
      }),
    )
  })

  it("检查未通过 → rejected（无视 riskLevel）", () => {
    const ctx = makeMockCtx()
    const decision = decideApproval(
      PLAN,
      makeIntent("write-high"),
      evalSomeFailed(),
      ctx,
    )
    expect(decision).toBe("rejected")
    expect(ctx.trace.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "approval.rejected_due_to_check" }),
    )
  })
})
