/**
 * RunArtifacts —— 运行工件的写入门面。
 *
 * 一次 `harness ask` 对应 runs/<id>/ 一个目录，目录里至少包含：
 *   - trace.jsonl       追加写：每条事件一行 JSON
 *   - status            单行文件：当前状态（committed / pending-approval / ...）
 *   - intent.json       Intent 阶段产出
 *   - plan.json         Plan 阶段产出
 *   - evaluation.json   Check 阶段合并产出
 *   - result.json       Execute 阶段执行结果（read 模式才有）
 *   - report.md         人类可读报告（M7 实现，M3 暂时占位）
 *
 * 这些文件就是 harness engineering "运行即工件" 主张的物理形态。
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type {
  EvaluationResult,
  IntentSpec,
  Plan,
  RunStatus,
  TraceEvent,
} from "../../harness/contracts/index.js"

export class RunArtifacts {
  readonly runDir: string
  private readonly tracePath: string

  constructor(runsDir: string, runId: string) {
    this.runDir = join(runsDir, runId)
    mkdirSync(this.runDir, { recursive: true })
    this.tracePath = join(this.runDir, "trace.jsonl")
  }

  /** 把一条 TraceEvent 追加到 trace.jsonl。设计成 listener 形态。 */
  appendTrace = (event: TraceEvent): void => {
    appendFileSync(this.tracePath, JSON.stringify(event) + "\n", "utf8")
  }

  writeIntent(intent: IntentSpec): void {
    this.write("intent.json", intent)
  }

  writePlan(plan: Plan): void {
    this.write("plan.json", plan)
  }

  writeEvaluation(evalResult: EvaluationResult): void {
    this.write("evaluation.json", evalResult)
  }

  writeResult(result: unknown): void {
    this.write("result.json", result)
  }

  setStatus(status: RunStatus): void {
    writeFileSync(join(this.runDir, "status"), `${status}\n`, "utf8")
  }

  /** M7 才会真正合成报告；M3 阶段先放占位。 */
  writeReport(markdown: string): void {
    writeFileSync(join(this.runDir, "report.md"), markdown, "utf8")
  }

  private write(filename: string, content: unknown): void {
    writeFileSync(
      join(this.runDir, filename),
      JSON.stringify(content, null, 2) + "\n",
      "utf8",
    )
  }
}
