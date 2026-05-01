/**
 * Plan 阶段调度。
 *
 * 根据 HARNESS_MODE 选择具体 Planner 实现。M3 阶段只有 demo 一种；M8
 * 会引入 live。
 *
 * 关键约束：dispatch 之外的下游 pipeline 与 Planner 实现无关——这是
 * harness engineering "同一套环境同时约束规则系统和真实模型" 的核心
 * 表达。
 */

import type { IntentSpec, Plan } from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { demoPlanner } from "../planners/demo.js"
import { createLivePlanner } from "../planners/live.js"
import type { RunContext } from "./context.js"

/** Planner 协议。Demo 与 Live 都实现这个接口。 */
export interface Planner {
  readonly name: "demo" | "live"
  generate(intent: IntentSpec, ctx?: RunContext): Plan | Promise<Plan>
}

function pickPlanner(): Planner {
  const cfg = getConfig()
  switch (cfg.mode) {
    case "demo":
      return demoPlanner
    case "live":
      return createLivePlanner()
    default: {
      const _exhaustive: never = cfg.mode
      throw new Error(`未知模式: ${String(_exhaustive)}`)
    }
  }
}

export async function generatePlan(
  intent: IntentSpec,
  ctx: RunContext,
): Promise<Plan> {
  const planner = pickPlanner()
  ctx.trace.emit({
    stage: "plan",
    kind: "plan.requested",
    payload: { planner: planner.name },
  })

  const plan = await planner.generate(intent, ctx)

  ctx.trace.emit({
    stage: "plan",
    kind: "plan.generated",
    payload: { plan, planner: planner.name },
  })

  ctx.artifacts.writePlan(plan)
  return plan
}
