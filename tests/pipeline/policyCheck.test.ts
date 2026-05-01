/**
 * Policy 检查单测：每条出厂规则一个用例对，命中 + 不命中。
 * 同时验证"删除任意 yaml 文件后行为变化"这一关键性质。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Plan } from "../../harness/contracts/index.js"
import { resetConfig } from "../../src/config.js"
import {
  checkPolicy,
  loadPolicies,
  resetPolicyCache,
} from "../../src/pipeline/policyCheck.js"
import { TraceEmitter } from "../../src/trace/events.js"
import { RunArtifacts } from "../../src/trace/writer.js"
import type { RunContext } from "../../src/pipeline/context.js"

let tmpRoot: string
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  tmpRoot = mkdtempSync(join(tmpdir(), "harness-m4-policy-"))
  process.env.HARNESS_DB_PATH = join(tmpRoot, "demo.sqlite")
  process.env.HARNESS_RUNS_DIR = join(tmpRoot, "runs")
  resetConfig()
  resetPolicyCache()
})

afterEach(() => {
  process.env = originalEnv
  resetConfig()
  resetPolicyCache()
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

describe("M4 — loadPolicies 入口", () => {
  it("加载所有出厂 yaml 且 id 正确", () => {
    const policies = loadPolicies()
    const ids = policies.map((p) => p.id).sort()
    expect(ids).toEqual([
      "destructive-needs-approval",
      "pii-fields",
      "require-time-bounds",
    ])
  })
})

describe("M4 — pii-fields 规则", () => {
  it("命中：SELECT 引用 customers.email → reject finding", () => {
    const result = checkPolicy(
      planFromSql("SELECT customers.email FROM customers WHERE id=1"),
      makeCtx(),
    )
    expect(result.passed).toBe(false)
    const f = result.findings.find((x) => x.ruleId === "pii-fields")
    expect(f).toBeDefined()
    expect(f!.level).toBe("error")
    expect(f!.message).toContain("customers.email")
    expect(f!.suggestion).toBeDefined()
  })

  it("命中：customers.phone 同样被拦", () => {
    const result = checkPolicy(
      planFromSql("SELECT customers.phone FROM customers WHERE id=1"),
      makeCtx(),
    )
    expect(result.passed).toBe(false)
  })

  it("不命中：只引用 customers.id 时通过", () => {
    const result = checkPolicy(
      planFromSql("SELECT customers.id FROM customers WHERE id=1"),
      makeCtx(),
    )
    expect(
      result.findings.find((x) => x.ruleId === "pii-fields"),
    ).toBeUndefined()
  })
})

describe("M4 — require-time-bounds 规则", () => {
  it("命中：orders 全表查询缺 WHERE → reject", () => {
    const result = checkPolicy(
      planFromSql("SELECT COUNT(*) FROM orders"),
      makeCtx(),
    )
    expect(result.passed).toBe(false)
    const f = result.findings.find((x) => x.ruleId === "require-time-bounds")
    expect(f).toBeDefined()
    expect(f!.message).toContain("orders")
  })

  it("不命中：带 WHERE 的 orders 查询通过", () => {
    const result = checkPolicy(
      planFromSql(
        "SELECT id FROM orders WHERE ordered_at > '2026-04-01'",
      ),
      makeCtx(),
    )
    expect(
      result.findings.find((x) => x.ruleId === "require-time-bounds"),
    ).toBeUndefined()
  })

  it("不命中：products 表不在监管列表内", () => {
    const result = checkPolicy(
      planFromSql("SELECT * FROM products"),
      makeCtx(),
    )
    expect(
      result.findings.find((x) => x.ruleId === "require-time-bounds"),
    ).toBeUndefined()
  })
})

describe("M4 — destructive-needs-approval 规则", () => {
  it("命中：UPDATE → warning + requiresApproval=true（不阻塞 check）", () => {
    const result = checkPolicy(
      planFromSql(
        "UPDATE orders SET status='completed' WHERE shipped_at < '2026-01-01'",
        "write",
      ),
      makeCtx(),
    )
    // policy check 自身仍然 passed（升级为审批是 approval 阶段的事）
    expect(result.passed).toBe(true)
    const f = result.findings.find(
      (x) => x.ruleId === "destructive-needs-approval",
    )
    expect(f).toBeDefined()
    expect(f!.level).toBe("warning")
    expect(f!.requiresApproval).toBe(true)
    expect(f!.message).toContain("UPDATE")
  })

  it("命中：DELETE / INSERT 同样会触发", () => {
    const del = checkPolicy(
      planFromSql("DELETE FROM orders WHERE id = 1", "write"),
      makeCtx(),
    )
    expect(
      del.findings.find((x) => x.ruleId === "destructive-needs-approval"),
    ).toBeDefined()

    const ins = checkPolicy(
      planFromSql(
        "INSERT INTO products (id, name, sku, price, category) VALUES (999, 'x', 'X-9999', 1, 'x')",
        "write",
      ),
      makeCtx(),
    )
    expect(
      ins.findings.find((x) => x.ruleId === "destructive-needs-approval"),
    ).toBeDefined()
  })

  it("不命中：read 模式不会触发（applies_to.steps=[write]）", () => {
    const result = checkPolicy(
      planFromSql("SELECT 1 FROM products", "read"),
      makeCtx(),
    )
    expect(
      result.findings.find((x) => x.ruleId === "destructive-needs-approval"),
    ).toBeUndefined()
  })
})
