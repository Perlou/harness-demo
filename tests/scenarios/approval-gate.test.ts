/**
 * 剧本 D —— 写操作走审批门
 *
 * 输入："把已经发货 90 天还没确认收货的订单标记为已完成"
 * 期望：destructive-needs-approval policy 命中（warning + requiresApproval）
 *       check 整体仍 passed，但 approval 阶段强制 pending
 *       status=pending-approval，业务 DB 不变
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { runPipeline } from "../../src/pipeline/engine.js"
import { closeDb, getDb } from "../../src/db/client.js"
import { setupScenarioEnv, readTraceKinds, type ScenarioFixture } from "./_fixture.js"

let fx: ScenarioFixture

beforeEach(() => {
  fx = setupScenarioEnv()
})

afterEach(() => {
  fx.cleanup()
})

describe("M5 — 剧本 D · mark-completed (approval gate)", () => {
  it("status=pending-approval，没有自动执行", async () => {
    const result = await runPipeline(
      "把已经发货 90 天还没确认收货的订单标记为已完成",
    )
    expect(result.status).toBe("pending-approval")
  })

  it("evaluation.json: 三道检查全过；policy 给 warning + requiresApproval", async () => {
    const result = await runPipeline(
      "把已经发货 90 天还没确认收货的订单标记为已完成",
    )
    const evalJson = JSON.parse(
      readFileSync(join(result.runDir, "evaluation.json"), "utf8"),
    ) as {
      passed: boolean
      schemaCheck: { passed: boolean }
      policyCheck: {
        passed: boolean
        findings: Array<{
          ruleId: string
          level: string
          requiresApproval?: boolean
        }>
      }
      scenarioCheck: { passed: boolean }
    }
    expect(evalJson.passed).toBe(true)
    expect(evalJson.schemaCheck.passed).toBe(true)
    expect(evalJson.policyCheck.passed).toBe(true)
    expect(evalJson.scenarioCheck.passed).toBe(true)
    const escalation = evalJson.policyCheck.findings.find(
      (f) => f.ruleId === "destructive-needs-approval",
    )
    expect(escalation).toBeDefined()
    expect(escalation!.level).toBe("warning")
    expect(escalation!.requiresApproval).toBe(true)
  })

  it("trace 含 approval.required，没有 execute.committed", async () => {
    const result = await runPipeline(
      "把已经发货 90 天还没确认收货的订单标记为已完成",
    )
    const kinds = readTraceKinds(result.runDir)
    expect(kinds).toContain("approval.required")
    expect(kinds).not.toContain("execute.started")
    expect(kinds).not.toContain("execute.committed")
    expect(kinds).toContain("finalize.pending-approval")
  })

  it("DB 状态不变：没有 audit_log 记录、没有订单状态被改", async () => {
    closeDb()
    const before = countShippedBefore("2026-02-01T00:00:00.000Z")

    await runPipeline("把已经发货 90 天还没确认收货的订单标记为已完成")

    closeDb()
    const after = countShippedBefore("2026-02-01T00:00:00.000Z")
    expect(after).toBe(before)

    const db = getDb()
    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log")
      .get() as { n: number }
    expect(audit.n).toBe(0)
  })
})

function countShippedBefore(threshold: string): number {
  const db = getDb()
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM orders WHERE status='shipped' AND shipped_at < ?",
    )
    .get(threshold) as { n: number }
  return row.n
}
