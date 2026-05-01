/**
 * report.md 渲染器。
 *
 * 输入：单次运行的全部已知工件（intent / plan / evaluation / result / status / trace）
 * 输出：一份给人看的 markdown 报告，让陌生人不读源码也能复述这次运行发生了什么。
 *
 * 这个模块被 4 个调用点共享：
 *   - engine.finalize()        每次 finalize 之前写一次
 *   - cli/approve.ts           approve 后重写（覆盖前一版 pending）
 *   - cli/reject.ts            reject 后重写（覆盖前一版 pending）
 *   - cli/show.ts              如果磁盘上没有 report.md，现场合成一份
 *
 * 设计取舍：模板里的字段大多是可选的——失败路径下 result 不存在、policy
 * 拦截路径下 plan 仍然有意义。渲染器优雅地处理缺字段。
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type {
  EvaluationResult,
  IntentSpec,
  Plan,
  RunStatus,
  TraceEvent,
} from "../../harness/contracts/index.js"
import { TraceEvent as TraceEventSchema } from "../../harness/contracts/index.js"
import type { ExecuteResult } from "../pipeline/executor.js"

export interface ReportInput {
  runId: string
  status: RunStatus
  mode: "demo" | "live"
  startedAt: string
  finishedAt: string
  intent?: IntentSpec | undefined
  plan?: Plan | undefined
  evaluation?: EvaluationResult | undefined
  result?: ExecuteResult | undefined
  /** 用户拒绝时的理由（仅在 status === "rejected" 时使用）。 */
  rejectReason?: string | undefined
  /** 命中的剧本 id（仅在 demo 模式有意义）。 */
  detectedCase?: string | undefined
}

const STATUS_LABEL: Record<RunStatus, string> = {
  created: "已创建",
  checked: "检查完成",
  "pending-approval": "等待人工审批",
  "auto-approved": "自动放行",
  approved: "已批准",
  rejected: "用户拒绝",
  rejected_by_schema: "Schema 检查未通过",
  rejected_by_policy: "Policy 检查未通过",
  rejected_by_scenario: "Scenario 检查未通过",
  committed: "已提交",
  committed_failed: "提交失败（事务已回滚）",
  failed: "运行异常终止",
}

export function renderReport(input: ReportInput, runDir: string): string {
  const traceEvents = readTraceEvents(runDir)

  const sections: string[] = []
  sections.push(renderHeader(input))
  if (input.intent) sections.push(renderIntent(input.intent, input.detectedCase))
  if (input.plan) sections.push(renderPlan(input.plan))
  if (input.evaluation) sections.push(renderEvaluation(input.evaluation))
  sections.push(renderDecision(input))
  if (input.result) sections.push(renderResult(input.result))
  sections.push(renderTraceSummary(traceEvents, input.runId))

  return sections.join("\n\n---\n\n") + "\n"
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader(input: ReportInput): string {
  const ms = duration(input.startedAt, input.finishedAt)
  return [
    `# Run \`${input.runId}\``,
    "",
    `**${STATUS_LABEL[input.status]}** · status \`${input.status}\``,
    "",
    "| 字段 | 值 |",
    "|---|---|",
    `| Mode | ${input.mode} |`,
    `| Started | ${input.startedAt} |`,
    `| Finished | ${input.finishedAt} |`,
    `| Duration | ${ms} ms |`,
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

function renderIntent(intent: IntentSpec, detectedCase: string | undefined): string {
  const lines: string[] = []
  lines.push("## Intent", "")
  lines.push(`> ${intent.rawText}`, "")

  lines.push("| 字段 | 值 |")
  lines.push("|---|---|")
  lines.push(`| Goal | \`${intent.goal}\` |`)
  lines.push(`| Risk Level | \`${intent.riskLevel}\` |`)
  lines.push(`| Tables | ${intent.scope.tables.map((t) => `\`${t}\``).join(", ")} |`)
  if (intent.scope.timeWindow) {
    lines.push(
      `| Time Window | ${intent.scope.timeWindow.from} → ${intent.scope.timeWindow.to} |`,
    )
  }
  if (detectedCase) lines.push(`| Detected Case | \`${detectedCase}\` |`)
  lines.push("")

  if (intent.assumptions.length > 0) {
    lines.push("**Assumptions**", "")
    for (const a of intent.assumptions) lines.push(`- ${a}`)
    lines.push("")
  }
  if (intent.successCriteria.length > 0) {
    lines.push("**Success Criteria**", "")
    for (const s of intent.successCriteria) lines.push(`- ${s}`)
  }

  return lines.join("\n").trimEnd()
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function renderPlan(plan: Plan): string {
  const lines: string[] = []
  lines.push("## Plan", "")
  lines.push(`> ${plan.rationale}`, "")

  plan.steps.forEach((step, i) => {
    if (step.kind !== "sql") return
    lines.push(`### Step ${i + 1} · \`${step.mode}\``, "")
    lines.push("```sql")
    lines.push(step.sql.trim())
    lines.push("```")
    const meta: string[] = []
    if (step.expectedColumns && step.expectedColumns.length > 0) {
      meta.push(
        `expected columns: ${step.expectedColumns.map((c) => `\`${c}\``).join(", ")}`,
      )
    }
    if (typeof step.estimatedRows === "number") {
      meta.push(`estimated rows: ${step.estimatedRows}`)
    }
    if (meta.length > 0) {
      lines.push("")
      for (const m of meta) lines.push(`- ${m}`)
    }
    lines.push("")
  })

  return lines.join("\n").trimEnd()
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function renderEvaluation(evaluation: EvaluationResult): string {
  const lines: string[] = []
  lines.push("## Evaluation", "")
  lines.push("| 检查 | 结果 | findings |")
  lines.push("|---|---|---|")
  lines.push(
    `| Schema | ${tag(evaluation.schemaCheck.passed)} | ${evaluation.schemaCheck.findings.length} |`,
  )
  lines.push(
    `| Policy | ${tag(evaluation.policyCheck.passed)} | ${evaluation.policyCheck.findings.length} |`,
  )
  lines.push(
    `| Scenario | ${tag(evaluation.scenarioCheck.passed)} | ${evaluation.scenarioCheck.findings.length} |`,
  )
  lines.push("")
  lines.push(`整体结论：**${tag(evaluation.passed)}**`)

  const findings = [
    ...evaluation.schemaCheck.findings,
    ...evaluation.policyCheck.findings,
    ...evaluation.scenarioCheck.findings,
  ]
  if (findings.length > 0) {
    lines.push("", "### Findings", "")
    for (const f of findings) {
      const tags: string[] = [`level=${f.level}`]
      if (f.requiresApproval === true) tags.push("requiresApproval")
      lines.push(`- **${f.ruleId}** (${tags.join(", ")}) — ${f.message}`)
      if (f.suggestion) lines.push(`  - 建议：${f.suggestion}`)
      if (f.location) lines.push(`  - 位置：\`${f.location}\``)
    }
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

function renderDecision(input: ReportInput): string {
  const lines: string[] = []
  lines.push("## Decision", "")

  switch (input.status) {
    case "committed":
      lines.push("✅ **已提交**。三道检查通过，审批已获得，业务变更已落盘。")
      break
    case "auto-approved":
      lines.push(
        "**自动放行**（read 或 write-low），三道检查全过且没有升级 finding。",
      )
      break
    case "pending-approval":
      lines.push("⏳ **等待人工动作**。", "")
      lines.push("```bash")
      lines.push(`harness approve ${input.runId}`)
      lines.push(`harness reject  ${input.runId} --reason "..."`)
      lines.push("```")
      lines.push(...escalationReason(input.evaluation))
      break
    case "rejected":
      lines.push("🚫 **用户拒绝**。", "")
      if (input.rejectReason) lines.push(`> 理由：${input.rejectReason}`, "")
      break
    case "rejected_by_schema":
      lines.push("🚫 **被 Schema 检查拦下**。结构都不合法，下游未跑。")
      break
    case "rejected_by_policy":
      lines.push("🚫 **被 Policy 检查拦下**。未进入审批与执行阶段。")
      break
    case "rejected_by_scenario":
      lines.push("🚫 **被 Scenario 检查拦下**。未进入审批与执行阶段。")
      break
    case "committed_failed":
      lines.push("⚠️ **提交失败**。事务已回滚，业务状态保持不变。")
      break
    case "failed":
      lines.push("❌ **运行异常终止**。详见 trace.jsonl。")
      break
    default:
      lines.push(`status = \`${input.status}\``)
  }
  return lines.join("\n").trimEnd()
}

function escalationReason(evaluation: EvaluationResult | undefined): string[] {
  if (!evaluation) return []
  const escalations = [
    ...evaluation.schemaCheck.findings,
    ...evaluation.policyCheck.findings,
    ...evaluation.scenarioCheck.findings,
  ].filter((f) => f.requiresApproval === true)
  if (escalations.length === 0) return []
  const out: string[] = ["", "**触发审批的原因：**"]
  for (const f of escalations) out.push(`- \`${f.ruleId}\` — ${f.message}`)
  return out
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

const RESULT_PREVIEW_ROWS = 10

function renderResult(result: ExecuteResult): string {
  const lines: string[] = []
  lines.push("## Result", "")
  lines.push(`committed = \`${result.committed}\``)
  if (result.error) lines.push(`error = \`${result.error}\``)
  lines.push("")

  result.steps.forEach((step, i) => {
    lines.push(`### Step ${i + 1} · \`${step.mode}\``, "")
    if (step.mode === "read") {
      lines.push(`返回行数：${step.rowCount ?? 0}`, "")
      const rows = step.rows ?? []
      if (rows.length === 0) {
        lines.push("（无返回行）")
      } else {
        const preview = rows.slice(0, RESULT_PREVIEW_ROWS)
        lines.push(...renderRowsTable(preview))
        if ((step.rowCount ?? 0) > preview.length) {
          lines.push(
            "",
            `_仅展示前 ${preview.length} 行，完整结果见 \`result.json\`_`,
          )
        }
      }
    } else {
      lines.push(`受影响行数：${step.changes ?? 0}`)
    }
    lines.push("")
  })
  return lines.join("\n").trimEnd()
}

function renderRowsTable(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  if (rows.length === 0) return []
  const cols = Object.keys(rows[0]!)
  const lines: string[] = []
  lines.push(`| ${cols.join(" | ")} |`)
  lines.push(`| ${cols.map(() => "---").join(" | ")} |`)
  for (const row of rows) {
    lines.push(`| ${cols.map((c) => formatCell(row[c])).join(" | ")} |`)
  }
  return lines
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return "`" + JSON.stringify(value) + "`"
  return String(value)
}

// ---------------------------------------------------------------------------
// Trace summary
// ---------------------------------------------------------------------------

function renderTraceSummary(events: ReadonlyArray<TraceEvent>, runId: string): string {
  const byStage = new Map<string, number>()
  for (const e of events) byStage.set(e.stage, (byStage.get(e.stage) ?? 0) + 1)

  const lines: string[] = []
  lines.push("## Trace 摘要", "")
  lines.push(`共 ${events.length} 条事件：`, "")
  for (const [stage, count] of byStage) lines.push(`- ${stage}: ${count}`)
  lines.push("", `完整事件流见 \`runs/${runId}/trace.jsonl\`。`)
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function tag(ok: boolean): string {
  return ok ? "PASS" : "FAIL"
}

function duration(start: string, end: string): number {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime())
}

function readTraceEvents(runDir: string): TraceEvent[] {
  try {
    const raw = readFileSync(join(runDir, "trace.jsonl"), "utf8")
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => TraceEventSchema.parse(JSON.parse(l)))
  } catch {
    return []
  }
}
