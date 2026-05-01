/**
 * Plan —— Planner 阶段产出的结构化执行计划。
 *
 * 关键约束：
 *   1. Plan 是 **建议**，不是 **事实**。这里描述的是"agent 想做什么"，
 *      真正的写入要等到 Execute 阶段。
 *   2. Plan 的所有 step 都必须是结构化对象，不能塞自由文本——下游 Check
 *      阶段需要程序化分析每一步。
 *   3. 这个 schema 同时被 Demo Mode 和 Live Mode 使用：Demo 直接构造合法
 *      Plan，Live 把 LLM 输出 zod-parse 进来。
 */

import { z } from "zod"

/**
 * 单条 SQL 动作。M2 阶段 Plan 只支持 SQL 类型 step；后续若需要扩展
 * （例如发邮件、调外部 API），新增 ActionKind 并把 SqlAction 改为 union。
 */
export const SqlAction = z.object({
  kind: z.literal("sql"),

  /** read = SELECT；write = INSERT/UPDATE/DELETE。决定走哪条审批分支。 */
  mode: z.enum(["read", "write"]),

  /** 要执行的 SQL 文本，必须是合法可被 better-sqlite3 prepare 的语句。 */
  sql: z.string().min(1),

  /** 预期返回的列名（仅 read 模式有意义）。Schema 检查会比对。 */
  expectedColumns: z.array(z.string()).optional(),

  /** Planner 自己估算的影响行数。Scenario 检查会用 EXPLAIN 复核。 */
  estimatedRows: z.number().int().nonnegative().optional(),
})
export type SqlAction = z.infer<typeof SqlAction>

/** Action 的 union。当前只有 SqlAction，留好扩展位。 */
export const Action = z.discriminatedUnion("kind", [SqlAction])
export type Action = z.infer<typeof Action>

/**
 * Plan：第二阶段的最终产物。IntentSpec → Plan 的映射既可以是
 * 确定性规则（Demo Mode），也可以是 LLM 调用（Live Mode）。
 */
export const Plan = z.object({
  /** 关联的 IntentSpec.id 或 RunContext.runId，用来在 trace 里串起来。 */
  intentId: z.string().min(1),

  /** 顺序执行的 step 列表。 */
  steps: z.array(Action).min(1, "Plan 至少要有一个 step"),

  /** 给人看的、说明这一份 Plan 为什么这样设计的简短文字。 */
  rationale: z.string().min(1),
})
export type Plan = z.infer<typeof Plan>
