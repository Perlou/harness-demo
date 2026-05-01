/**
 * `harness show <run-id>` —— 打印某个运行的报告。
 *
 * M6 阶段：如果 runs/<id>/report.md 存在就直接输出；不存在则现场合成
 * 一份简易摘要（基于 intent / plan / evaluation / status）。
 *
 * M7 会让 engine.ts 在 finalize 时把 report.md 真正落盘，届时 show 永远
 * 走"直接读 report.md"分支。
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  EvaluationResult,
  IntentSpec,
  Plan,
} from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"

export function runShow(runId: string): number {
  const cfg = getConfig()
  const runDir = join(cfg.runsDir, runId)
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
    process.stderr.write(`[harness] 运行 ${runId} 不存在\n`)
    return 2
  }

  const reportPath = join(runDir, "report.md")
  if (existsSync(reportPath)) {
    process.stdout.write(readFileSync(reportPath, "utf8"))
    return 0
  }

  // fallback：现场合成简易摘要
  process.stdout.write(synthesizeReport(runDir, runId))
  return 0
}

function synthesizeReport(runDir: string, runId: string): string {
  const status = safeRead(join(runDir, "status")).trim() || "(unknown)"
  const intent = safeParse<IntentSpec>(join(runDir, "intent.json"), IntentSpec)
  const plan = safeParse<Plan>(join(runDir, "plan.json"), Plan)
  const evalResult = safeParse<EvaluationResult>(
    join(runDir, "evaluation.json"),
    EvaluationResult,
  )

  const lines: string[] = []
  lines.push(`# Run ${runId}`, "")
  lines.push(`**Status**: \`${status}\``, "")

  if (intent) {
    lines.push("## Intent", "")
    lines.push(`> ${intent.rawText}`, "")
    lines.push(`- goal: ${intent.goal}`)
    lines.push(`- riskLevel: ${intent.riskLevel}`)
    lines.push(`- scope.tables: ${intent.scope.tables.join(", ")}`)
    if (intent.assumptions.length > 0) {
      lines.push("- assumptions:")
      for (const a of intent.assumptions) lines.push(`  - ${a}`)
    }
    lines.push("")
  }

  if (plan) {
    lines.push("## Plan", "")
    lines.push(`Rationale: ${plan.rationale}`, "")
    plan.steps.forEach((step, i) => {
      if (step.kind !== "sql") return
      lines.push(`### Step ${i + 1} (${step.mode})`, "")
      lines.push("```sql")
      lines.push(step.sql)
      lines.push("```", "")
    })
  }

  if (evalResult) {
    lines.push("## Evaluation", "")
    lines.push(`- schema: ${tag(evalResult.schemaCheck.passed)}`)
    lines.push(`- policy: ${tag(evalResult.policyCheck.passed)}`)
    lines.push(`- scenario: ${tag(evalResult.scenarioCheck.passed)}`)
    const allFindings = [
      ...evalResult.schemaCheck.findings,
      ...evalResult.policyCheck.findings,
      ...evalResult.scenarioCheck.findings,
    ]
    if (allFindings.length > 0) {
      lines.push("", "### Findings", "")
      for (const f of allFindings) {
        lines.push(
          `- [${f.level}] **${f.ruleId}** — ${f.message}` +
            (f.suggestion !== undefined ? ` (建议: ${f.suggestion})` : ""),
        )
      }
    }
    lines.push("")
  }

  lines.push("## Decision", "", `当前状态：\`${status}\``)
  if (status === "pending-approval") {
    lines.push("")
    lines.push("等待人工动作：")
    lines.push(`  harness approve ${runId}`)
    lines.push(`  harness reject ${runId} --reason "..."`)
  }
  lines.push("")
  return lines.join("\n")
}

function tag(ok: boolean): string {
  return ok ? "PASS" : "FAIL"
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

function safeParse<T>(
  path: string,
  schema: { parse: (x: unknown) => T },
): T | null {
  try {
    if (!existsSync(path)) return null
    return schema.parse(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return null
  }
}
