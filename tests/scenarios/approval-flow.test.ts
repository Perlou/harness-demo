/**
 * M6 端到端 —— 两阶段审批的完整路径。
 *
 * 覆盖：
 *   - approve 流程：ask → status=pending-approval → approve → committed
 *                   audit_log 出现新记录、orders.status 真的被更新
 *   - reject 流程：ask → reject --reason → status=rejected
 *                   DB 完全不变、reason 落到 trace.jsonl
 *   - 防重放：approve 一个已 committed 的 run → 报错（exit 3）
 *             approve 一个不存在的 run → 报错（exit 2）
 *             reject 一个已 rejected 的 run → 报错（exit 3）
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { closeDb, getDb } from "../../src/db/client.js"
import { runApprove } from "../../src/cli/approve.js"
import { runReject } from "../../src/cli/reject.js"
import { runPipeline } from "../../src/pipeline/engine.js"
import { setupScenarioEnv, readTraceKinds, type ScenarioFixture } from "./_fixture.js"

const APPROVE_PROMPT = "把已经发货 90 天还没确认收货的订单标记为已完成"

let fx: ScenarioFixture

beforeEach(() => {
  fx = setupScenarioEnv()
})

afterEach(() => {
  fx.cleanup()
})

describe("M6 — approve 流程", () => {
  it("ask → approve → committed，audit_log 增加，订单状态被更新", async () => {
    const ask = await runPipeline(APPROVE_PROMPT)
    expect(ask.status).toBe("pending-approval")

    closeDb()
    const dbBefore = getDb()
    const beforeShipped = (
      dbBefore
        .prepare(
          "SELECT COUNT(*) AS n FROM orders WHERE status='shipped' AND shipped_at < '2026-02-01T00:00:00.000Z'",
        )
        .get() as { n: number }
    ).n
    const beforeAudit = (
      dbBefore.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
        n: number
      }
    ).n
    closeDb()
    expect(beforeShipped).toBeGreaterThan(0)
    expect(beforeAudit).toBe(0)

    const code = await runApprove(ask.runId)
    expect(code).toBe(0)

    closeDb()
    const dbAfter = getDb()
    const afterShipped = (
      dbAfter
        .prepare(
          "SELECT COUNT(*) AS n FROM orders WHERE status='shipped' AND shipped_at < '2026-02-01T00:00:00.000Z'",
        )
        .get() as { n: number }
    ).n
    const afterCompleted = (
      dbAfter
        .prepare(
          "SELECT COUNT(*) AS n FROM orders WHERE status='completed' AND shipped_at < '2026-02-01T00:00:00.000Z'",
        )
        .get() as { n: number }
    ).n
    const afterAudit = (
      dbAfter.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
        n: number
      }
    ).n
    closeDb()

    expect(afterShipped).toBe(0)
    expect(afterCompleted).toBeGreaterThanOrEqual(beforeShipped)
    expect(afterAudit).toBe(1)

    const status = readFileSync(join(ask.runDir, "status"), "utf8").trim()
    expect(status).toBe("committed")
    const kinds = readTraceKinds(ask.runDir)
    expect(kinds).toContain("approval.user_approved")
    expect(kinds).toContain("execute.committed")
    expect(kinds).toContain("finalize.committed")
  })
})

describe("M6 — reject 流程", () => {
  it("ask → reject --reason → rejected，DB 不变，理由落到 trace", async () => {
    const ask = await runPipeline(APPROVE_PROMPT)
    expect(ask.status).toBe("pending-approval")

    const code = await runReject(ask.runId, "范围太宽，先在 staging 上跑一遍")
    expect(code).toBe(0)

    closeDb()
    const audit = (
      getDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
        n: number
      }
    ).n
    closeDb()
    expect(audit).toBe(0)

    const status = readFileSync(join(ask.runDir, "status"), "utf8").trim()
    expect(status).toBe("rejected")

    const lines = readFileSync(join(ask.runDir, "trace.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
    const rejectEvent = lines
      .map((l) => JSON.parse(l) as { kind: string; payload?: { reason?: string } })
      .find((e) => e.kind === "approval.user_rejected")
    expect(rejectEvent).toBeDefined()
    expect(rejectEvent!.payload?.reason).toContain("staging")
  })

  it("空 reason 应当报错（exit 4）", async () => {
    const ask = await runPipeline(APPROVE_PROMPT)
    const code = await runReject(ask.runId, "   ")
    expect(code).toBe(4)
    const status = readFileSync(join(ask.runDir, "status"), "utf8").trim()
    expect(status).toBe("pending-approval")
  })
})

describe("M6 — 防重放", () => {
  it("approve 一个不存在的 run id 报错 exit 2", async () => {
    const code = await runApprove("does-not-exist")
    expect(code).toBe(2)
  })

  it("approve 一个已 committed 的 run 报错 exit 3，DB 不再变化", async () => {
    const ask = await runPipeline(APPROVE_PROMPT)
    expect(ask.status).toBe("pending-approval")
    const first = await runApprove(ask.runId)
    expect(first).toBe(0)

    closeDb()
    const auditAfterFirst = (
      getDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
        n: number
      }
    ).n
    closeDb()

    const second = await runApprove(ask.runId)
    expect(second).toBe(3)

    closeDb()
    const auditAfterSecond = (
      getDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
        n: number
      }
    ).n
    closeDb()
    expect(auditAfterSecond).toBe(auditAfterFirst)
  })

  it("reject 一个已 rejected 的 run 报错 exit 3", async () => {
    const ask = await runPipeline(APPROVE_PROMPT)
    const first = await runReject(ask.runId, "reason 1")
    expect(first).toBe(0)
    const second = await runReject(ask.runId, "reason 2")
    expect(second).toBe(3)
  })

  it("approve 一个 read 模式 committed 的 run（A 剧本）报错 exit 3", async () => {
    const ask = await runPipeline("上个月销售前 5 的产品")
    expect(ask.status).toBe("committed")
    const code = await runApprove(ask.runId)
    expect(code).toBe(3)
  })

  it("reject 一个 rejected_by_policy 的 run 报错 exit 3", async () => {
    const ask = await runPipeline("导出所有客户的邮箱和手机号")
    expect(ask.status).toBe("rejected_by_policy")
    const code = await runReject(ask.runId, "...")
    expect(code).toBe(3)
  })
})

describe("M6 — show / runs 命令的存在性", () => {
  it("show 不存在的 run 报错 exit 2", async () => {
    const { runShow } = await import("../../src/cli/show.js")
    expect(runShow("nope")).toBe(2)
  })

  it("show 一个 pending-approval run 能合成 markdown 摘要", async () => {
    const { runShow } = await import("../../src/cli/show.js")
    const ask = await runPipeline(APPROVE_PROMPT)
    // 重定向 stdout 不易；直接 import 的好处是函数可被 spy。
    // 这里只断言 exit code 与文件不报错即可——内容由 fallback 合成。
    expect(runShow(ask.runId)).toBe(0)
    expect(existsSync(ask.runDir)).toBe(true)
  })
})
