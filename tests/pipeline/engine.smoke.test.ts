/**
 * M3 端到端冒烟测试：`harness ask "select 1"` 走通完整 pipeline，
 * runs/<id>/ 工件齐全，trace.jsonl 包含五阶段事件。
 *
 * 这是 docs/roadmap.md M3 的判定标准。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { closeDb } from "../../src/db/client.js"
import { seed } from "../../src/db/seed.js"
import { runPipeline } from "../../src/pipeline/engine.js"
import { resetConfig } from "../../src/config.js"
import {
  TraceEvent,
  type TraceStage,
} from "../../harness/contracts/index.js"

let tmpRoot: string
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  tmpRoot = mkdtempSync(join(tmpdir(), "harness-m3-"))
  process.env.HARNESS_DB_PATH = join(tmpRoot, "demo.sqlite")
  process.env.HARNESS_RUNS_DIR = join(tmpRoot, "runs")
  resetConfig()
  closeDb()
  seed()
  closeDb()
})

afterEach(() => {
  closeDb()
  process.env = originalEnv
  resetConfig()
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("M3 — pipeline 骨架贯通", () => {
  it("一次 ask 落盘完整 runs/<id>/ 工件目录", async () => {
    const result = await runPipeline("select 1")

    expect(result.status).toBe("committed")
    expect(existsSync(result.runDir)).toBe(true)

    const expectFiles = [
      "intent.json",
      "plan.json",
      "evaluation.json",
      "trace.jsonl",
      "status",
      "result.json",
    ]
    for (const f of expectFiles) {
      expect(existsSync(join(result.runDir, f))).toBe(true)
    }

    const status = readFileSync(join(result.runDir, "status"), "utf8").trim()
    expect(status).toBe("committed")
  })

  it("trace.jsonl 包含全部五个阶段的事件", async () => {
    const result = await runPipeline("hello world")
    const lines = readFileSync(join(result.runDir, "trace.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)

    // 每行都是合法的 TraceEvent
    const events = lines.map((l) => TraceEvent.parse(JSON.parse(l)))

    const stagesSeen = new Set<TraceStage>(events.map((e) => e.stage))
    expect(stagesSeen.has("intent")).toBe(true)
    expect(stagesSeen.has("plan")).toBe(true)
    expect(stagesSeen.has("check")).toBe(true)
    expect(stagesSeen.has("approve")).toBe(true)
    expect(stagesSeen.has("execute")).toBe(true)
    expect(stagesSeen.has("finalize")).toBe(true)
  })

  it("trace 事件 kind 包含关键里程碑", async () => {
    const result = await runPipeline("any text")
    const lines = readFileSync(join(result.runDir, "trace.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
    const kinds = lines.map((l) => (JSON.parse(l) as { kind: string }).kind)

    expect(kinds).toContain("intent.received")
    expect(kinds).toContain("intent.normalized")
    expect(kinds).toContain("plan.generated")
    expect(kinds).toContain("check.schema.passed")
    expect(kinds).toContain("check.policy.passed")
    expect(kinds).toContain("check.scenario.passed")
    expect(kinds).toContain("approval.auto_granted")
    expect(kinds).toContain("execute.committed")
    expect(kinds).toContain("finalize.committed")
  })

  it("read 模式 plan 的执行结果会写到 result.json", async () => {
    const result = await runPipeline("anything")
    const raw = readFileSync(join(result.runDir, "result.json"), "utf8")
    const parsed = JSON.parse(raw) as {
      committed: boolean
      steps: Array<{ mode: string; rows?: unknown[] }>
    }
    expect(parsed.committed).toBe(true)
    expect(parsed.steps).toHaveLength(1)
    expect(parsed.steps[0]!.mode).toBe("read")
    expect(parsed.steps[0]!.rows).toEqual([{ one: 1 }])
  })

  it("intent.json / plan.json 是合法 JSON 且字段齐全", async () => {
    const result = await runPipeline("anything")
    const intent = JSON.parse(
      readFileSync(join(result.runDir, "intent.json"), "utf8"),
    ) as { goal: string; riskLevel: string }
    const plan = JSON.parse(
      readFileSync(join(result.runDir, "plan.json"), "utf8"),
    ) as { steps: unknown[] }
    expect(intent.goal).toBe("query")
    expect(intent.riskLevel).toBe("read")
    expect(plan.steps).toHaveLength(1)
  })
})
