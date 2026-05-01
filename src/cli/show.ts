/**
 * `harness show <run-id>` —— 打印某个运行的 report.md。
 *
 * M7 之后所有 finalize 路径都会写 report.md，所以本命令几乎总是直接读盘。
 * 万一在罕见情况下文件缺失（人手删了 / 跨版本切换），现场用 renderReport
 * 合成一份。
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  EvaluationResult,
  IntentSpec,
  Plan,
  RunStatus,
} from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { detectCase } from "../planners/cases.js"
import { renderReport } from "../trace/report.js"

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

  // fallback：现场合成
  const status = parseStatus(readFileSync(join(runDir, "status"), "utf8").trim())
  const intent = safeRead<IntentSpec>(join(runDir, "intent.json"), IntentSpec)
  const plan = safeRead<Plan>(join(runDir, "plan.json"), Plan)
  const evaluation = safeRead<EvaluationResult>(
    join(runDir, "evaluation.json"),
    EvaluationResult,
  )
  const md = renderReport(
    {
      runId,
      status,
      mode: cfg.mode,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date().toISOString(),
      ...(intent !== null ? { intent } : {}),
      ...(plan !== null ? { plan } : {}),
      ...(evaluation !== null ? { evaluation } : {}),
      ...(intent !== null
        ? { detectedCase: detectCase(intent.rawText) ?? undefined }
        : {}),
    },
    runDir,
  )
  process.stdout.write(md)
  return 0
}

function parseStatus(raw: string): import("../../harness/contracts/index.js").RunStatus {
  return RunStatus.parse(raw)
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
