/**
 * `harness approve <run-id>` —— 批准一个 pending-approval 的运行，
 * 重新加载 staged plan，跑 executor 真正提交业务变更。
 *
 * 两阶段审批的关键设计：
 *   - approve 是一个**独立的命令边界**，不在原 ask 进程里阻塞等待
 *   - 一旦 run 离开 pending-approval（committed / rejected / failed），
 *     再次 approve 必须报错 —— 防止重放
 *   - 所有审批动作（包括人的批准本身）都写进既存的 trace.jsonl
 *   - approve 完成后 **重写 report.md**，让最新状态覆盖前一版 pending
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  EvaluationResult,
  IntentSpec,
  Plan,
  type RunStatus,
} from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { closeDb } from "../db/client.js"
import type { RunContext } from "../pipeline/context.js"
import { execute } from "../pipeline/executor.js"
import { detectCase } from "../planners/cases.js"
import { TraceEmitter } from "../trace/events.js"
import { renderReport } from "../trace/report.js"
import { RunArtifacts } from "../trace/writer.js"

export async function runApprove(runId: string): Promise<number> {
  const cfg = getConfig()
  const runDir = join(cfg.runsDir, runId)
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
    process.stderr.write(`[harness] 运行 ${runId} 不存在\n`)
    return 2
  }

  const status = readStatus(runDir)
  if (status !== "pending-approval") {
    process.stderr.write(
      `[harness] 运行 ${runId} 当前状态是 \`${status}\`，` +
        `只有 pending-approval 才能 approve。\n`,
    )
    return 3
  }

  const intent = IntentSpec.parse(
    JSON.parse(readFileSync(join(runDir, "intent.json"), "utf8")),
  )
  const plan = Plan.parse(
    JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")),
  )
  const evaluation = safeReadEvaluation(runDir)

  const startedAt = new Date().toISOString()
  const artifacts = new RunArtifacts(cfg.runsDir, runId)
  const trace = new TraceEmitter(runId)
  trace.on(artifacts.appendTrace)
  const ctx: RunContext = { runId, startedAt, trace, artifacts }

  trace.emit({
    stage: "approve",
    kind: "approval.user_approved",
    payload: {
      approvedAt: new Date().toISOString(),
      intentRawText: intent.rawText,
    },
  })
  artifacts.setStatus("approved")

  // 真正提交。executor 自身会写 audit_log + 触发 trace 事件。
  const result = execute(plan, ctx)
  artifacts.writeResult(result)

  let finalStatus: RunStatus
  if (result.committed) {
    finalStatus = "committed"
  } else {
    finalStatus = "committed_failed"
  }
  artifacts.setStatus(finalStatus)
  trace.emit({
    stage: "finalize",
    kind: `finalize.${finalStatus}`,
    payload: {},
  })

  // 重新落盘 report.md，把 status / result 更新进去。
  const finishedAt = new Date().toISOString()
  artifacts.writeReport(
    renderReport(
      {
        runId,
        status: finalStatus,
        mode: cfg.mode,
        startedAt,
        finishedAt,
        intent,
        plan,
        evaluation,
        result,
        detectedCase: detectCase(intent.rawText) ?? undefined,
      },
      runDir,
    ),
  )

  process.stdout.write(printSummary(runId, runDir, finalStatus, result.error))
  closeDb()
  return finalStatus === "committed" ? 0 : 1
}

function readStatus(runDir: string): string {
  return readFileSync(join(runDir, "status"), "utf8").trim()
}

function safeReadEvaluation(runDir: string): EvaluationResult | undefined {
  const path = join(runDir, "evaluation.json")
  if (!existsSync(path)) return undefined
  try {
    return EvaluationResult.parse(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return undefined
  }
}

function printSummary(
  runId: string,
  runDir: string,
  status: RunStatus,
  error: string | undefined,
): string {
  const lines = [
    `run id     : ${runId}`,
    `status     : ${status}`,
    `artifacts  : ${runDir}`,
    `report     : ${runDir}/report.md`,
  ]
  if (error !== undefined) lines.push(`error      : ${error}`)
  return lines.join("\n") + "\n"
}
