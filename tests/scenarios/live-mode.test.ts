/**
 * M8 测试 —— Live Mode 通过注入假 OpenAI 客户端走通完整 pipeline。
 *
 * 验证三件事：
 *   1. 合法 LLM 输出 → 走通 schema/policy/scenario/approval/execute
 *      用的是 M3-M6 同一份代码（status=committed）
 *   2. LLM 输出 PII SQL → policy 仍然拦截（status=rejected_by_policy）
 *      —— 这是 harness engineering 的核心论点的可执行证明
 *   3. LLM 返回非法 JSON / 非法 schema → emit plan.invalid_structure →
 *      run 进入 failed 终态
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { runPipeline } from "../../src/pipeline/engine.js"
import {
  setLivePlannerClientForTests,
  type ChatLike,
} from "../../src/planners/live.js"
import { resetConfig } from "../../src/config.js"
import { setupScenarioEnv, readTraceKinds, type ScenarioFixture } from "./_fixture.js"

let fx: ScenarioFixture

beforeEach(() => {
  fx = setupScenarioEnv()
  process.env.HARNESS_MODE = "live"
  process.env.OPENAI_API_KEY = "test-key-not-used"
  resetConfig()
})

afterEach(() => {
  setLivePlannerClientForTests(null)
  fx.cleanup()
})

/** 用一个固定回包构造假 OpenAI 客户端。 */
function fakeClient(responseContent: string | null): ChatLike {
  return {
    chat: {
      completions: {
        async create() {
          return {
            choices: [{ message: { content: responseContent } }],
          }
        },
      },
    },
  }
}

describe("M8 — Live Mode happy path（同下游 pipeline）", () => {
  it("合法 LLM 输出走完 5 阶段，status=committed，runs 工件齐全", async () => {
    setLivePlannerClientForTests(
      fakeClient(
        JSON.stringify({
          intentId: "live-test",
          rationale: "由假 LLM 返回的 happy path 计划",
          steps: [
            {
              kind: "sql",
              mode: "read",
              sql: "SELECT id FROM products WHERE id <= 5",
              expectedColumns: ["id"],
              estimatedRows: 5,
            },
          ],
        }),
      ),
    )

    const r = await runPipeline("anything")
    expect(r.status).toBe("committed")
    expect(existsSync(join(r.runDir, "result.json"))).toBe(true)

    const kinds = readTraceKinds(r.runDir)
    expect(kinds).toContain("plan.live_request")
    expect(kinds).toContain("plan.live_response_validated")
    expect(kinds).toContain("check.schema.passed")
    expect(kinds).toContain("check.policy.passed")
    expect(kinds).toContain("check.scenario.passed")
    expect(kinds).toContain("approval.auto_granted")
    expect(kinds).toContain("execute.committed")
    expect(kinds).toContain("finalize.committed")
  })
})

describe("M8 — Live Mode 与下游约束的交叉验证", () => {
  it("LLM 生成 PII SQL → policy 仍然拦下（同一份下游 code）", async () => {
    setLivePlannerClientForTests(
      fakeClient(
        JSON.stringify({
          intentId: "live-test",
          rationale: "假 LLM 故意输出含 PII 的 SQL，看 harness 能不能挡住",
          steps: [
            {
              kind: "sql",
              mode: "read",
              sql:
                "SELECT customers.id, customers.email, customers.phone FROM customers",
            },
          ],
        }),
      ),
    )

    const r = await runPipeline("any input")
    expect(r.status).toBe("rejected_by_policy")

    const evalJson = JSON.parse(
      readFileSync(join(r.runDir, "evaluation.json"), "utf8"),
    ) as {
      policyCheck: { findings: Array<{ ruleId: string }> }
    }
    expect(
      evalJson.policyCheck.findings.find((f) => f.ruleId === "pii-fields"),
    ).toBeDefined()
  })

  it("LLM 生成 UPDATE → destructive policy 升级为 pending-approval", async () => {
    setLivePlannerClientForTests(
      fakeClient(
        JSON.stringify({
          intentId: "live-test",
          rationale: "假 LLM 输出一个 UPDATE，验证审批升级",
          steps: [
            {
              kind: "sql",
              mode: "write",
              sql:
                "UPDATE products SET price = price WHERE id = 1",
            },
          ],
        }),
      ),
    )

    const r = await runPipeline("any input")
    expect(r.status).toBe("pending-approval")

    const kinds = readTraceKinds(r.runDir)
    expect(kinds).toContain("approval.required")
    expect(kinds).not.toContain("execute.committed")
  })
})

describe("M8 — Live Mode 错误路径", () => {
  it("LLM 返回非合法 JSON → plan.invalid_structure → status=failed", async () => {
    setLivePlannerClientForTests(fakeClient("this is not json"))

    const r = await runPipeline("any input")
    expect(r.status).toBe("failed")

    const kinds = readTraceKinds(r.runDir)
    expect(kinds).toContain("plan.live_request")
    expect(kinds).toContain("plan.invalid_structure")
    expect(kinds).toContain("finalize.failed")
  })

  it("LLM 返回 JSON 但缺字段 → plan.invalid_structure → status=failed", async () => {
    setLivePlannerClientForTests(
      fakeClient(JSON.stringify({ intentId: "x", rationale: "missing steps" })),
    )

    const r = await runPipeline("any input")
    expect(r.status).toBe("failed")

    const lines = readFileSync(join(r.runDir, "trace.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
    const invalid = lines
      .map((l) => JSON.parse(l) as { kind: string; payload?: { stage?: string } })
      .find((e) => e.kind === "plan.invalid_structure")
    expect(invalid).toBeDefined()
    expect(invalid!.payload?.stage).toBe("schema_validate")
  })

  it("HARNESS_MODE=live 但没设 API key 且没 mock → 抛 readable error", async () => {
    setLivePlannerClientForTests(null)
    delete process.env.OPENAI_API_KEY
    resetConfig()

    const r = await runPipeline("anything")
    expect(r.status).toBe("failed")

    const lines = readFileSync(join(r.runDir, "trace.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
    const failed = lines
      .map((l) => JSON.parse(l) as { kind: string; payload?: { error?: string } })
      .find((e) => e.kind === "finalize.failed")
    expect(failed).toBeDefined()
    expect(failed!.payload?.error).toMatch(/OPENAI_API_KEY/)
  })
})
