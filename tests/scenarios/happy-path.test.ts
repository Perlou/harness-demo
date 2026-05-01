/**
 * 剧本 A —— happy path
 *
 * 输入："上个月销售前 5 的产品"
 * 期望：完整 5 阶段全过 → status=committed → 返回非空结果
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
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

describe("M5 — 剧本 A · top-sales (happy path)", () => {
  it("status=committed，返回非空 revenue 排行", async () => {
    const result = await runPipeline("上个月销售前 5 的产品")
    expect(result.status).toBe("committed")
    expect(existsSync(join(result.runDir, "result.json"))).toBe(true)

    const resultJson = JSON.parse(
      readFileSync(join(result.runDir, "result.json"), "utf8"),
    ) as {
      committed: boolean
      steps: Array<{
        mode: string
        rows?: Array<Record<string, unknown>>
        rowCount?: number
      }>
    }
    expect(resultJson.committed).toBe(true)
    const firstRead = resultJson.steps[0]!
    expect(firstRead.mode).toBe("read")
    expect((firstRead.rowCount ?? 0)).toBeGreaterThan(0)
    expect((firstRead.rowCount ?? 0)).toBeLessThanOrEqual(5)
    const row = firstRead.rows![0]!
    expect(row).toHaveProperty("product_id")
    expect(row).toHaveProperty("product_name")
    expect(row).toHaveProperty("revenue")
  })

  it("trace 完整 + 检查全过 + 自动放行", async () => {
    const result = await runPipeline("上个月销售前 5 的产品")
    const kinds = readTraceKinds(result.runDir)
    expect(kinds).toContain("intent.normalized")
    expect(kinds).toContain("plan.generated")
    expect(kinds).toContain("check.schema.passed")
    expect(kinds).toContain("check.policy.passed")
    expect(kinds).toContain("check.scenario.passed")
    expect(kinds).toContain("approval.auto_granted")
    expect(kinds).toContain("execute.committed")
    expect(kinds).toContain("finalize.committed")
  })

  it("intent 写到 intent.json 且 goal=aggregate / risk=read", async () => {
    const result = await runPipeline("上个月销售前 5 的产品")
    const intent = JSON.parse(
      readFileSync(join(result.runDir, "intent.json"), "utf8"),
    ) as { goal: string; riskLevel: string }
    expect(intent.goal).toBe("aggregate")
    expect(intent.riskLevel).toBe("read")
  })
})
