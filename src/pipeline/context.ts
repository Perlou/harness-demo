/**
 * RunContext —— 在 pipeline 各阶段之间传递的上下文。
 *
 * 每个 stage 接受 RunContext 作为第二个参数，副作用只允许通过
 * `ctx.trace.emit(...)` 发生（除了 executor）。
 */

import type { TraceEmitter } from "../trace/events.js"
import type { RunArtifacts } from "../trace/writer.js"

export interface RunContext {
  /** 本次运行的稳定 id，对应 runs/<id>/ 目录名。 */
  readonly runId: string

  /** ISO 8601 起始时间戳。 */
  readonly startedAt: string

  /** 事件总线。所有 stage 通过它写 trace。 */
  readonly trace: TraceEmitter

  /** 工件写入门面。executor 之外的 stage 不直接写文件。 */
  readonly artifacts: RunArtifacts
}
