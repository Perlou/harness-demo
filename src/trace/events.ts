/**
 * Trace 事件总线。
 *
 * 设计要点：
 *   - 每个 pipeline stage 在切换、检查、决策处都通过 emitter 发事件。
 *   - emitter 不关心事件最终去哪——它把事件交给一个监听器函数；
 *     具体落盘到 runs/<id>/trace.jsonl 的工作由 RunArtifacts 接管。
 *   - 这样设计是为了让 stage 单测可以注入一个 in-memory 监听器，
 *     无需触碰文件系统。
 */

import { TraceEvent, type TraceStage } from "../../harness/contracts/index.js"

export type TraceEventInput = {
  stage: TraceStage
  kind: string
  payload?: Record<string, unknown>
}

export type TraceListener = (event: TraceEvent) => void

/**
 * Trace emitter：把 stage 的 emit() 调用转换成合法的 TraceEvent，
 * 然后分发给所有监听器。
 */
export class TraceEmitter {
  private listeners: TraceListener[] = []

  constructor(private readonly runId: string) {}

  /** 添加一个监听器。RunArtifacts 会注入一个文件追加监听器。 */
  on(listener: TraceListener): void {
    this.listeners.push(listener)
  }

  /** 发一条事件。会被 zod 校验，确保与契约一致。 */
  emit(input: TraceEventInput): TraceEvent {
    const event = TraceEvent.parse({
      ts: new Date().toISOString(),
      runId: this.runId,
      stage: input.stage,
      kind: input.kind,
      payload: input.payload ?? {},
    })
    for (const listener of this.listeners) listener(event)
    return event
  }
}

/**
 * 产生一个文件系统友好的 runId：`2026-05-01T11-42-13-r3k9`。
 * - 时间部分使用 ISO，但把 `:` 和 `.` 替换为 `-`，截断到秒。
 * - 后缀 4 位 hex 用于在同一秒内区分多个 run。
 */
export function generateRunId(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0")
  return `${iso}-${suffix}`
}
