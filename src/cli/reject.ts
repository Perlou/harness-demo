/**
 * `harness reject <run-id> --reason "..."` —— 拒绝一个 pending-approval 的运行。
 *
 * 设计要求（见 docs/architecture.md §4.5）：
 *   - 拒绝必须强制要求理由（commander 层 requiredOption 已强制）
 *   - 把"谁拒绝、什么时候、什么理由"写进 trace
 *   - 设置 status=rejected（终态），不再可重放
 *   - 业务 DB 不被触碰（执行从未发生）
 *   - 拒绝后**重写 report.md**，把理由写进 Decision 章节
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  EvaluationResult,
  IntentSpec,
  Plan,
} from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { detectCase } from "../planners/cases.js"
import { TraceEmitter } from "../trace/events.js"
import { renderReport } from "../trace/report.js"
import { RunArtifacts } from "../trace/writer.js"

export async function runReject(
  runId: string,
  reason: string,
): Promise<number> {
  const cfg = getConfig()
  const runDir = join(cfg.runsDir, runId)
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
    process.stderr.write(`[harness] 运行 ${runId} 不存在\n`)
    return 2
  }

  const status = readFileSync(join(runDir, "status"), "utf8").trim()
  if (status !== "pending-approval") {
    process.stderr.write(
      `[harness] 运行 ${runId} 当前状态是 \`${status}\`，` +
        `只有 pending-approval 才能 reject。\n`,
    )
    return 3
  }

  const trimmedReason = reason.trim()
  if (trimmedReason.length === 0) {
    process.stderr.write(`[harness] --reason 不能为空\n`)
    return 4
  }

  const startedAt = new Date().toISOString()
  const artifacts = new RunArtifacts(cfg.runsDir, runId)
  const trace = new TraceEmitter(runId)
  trace.on(artifacts.appendTrace)

  trace.emit({
    stage: "approve",
    kind: "approval.user_rejected",
    payload: {
      rejectedAt: new Date().toISOString(),
      reason: trimmedReason,
    },
  })
  artifacts.setStatus("rejected")
  trace.emit({
    stage: "finalize",
    kind: "finalize.rejected",
    payload: { reason: trimmedReason },
  })

  // 重新落盘 report.md（Decision 章节会把 reason 渲染进去）。
  const intent = safeRead<IntentSpec>(join(runDir, "intent.json"), IntentSpec)
  const plan = safeRead<Plan>(join(runDir, "plan.json"), Plan)
  const evaluation = safeRead<EvaluationResult>(
    join(runDir, "evaluation.json"),
    EvaluationResult,
  )
  const finishedAt = new Date().toISOString()
  artifacts.writeReport(
    renderReport(
      {
        runId,
        status: "rejected",
        mode: cfg.mode,
        startedAt,
        finishedAt,
        ...(intent !== null ? { intent } : {}),
        ...(plan !== null ? { plan } : {}),
        ...(evaluation !== null ? { evaluation } : {}),
        rejectReason: trimmedReason,
        ...(intent !== null ? { detectedCase: detectCase(intent.rawText) ?? undefined } : {}),
      },
      runDir,
    ),
  )

  process.stdout.write(
    [
      `run id     : ${runId}`,
      `status     : rejected`,
      `reason     : ${trimmedReason}`,
      `artifacts  : ${runDir}`,
      `report     : ${runDir}/report.md`,
      "",
    ].join("\n"),
  )
  return 0
}

function safeRead<T>(
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
