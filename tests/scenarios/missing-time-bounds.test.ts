/**
 * 剧本 C —— 缺时间过滤
 *
 * 输入："orders 表里有多少行"
 * 期望：policy 阶段 require-time-bounds 命中 → status=rejected_by_policy
 *       finding 提供修复建议（让用户改写问句重跑能通过）
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

describe("M5 — 剧本 C · count-orders (缺 WHERE)", () => {
  it("status=rejected_by_policy", async () => {
    const result = await runPipeline("orders 表里有多少行")
    expect(result.status).toBe("rejected_by_policy")
  })

  it("finding 来自 require-time-bounds，且带可行的 suggestion", async () => {
    const result = await runPipeline("orders 表里有多少行")
    const evalJson = JSON.parse(
      readFileSync(join(result.runDir, "evaluation.json"), "utf8"),
    ) as {
      policyCheck: {
        findings: Array<{
          ruleId: string
          message: string
          suggestion?: string
        }>
      }
    }
    const finding = evalJson.policyCheck.findings.find(
      (f) => f.ruleId === "require-time-bounds",
    )
    expect(finding).toBeDefined()
    expect(finding!.message).toContain("orders")
    expect(finding!.suggestion).toBeDefined()
    expect(finding!.suggestion!).toMatch(/WHERE.*ordered_at|时间/)
  })

  it("trace 没有 execute.committed", async () => {
    const result = await runPipeline("orders 表里有多少行")
    const kinds = readTraceKinds(result.runDir)
    expect(kinds).toContain("check.policy.failed")
    expect(kinds).not.toContain("execute.committed")
  })
})
