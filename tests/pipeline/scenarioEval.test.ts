/**
 * Scenario 评估单测。当前只有 row-budget。
 *
 * row-budget 走 env 阈值；测试里通过环境变量改阈值来制造命中和不命中。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Plan } from "../../harness/contracts/index.js"
import { closeDb } from "../../src/db/client.js"
import { seed } from "../../src/db/seed.js"
import { resetConfig } from "../../src/config.js"
import {
  evaluateScenario,
  resetScenarioCache,
} from "../../src/pipeline/scenarioEval.js"
import { TraceEmitter } from "../../src/trace/events.js"
import { RunArtifacts } from "../../src/trace/writer.js"
import type { RunContext } from "../../src/pipeline/context.js"

let tmpRoot: string
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  tmpRoot = mkdtempSync(join(tmpdir(), "harness-m4-scenario-"))
  process.env.HARNESS_DB_PATH = join(tmpRoot, "demo.sqlite")
  process.env.HARNESS_RUNS_DIR = join(tmpRoot, "runs")
  resetConfig()
  resetScenarioCache()
  closeDb()
  seed()
})

afterEach(() => {
  closeDb()
  process.env = originalEnv
  resetConfig()
  resetScenarioCache()
  rmSync(tmpRoot, { recursive: true, force: true })
})

function makeCtx(): RunContext {
  const trace = new TraceEmitter("test-run")
  const artifacts = new RunArtifacts(join(tmpRoot, "runs"), "test-run")
  trace.on(artifacts.appendTrace)
  return { runId: "test-run", startedAt: "2026-05-01T00:00:00.000Z", trace, artifacts }
}

function planFromSql(sql: string, mode: "read" | "write" = "read"): Plan {
  return Plan.parse({
    intentId: "test",
    rationale: "test",
    steps: [{ kind: "sql", mode, sql }],
  })
}

describe("M4 — row-budget scenario", () => {
  it("不命中：默认 10000 行预算下，200 行 orders 通过", () => {
    process.env.HARNESS_ROW_BUDGET_READ = "10000"
    resetConfig()
    const plan = planFromSql(
      "SELECT id FROM orders WHERE ordered_at > '2025-01-01'",
    )
    const result = evaluateScenario(plan, makeCtx())
    expect(result.passed).toBe(true)
    expect(result.findings).toEqual([])
  })

  it("命中：把 read 预算设为 50 时，200 行 orders 触发", () => {
    process.env.HARNESS_ROW_BUDGET_READ = "50"
    resetConfig()
    const plan = planFromSql(
      "SELECT id FROM orders WHERE ordered_at > '2025-01-01'",
    )
    const result = evaluateScenario(plan, makeCtx())
    expect(result.passed).toBe(false)
    const f = result.findings.find((x) => x.ruleId === "row-budget")
    expect(f).toBeDefined()
    expect(f!.level).toBe("error")
    expect(f!.message).toMatch(/超过.*50/)
  })

  it("不命中：write 模式不参与 row-budget（v1 不探查写）", () => {
    process.env.HARNESS_ROW_BUDGET_WRITE = "1"
    resetConfig()
    const plan = planFromSql(
      "UPDATE orders SET status='completed' WHERE id=1",
      "write",
    )
    const result = evaluateScenario(plan, makeCtx())
    expect(result.passed).toBe(true)
  })

  it("SELECT 1 永远通过（行数=1）", () => {
    const plan = planFromSql("SELECT 1 AS one")
    const result = evaluateScenario(plan, makeCtx())
    expect(result.passed).toBe(true)
  })
})
