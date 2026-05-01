/**
 * 剧本 B —— PII 拦截
 *
 * 输入："导出所有客户的邮箱和手机号"
 * 期望：policy 阶段 pii-fields 命中 → status=rejected_by_policy
 *       audit_log / orders / products 不发生任何变化
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { runPipeline } from "../../src/pipeline/engine.js"
import { setupScenarioEnv, readTraceKinds, type ScenarioFixture } from "./_fixture.js"

let fx: ScenarioFixture

beforeEach(() => {
  fx = setupScenarioEnv()
})

afterEach(() => {
  fx.cleanup()
})

describe("M5 — 剧本 B · export-pii (policy 拦截 PII)", () => {
  it("status=rejected_by_policy", async () => {
    const result = await runPipeline("导出所有客户的邮箱和手机号")
    expect(result.status).toBe("rejected_by_policy")
  })

  it("evaluation.json 中 policy.passed=false 且含 pii-fields finding", async () => {
    const result = await runPipeline("导出所有客户的邮箱和手机号")
    const evalJson = JSON.parse(
      readFileSync(join(result.runDir, "evaluation.json"), "utf8"),
    ) as {
      schemaCheck: { passed: boolean }
      policyCheck: { passed: boolean; findings: Array<{ ruleId: string; level: string }> }
      scenarioCheck: { passed: boolean }
      passed: boolean
    }
    expect(evalJson.passed).toBe(false)
    expect(evalJson.schemaCheck.passed).toBe(true) // schema 仍合法
    expect(evalJson.policyCheck.passed).toBe(false)
    const piiFindings = evalJson.policyCheck.findings.filter(
      (f) => f.ruleId === "pii-fields",
    )
    // customers.email + customers.phone → 至少 2 条
    expect(piiFindings.length).toBeGreaterThanOrEqual(2)
    expect(piiFindings.every((f) => f.level === "error")).toBe(true)
  })

  it("trace 包含 check.policy.failed，且没有 execute.committed", async () => {
    const result = await runPipeline("导出所有客户的邮箱和手机号")
    const kinds = readTraceKinds(result.runDir)
    expect(kinds).toContain("check.policy.failed")
    expect(kinds).not.toContain("execute.started")
    expect(kinds).not.toContain("execute.committed")
    expect(kinds).toContain("finalize.rejected_by_policy")
  })
})
