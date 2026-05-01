/**
 * `harness ask "<question>"` —— 提交意图，跑完整 pipeline，打印摘要。
 *
 * M3 阶段输出极简：runId、状态、工件目录路径、读结果预览。
 * M7 会让 report.md 成为更主要的"用户产物"，CLI 输出只当摘要。
 */

import { closeDb } from "../db/client.js"
import { runPipeline } from "../pipeline/engine.js"

export async function runAsk(question: string): Promise<number> {
  const result = await runPipeline(question)

  const lines: string[] = []
  lines.push(`run id     : ${result.runId}`)
  lines.push(`status     : ${result.status}`)
  lines.push(`artifacts  : ${result.runDir}`)
  lines.push(`report     : ${result.reportPath}`)
  if (result.intent) {
    lines.push(`intent     : ${JSON.stringify({
      goal: result.intent.goal,
      riskLevel: result.intent.riskLevel,
      tables: result.intent.scope.tables,
    })}`)
  }
  if (result.plan) {
    lines.push(`plan       : ${result.plan.steps.length} step(s)`)
  }

  // 读结果预览
  const firstRead = result.result?.steps.find((s) => s.mode === "read")
  if (firstRead?.rows && firstRead.rows.length > 0) {
    lines.push("")
    lines.push("result preview:")
    const preview = firstRead.rows.slice(0, 5)
    for (const row of preview) lines.push(`  ${JSON.stringify(row)}`)
    if ((firstRead.rowCount ?? 0) > preview.length) {
      lines.push(`  ... (共 ${firstRead.rowCount} 行，仅展示前 ${preview.length} 行)`)
    }
  }

  process.stdout.write(lines.join("\n") + "\n")
  closeDb()

  // 退出码：committed / pending-approval = 0，其他 = 1
  return result.status === "committed" || result.status === "pending-approval"
    ? 0
    : 1
}
