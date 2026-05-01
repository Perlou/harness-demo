/**
 * M7 端到端 —— 4 个剧本各自的 report.md 内容应当包含预期片段。
 *
 * 这是 docs/roadmap.md M7 的 done-when：把任意 run 的 report.md 拿给陌生人看，
 * 他能复述这次运行发生了什么。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { runApprove } from "../../src/cli/approve.js"
import { runReject } from "../../src/cli/reject.js"
import { runPipeline } from "../../src/pipeline/engine.js"
import { setupScenarioEnv, type ScenarioFixture } from "./_fixture.js"

let fx: ScenarioFixture

beforeEach(() => {
  fx = setupScenarioEnv()
})

afterEach(() => {
  fx.cleanup()
})

function readReport(runDir: string): string {
  const path = join(runDir, "report.md")
  expect(existsSync(path)).toBe(true)
  return readFileSync(path, "utf8")
}

describe("M7 — 剧本 A · top-sales 报告", () => {
  it("status committed，含 Intent/Plan/Evaluation/Decision/Result 五大节", async () => {
    const r = await runPipeline("上个月销售前 5 的产品")
    expect(r.status).toBe("committed")
    const md = readReport(r.runDir)

    expect(md).toContain(`# Run \`${r.runId}\``)
    expect(md).toContain("status `committed`")
    expect(md).toContain("## Intent")
    expect(md).toContain("> 上个月销售前 5 的产品")
    expect(md).toContain("Goal | `aggregate`")
    expect(md).toContain("Risk Level | `read`")
    expect(md).toContain("## Plan")
    expect(md).toContain("```sql")
    expect(md).toContain("FROM order_items oi")
    expect(md).toContain("## Evaluation")
    expect(md).toContain("整体结论：**PASS**")
    expect(md).toContain("## Decision")
    expect(md).toContain("已提交")
    expect(md).toContain("## Result")
    expect(md).toContain("| product_id | product_name | revenue | units_sold |")
    expect(md).toContain("## Trace 摘要")
  })
})

describe("M7 — 剧本 B · pii-rejection 报告", () => {
  it("Decision 标拦截，Findings 中含 pii-fields", async () => {
    const r = await runPipeline("导出所有客户的邮箱和手机号")
    expect(r.status).toBe("rejected_by_policy")
    const md = readReport(r.runDir)

    expect(md).toContain("status `rejected_by_policy`")
    expect(md).toContain("被 Policy 检查拦下")
    expect(md).toContain("### Findings")
    expect(md).toContain("**pii-fields**")
    expect(md).toContain("level=error")
    expect(md).toContain("customers.email")
    // 没有 Result 节，因为没有执行
    expect(md).not.toContain("## Result")
  })
})

describe("M7 — 剧本 C · missing-time-bounds 报告", () => {
  it("Findings 含 require-time-bounds 与可用 suggestion", async () => {
    const r = await runPipeline("orders 表里有多少行")
    expect(r.status).toBe("rejected_by_policy")
    const md = readReport(r.runDir)

    expect(md).toContain("**require-time-bounds**")
    expect(md).toMatch(/建议：.*ordered_at|时间/)
  })
})

describe("M7 — 剧本 D · approval-gate 报告（pending → approve）", () => {
  it("pending-approval 报告含命令提示与升级理由", async () => {
    const r = await runPipeline("把已经发货 90 天还没确认收货的订单标记为已完成")
    expect(r.status).toBe("pending-approval")
    const pendingMd = readReport(r.runDir)

    expect(pendingMd).toContain("等待人工动作")
    expect(pendingMd).toContain(`harness approve ${r.runId}`)
    expect(pendingMd).toContain(`harness reject  ${r.runId} --reason`)
    expect(pendingMd).toContain("触发审批的原因")
    expect(pendingMd).toContain("destructive-needs-approval")
  })

  it("approve 之后报告被重写为 committed + Result", async () => {
    const r = await runPipeline("把已经发货 90 天还没确认收货的订单标记为已完成")
    const code = await runApprove(r.runId)
    expect(code).toBe(0)
    const md = readReport(r.runDir)

    expect(md).toContain("status `committed`")
    expect(md).toContain("已提交")
    expect(md).toContain("## Result")
    expect(md).toContain("受影响行数")
    // 升级提示已不再显示
    expect(md).not.toContain("等待人工动作")
  })

  it("reject 之后报告被重写为 rejected + 包含理由", async () => {
    const r = await runPipeline("把已经发货 90 天还没确认收货的订单标记为已完成")
    const code = await runReject(r.runId, "范围太宽，先在 staging 上跑一次")
    expect(code).toBe(0)
    const md = readReport(r.runDir)

    expect(md).toContain("status `rejected`")
    expect(md).toContain("用户拒绝")
    expect(md).toContain("> 理由：范围太宽，先在 staging 上跑一次")
  })
})

describe("M7 — Trace 摘要节", () => {
  it("按 stage 分组并展示总数", async () => {
    const r = await runPipeline("上个月销售前 5 的产品")
    const md = readReport(r.runDir)
    expect(md).toMatch(/共 \d+ 条事件/)
    expect(md).toMatch(/- intent: \d/)
    expect(md).toMatch(/- plan: \d/)
    expect(md).toMatch(/- check: \d/)
    expect(md).toMatch(/- approve: \d/)
    expect(md).toMatch(/- execute: \d/)
    expect(md).toMatch(/- finalize: \d/)
  })
})
