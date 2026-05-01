/**
 * Schema 检查单测：覆盖未知表、未知列、合法引用三种情况。
 *
 * 每个用例都用真正的 seed 数据库做 introspect，测出来的"真"schema 包含
 * customers / products / orders / order_items / inventory / audit_log。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Plan } from "../../harness/contracts/index.js"
import { closeDb } from "../../src/db/client.js"
import { seed } from "../../src/db/seed.js"
import { resetConfig } from "../../src/config.js"
import { checkSchema } from "../../src/pipeline/schemaCheck.js"
import { TraceEmitter } from "../../src/trace/events.js"
import { RunArtifacts } from "../../src/trace/writer.js"
import type { RunContext } from "../../src/pipeline/context.js"

let tmpRoot: string
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  tmpRoot = mkdtempSync(join(tmpdir(), "harness-m4-schema-"))
  process.env.HARNESS_DB_PATH = join(tmpRoot, "demo.sqlite")
  process.env.HARNESS_RUNS_DIR = join(tmpRoot, "runs")
  resetConfig()
  closeDb()
  seed()
})

afterEach(() => {
  closeDb()
  process.env = originalEnv
  resetConfig()
  rmSync(tmpRoot, { recursive: true, force: true })
})

function makeCtx(): RunContext {
  const trace = new TraceEmitter("test-run")
  const artifacts = new RunArtifacts(join(tmpRoot, "runs"), "test-run")
  trace.on(artifacts.appendTrace)
  return { runId: "test-run", startedAt: "2026-05-01T00:00:00.000Z", trace, artifacts }
}

describe("M4 — schemaCheck", () => {
  it("引用真实存在的表 + 列时通过", () => {
    const plan = Plan.parse({
      intentId: "x",
      rationale: "x",
      steps: [
        {
          kind: "sql",
          mode: "read",
          sql: "SELECT customers.id FROM customers WHERE customers.id = 1",
        },
      ],
    })
    const result = checkSchema(plan, makeCtx())
    expect(result.passed).toBe(true)
    expect(result.findings).toEqual([])
  })

  it("引用不存在的表会产生 unknown-table finding", () => {
    const plan = Plan.parse({
      intentId: "x",
      rationale: "x",
      steps: [{ kind: "sql", mode: "read", sql: "SELECT 1 FROM nope" }],
    })
    const result = checkSchema(plan, makeCtx())
    expect(result.passed).toBe(false)
    expect(result.findings.map((f) => f.ruleId)).toContain("unknown-table")
  })

  it("引用不存在的限定列会产生 unknown-column finding", () => {
    const plan = Plan.parse({
      intentId: "x",
      rationale: "x",
      steps: [
        {
          kind: "sql",
          mode: "read",
          sql: "SELECT customers.unicorn FROM customers",
        },
      ],
    })
    const result = checkSchema(plan, makeCtx())
    expect(result.passed).toBe(false)
    const unknownCol = result.findings.find(
      (f) => f.ruleId === "unknown-column",
    )
    expect(unknownCol).toBeDefined()
    expect(unknownCol!.message).toContain("customers")
    expect(unknownCol!.message).toContain("unicorn")
  })

  it("SELECT 1 这种无表引用的查询通过", () => {
    const plan = Plan.parse({
      intentId: "x",
      rationale: "x",
      steps: [{ kind: "sql", mode: "read", sql: "SELECT 1 AS one" }],
    })
    const result = checkSchema(plan, makeCtx())
    expect(result.passed).toBe(true)
  })
})
