/**
 * Schema 检查 —— 把 Plan 里 SQL 引用到的表 / 限定列与真实 SQLite schema 比对。
 *
 * 这是第一道防线：结构都不对的话，下游 policy / scenario 没必要再跑。
 * （但我们仍然把三道检查当并联，最终 trace 一次性看到所有问题。）
 */

import {
  type CheckFinding,
  type CheckOutcome,
  type Plan,
} from "../../harness/contracts/index.js"
import { getDb } from "../db/client.js"
import type { RunContext } from "./context.js"
import { inspectSql } from "./sqlInspect.js"

interface SchemaSnapshot {
  /** 表名（小写）→ 列名集合（小写）。 */
  readonly tables: ReadonlyMap<string, ReadonlySet<string>>
}

export function checkSchema(plan: Plan, ctx: RunContext): CheckOutcome {
  ctx.trace.emit({
    stage: "check",
    kind: "check.schema.started",
    payload: { stepCount: plan.steps.length },
  })

  const findings: CheckFinding[] = []
  const snapshot = introspect()

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!
    if (step.kind !== "sql") continue
    const inspect = inspectSql(step.sql)

    // 检查 1：所有引用到的表都必须存在。
    for (const table of inspect.tables) {
      if (!snapshot.tables.has(table)) {
        findings.push({
          ruleId: "unknown-table",
          level: "error",
          message: `表 \`${table}\` 不存在于真实 schema 中`,
          suggestion: `检查表名拼写，或先用 \`harness seed\` 初始化数据库`,
          location: `steps[${i}].sql`,
        })
      }
    }

    // 检查 2：所有限定列引用必须真实存在。
    for (const ref of inspect.qualifiedColumns) {
      const cols = snapshot.tables.get(ref.table)
      if (!cols) continue // 表不存在的错误已经在上面报了
      if (!cols.has(ref.column)) {
        findings.push({
          ruleId: "unknown-column",
          level: "error",
          message: `列 \`${ref.table}.${ref.column}\` 不存在`,
          suggestion: `查 \`PRAGMA table_info(${ref.table})\` 确认列名`,
          location: `steps[${i}].sql`,
        })
      }
    }
  }

  const passed = !findings.some((f) => f.level === "error")
  ctx.trace.emit({
    stage: "check",
    kind: passed ? "check.schema.passed" : "check.schema.failed",
    payload: { findings },
  })
  return { passed, findings }
}

/** 通过 sqlite_master + pragma_table_info 拿到真实 schema 快照。 */
function introspect(): SchemaSnapshot {
  const db = getDb()
  const tableRows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as Array<{ name: string }>

  const tables = new Map<string, Set<string>>()
  for (const row of tableRows) {
    const colRows = db
      .prepare(`PRAGMA table_info(${row.name})`)
      .all() as Array<{ name: string }>
    const cols = new Set(colRows.map((c) => c.name.toLowerCase()))
    tables.set(row.name.toLowerCase(), cols)
  }
  return { tables }
}
