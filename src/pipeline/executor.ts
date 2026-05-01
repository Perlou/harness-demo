/**
 * Executor —— 唯一被允许写业务 DB 的模块。
 *
 * 调用者必须保证：
 *   - Plan 已通过三道检查
 *   - Approval 已 granted（auto 或 user）
 *
 * 行为：
 *   - 单个事务内顺序执行所有 step
 *   - 任意一步抛错 → 整体回滚 → 写 trace 失败事件
 *   - 写动作（mode=write）会追加一条 audit_log 记录
 *   - 读动作返回 rows，最终汇总到 result.json
 */

import { getDb } from "../db/client.js"
import type { Plan, SqlAction } from "../../harness/contracts/index.js"
import type { RunContext } from "./context.js"

export interface ExecuteResult {
  steps: StepResult[]
  committed: boolean
  /** 当 committed=false 时，保留 rollback 原因。 */
  error?: string
}

export interface StepResult {
  index: number
  mode: "read" | "write"
  /** mode=read 时为查询结果（限制行数防止 result.json 过大）。 */
  rows?: Array<Record<string, unknown>>
  /** mode=read 的总行数。 */
  rowCount?: number
  /** mode=write 时为受影响行数。 */
  changes?: number
}

const READ_PREVIEW_LIMIT = 100

export function execute(plan: Plan, ctx: RunContext): ExecuteResult {
  ctx.trace.emit({
    stage: "execute",
    kind: "execute.started",
    payload: { stepCount: plan.steps.length },
  })

  const db = getDb()
  const stepResults: StepResult[] = []

  try {
    const tx = db.transaction(() => {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i]!
        stepResults.push(runStep(step, i, ctx))
      }
    })
    tx()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.trace.emit({
      stage: "execute",
      kind: "execute.rolled_back",
      payload: { error: message },
    })
    return { steps: stepResults, committed: false, error: message }
  }

  ctx.trace.emit({
    stage: "execute",
    kind: "execute.committed",
    payload: {
      stepCount: plan.steps.length,
      reads: stepResults.filter((s) => s.mode === "read").length,
      writes: stepResults.filter((s) => s.mode === "write").length,
    },
  })
  return { steps: stepResults, committed: true }
}

function runStep(step: SqlAction, index: number, ctx: RunContext): StepResult {
  const db = getDb()
  if (step.mode === "read") {
    const stmt = db.prepare(step.sql)
    const rows = stmt.all() as Array<Record<string, unknown>>
    return {
      index,
      mode: "read",
      rows: rows.slice(0, READ_PREVIEW_LIMIT),
      rowCount: rows.length,
    }
  }

  // mode === "write"
  const stmt = db.prepare(step.sql)
  const info = stmt.run()
  // 同一事务里追加一条 audit_log。
  const audit = db.prepare(
    `INSERT INTO audit_log (run_id, action, target_table, target_id, before_json, after_json, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  audit.run(
    ctx.runId,
    step.sql,
    inferTargetTable(step.sql) ?? "(unknown)",
    null,
    null,
    JSON.stringify({ changes: info.changes }),
    new Date().toISOString(),
  )
  return { index, mode: "write", changes: info.changes }
}

/** 极简的目标表推断；仅用于 audit_log 的 target_table 字段。 */
function inferTargetTable(sql: string): string | null {
  const m = sql.match(/^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-zA-Z_][\w]*)/i)
  return m?.[1] ?? null
}
