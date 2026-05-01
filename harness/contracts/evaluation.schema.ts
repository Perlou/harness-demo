/**
 * EvaluationResult / TraceEvent / RunStatus —— Check / Trace 两个阶段的
 * 数据契约，外加贯穿整个 run 的状态机定义。
 *
 * 设计原则：
 *   - 三道检查（Schema / Policy / Scenario）独立运行、不短路，结果合并到
 *     一个 EvaluationResult，让 trace 一次性看到全部问题。
 *   - TraceEvent 是结构化的，不是日志字符串。所有阶段切换、所有检查
 *     结果、所有审批动作都对应一条 TraceEvent。
 *   - RunStatus 是终态明确的状态机，所有 finalize 动作必须落到某个
 *     具体终态。
 */

import { z } from "zod"

// ---------------------------------------------------------------------------
// Check 阶段：单条发现 + 单道检查的结果
// ---------------------------------------------------------------------------

/**
 * 单条检查发现。"为什么被拦下"或"哪里需要注意"都写到这里。
 * suggestion 字段对反馈回路（agent 看着它修复并重试）至关重要。
 */
export const CheckFinding = z.object({
  /** 规则或 matcher 的稳定 id，例如 "pii-fields"、"row-budget"。 */
  ruleId: z.string().min(1),

  /** error → 拦下；warning → 留痕但放行。 */
  level: z.enum(["error", "warning"]),

  /** 给人看的简短描述。 */
  message: z.string().min(1),

  /** 给 agent 看的、可被消费的修复建议。 */
  suggestion: z.string().optional(),

  /** 出问题的位置（例如 "steps[0].sql 第 3 列"），尽量精确。 */
  location: z.string().optional(),
})
export type CheckFinding = z.infer<typeof CheckFinding>

/** 单道检查（Schema / Policy / Scenario）的合并结果。 */
export const CheckOutcome = z.object({
  passed: z.boolean(),
  findings: z.array(CheckFinding).default([]),
})
export type CheckOutcome = z.infer<typeof CheckOutcome>

/**
 * EvaluationResult：三道检查的合并结果。
 * passed 的语义：三道全过且没有 error 级别 finding。
 */
export const EvaluationResult = z.object({
  schemaCheck: CheckOutcome,
  policyCheck: CheckOutcome,
  scenarioCheck: CheckOutcome,
  passed: z.boolean(),
})
export type EvaluationResult = z.infer<typeof EvaluationResult>

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

/** 五阶段的标识；finalize 是收尾事件的特殊 stage。 */
export const TraceStage = z.enum([
  "intent",
  "plan",
  "check",
  "approve",
  "execute",
  "finalize",
])
export type TraceStage = z.infer<typeof TraceStage>

/**
 * TraceEvent：写入 runs/<id>/trace.jsonl 的单条记录。
 *
 * payload 是开放的 record，但同一个 (stage, kind) 组合在系统里应当
 * 始终携带同样的字段集合（约定大于强制）。事件 kind 清单见
 * docs/architecture.md §8.3。
 */
export const TraceEvent = z.object({
  ts: z.string().min(1).describe("ISO 8601 时间戳"),
  runId: z.string().min(1),
  stage: TraceStage,
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
})
export type TraceEvent = z.infer<typeof TraceEvent>

// ---------------------------------------------------------------------------
// Run 状态机
// ---------------------------------------------------------------------------

/**
 * 整个 run 的状态机。
 *
 *   created
 *      │
 *      ▼
 *   checked ──┬──→ rejected_by_schema      (终态)
 *             ├──→ rejected_by_policy      (终态)
 *             ├──→ rejected_by_scenario    (终态)
 *             ├──→ pending-approval ──→ approved ──→ committed         (终态)
 *             │                       └→ rejected                       (终态)
 *             └──→ auto-approved ──→ committed                          (终态)
 *                                  └→ committed_failed                  (终态)
 *
 * failed 是一个兜底终态：在以上任何阶段抛出未预期异常时使用。
 */
export const RunStatus = z.enum([
  "created",
  "checked",
  "pending-approval",
  "auto-approved",
  "approved",
  "rejected",
  "rejected_by_schema",
  "rejected_by_policy",
  "rejected_by_scenario",
  "committed",
  "committed_failed",
  "failed",
])
export type RunStatus = z.infer<typeof RunStatus>

/** 判断一个 status 是否是终态（不再变化）。 */
export const TERMINAL_STATUSES = new Set<RunStatus>([
  "rejected",
  "rejected_by_schema",
  "rejected_by_policy",
  "rejected_by_scenario",
  "committed",
  "committed_failed",
  "failed",
])

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}
