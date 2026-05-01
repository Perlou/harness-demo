/**
 * IntentSpec —— 用户自然语言请求被规范化后的结构化意图。
 *
 * 这个 schema 是 harness 五阶段中第一阶段（Intent）的输出，也是 Plan 阶段
 * 的唯一输入。它强制把"用户说了什么"转写成"系统理解成什么"，让所有隐式
 * 假设变成可被 review 的字段。
 *
 * 红线：任何 stage 都不允许直接读 IntentSpec.rawText 之外的"原始文本"
 * 来做决策。下游所有判断必须基于这里列出的结构化字段。
 */

import { z } from "zod"

/** 业务目标的类型。新值必须先在这里注册才能被 Plan 阶段消费。 */
export const Goal = z.enum(["query", "aggregate", "mutate", "export"])
export type Goal = z.infer<typeof Goal>

/** 风险等级。决定 Approval 阶段是自动放行还是要求人工审批。 */
export const RiskLevel = z.enum(["read", "write-low", "write-high"])
export type RiskLevel = z.infer<typeof RiskLevel>

/**
 * 时间窗口。orders 之类的表查询必须带这个字段，由
 * harness/policies/require-time-bounds.yaml 强制。
 */
export const TimeWindow = z.object({
  from: z.string().describe("ISO 8601 起点"),
  to: z.string().describe("ISO 8601 终点"),
})
export type TimeWindow = z.infer<typeof TimeWindow>

/** 意图涉及的资源范围。 */
export const Scope = z.object({
  tables: z
    .array(z.string().min(1))
    .min(1, "至少要有一张表"),
  timeWindow: TimeWindow.optional(),
})
export type Scope = z.infer<typeof Scope>

/**
 * IntentSpec：第一阶段的最终产物。所有字段都是必填（除 timeWindow），
 * 让"系统怎么理解了我"完全可见。
 */
export const IntentSpec = z.object({
  /** 用户原文，仅用于展示和 trace，不参与决策。 */
  rawText: z.string().min(1),

  /** 业务目标类别。 */
  goal: Goal,

  /** 涉及的资源范围。 */
  scope: Scope,

  /** 系统在规范化过程中做出的隐式假设；每条都应当人类可读。 */
  assumptions: z.array(z.string()).default([]),

  /** 风险等级。 */
  riskLevel: RiskLevel,

  /** 成功的判断标准。 */
  successCriteria: z.array(z.string()).default([]),
})
export type IntentSpec = z.infer<typeof IntentSpec>
