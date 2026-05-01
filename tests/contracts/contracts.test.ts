/**
 * M2 单测：契约 schema 的合法 / 非法样例。
 *
 * 这一组测试既是回归保护，也是契约 schema 的"使用说明书"——后续阅读
 * 时这里给出的合法样例可以直接复制到代码里使用。
 */

import { describe, expect, it } from "vitest"

import {
  IntentSpec,
  Plan,
  SqlAction,
  EvaluationResult,
  CheckFinding,
  TraceEvent,
  RunStatus,
  isTerminal,
} from "../../harness/contracts/index.js"

describe("M2 — IntentSpec", () => {
  it("接受一个最小合法对象", () => {
    const parsed = IntentSpec.parse({
      rawText: "上个月销售前 5 的产品",
      goal: "aggregate",
      scope: { tables: ["orders", "order_items", "products"] },
      assumptions: ["按总金额排序", "上个月 = 上一个完整自然月"],
      riskLevel: "read",
      successCriteria: ["返回 5 行"],
    })
    expect(parsed.scope.tables).toHaveLength(3)
    expect(parsed.riskLevel).toBe("read")
  })

  it("默认为 assumptions / successCriteria 提供空数组", () => {
    const parsed = IntentSpec.parse({
      rawText: "任意文本",
      goal: "query",
      scope: { tables: ["products"] },
      riskLevel: "read",
    })
    expect(parsed.assumptions).toEqual([])
    expect(parsed.successCriteria).toEqual([])
  })

  it("拒绝未知的 goal", () => {
    expect(() =>
      IntentSpec.parse({
        rawText: "x",
        goal: "delete-everything",
        scope: { tables: ["x"] },
        riskLevel: "read",
      }),
    ).toThrow()
  })

  it("拒绝空的 scope.tables", () => {
    expect(() =>
      IntentSpec.parse({
        rawText: "x",
        goal: "query",
        scope: { tables: [] },
        riskLevel: "read",
      }),
    ).toThrow()
  })

  it("接受可选的 timeWindow", () => {
    const parsed = IntentSpec.parse({
      rawText: "x",
      goal: "aggregate",
      scope: {
        tables: ["orders"],
        timeWindow: { from: "2026-04-01", to: "2026-04-30" },
      },
      riskLevel: "read",
    })
    expect(parsed.scope.timeWindow?.from).toBe("2026-04-01")
  })
})

describe("M2 — Plan / SqlAction", () => {
  it("接受一个 read 模式的 SQL plan", () => {
    const plan = Plan.parse({
      intentId: "run-r3k9",
      rationale: "聚合 order_items 后 join products 取 top 5",
      steps: [
        {
          kind: "sql",
          mode: "read",
          sql: "SELECT product_id, SUM(quantity) AS qty FROM order_items GROUP BY product_id ORDER BY qty DESC LIMIT 5",
          expectedColumns: ["product_id", "qty"],
        },
      ],
    })
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.kind).toBe("sql")
  })

  it("拒绝空 steps", () => {
    expect(() =>
      Plan.parse({
        intentId: "x",
        steps: [],
        rationale: "x",
      }),
    ).toThrow()
  })

  it("拒绝未知的 action kind（discriminated union 严格性）", () => {
    expect(() =>
      Plan.parse({
        intentId: "x",
        steps: [{ kind: "shell", command: "rm -rf /" }],
        rationale: "x",
      }),
    ).toThrow()
  })

  it("SqlAction.mode 必须是 read 或 write", () => {
    expect(() =>
      SqlAction.parse({ kind: "sql", mode: "delete", sql: "..." }),
    ).toThrow()
  })

  it("SqlAction.estimatedRows 必须非负整数", () => {
    expect(() =>
      SqlAction.parse({
        kind: "sql",
        mode: "read",
        sql: "SELECT 1",
        estimatedRows: -1,
      }),
    ).toThrow()
  })
})

describe("M2 — EvaluationResult / CheckFinding", () => {
  it("接受三道检查全过的合并结果", () => {
    const result = EvaluationResult.parse({
      schemaCheck: { passed: true, findings: [] },
      policyCheck: { passed: true, findings: [] },
      scenarioCheck: { passed: true, findings: [] },
      passed: true,
    })
    expect(result.passed).toBe(true)
  })

  it("接受带 finding 的失败结果", () => {
    const finding: CheckFinding = {
      ruleId: "pii-fields",
      level: "error",
      message: "字段 customers.email 是 PII，不允许暴露",
      suggestion: "改用 customers.id",
      location: "steps[0].sql 第 1 列",
    }
    const result = EvaluationResult.parse({
      schemaCheck: { passed: true, findings: [] },
      policyCheck: { passed: false, findings: [finding] },
      scenarioCheck: { passed: true, findings: [] },
      passed: false,
    })
    expect(result.policyCheck.findings).toHaveLength(1)
    expect(result.policyCheck.findings[0]!.ruleId).toBe("pii-fields")
  })

  it("CheckFinding 拒绝未知的 level", () => {
    expect(() =>
      CheckFinding.parse({
        ruleId: "x",
        level: "panic",
        message: "x",
      }),
    ).toThrow()
  })

  it("CheckOutcome.findings 默认为空数组", () => {
    const result = EvaluationResult.parse({
      schemaCheck: { passed: true },
      policyCheck: { passed: true },
      scenarioCheck: { passed: true },
      passed: true,
    })
    expect(result.schemaCheck.findings).toEqual([])
  })
})

describe("M2 — TraceEvent", () => {
  it("接受一条标准的事件记录", () => {
    const ev = TraceEvent.parse({
      ts: "2026-05-01T10:00:00.000Z",
      runId: "run-r3k9",
      stage: "check",
      kind: "check.policy.failed",
      payload: { ruleId: "pii-fields" },
    })
    expect(ev.stage).toBe("check")
  })

  it("payload 默认为空对象", () => {
    const ev = TraceEvent.parse({
      ts: "2026-05-01T10:00:00.000Z",
      runId: "run-r3k9",
      stage: "intent",
      kind: "intent.received",
    })
    expect(ev.payload).toEqual({})
  })

  it("拒绝未知 stage", () => {
    expect(() =>
      TraceEvent.parse({
        ts: "x",
        runId: "x",
        stage: "wat",
        kind: "x",
      }),
    ).toThrow()
  })
})

describe("M2 — RunStatus / isTerminal", () => {
  it("识别终态", () => {
    const terminals: ReadonlyArray<typeof RunStatus._type> = [
      "rejected",
      "rejected_by_schema",
      "rejected_by_policy",
      "rejected_by_scenario",
      "committed",
      "committed_failed",
      "failed",
    ]
    for (const s of terminals) expect(isTerminal(s)).toBe(true)
  })

  it("识别非终态", () => {
    const transients: ReadonlyArray<typeof RunStatus._type> = [
      "created",
      "checked",
      "pending-approval",
      "auto-approved",
      "approved",
    ]
    for (const s of transients) expect(isTerminal(s)).toBe(false)
  })

  it("解析合法状态字符串", () => {
    expect(RunStatus.parse("pending-approval")).toBe("pending-approval")
  })

  it("拒绝未知状态", () => {
    expect(() => RunStatus.parse("zombie")).toThrow()
  })
})
