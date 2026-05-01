/**
 * Pipeline 引擎 —— 把 5 个 stage 按线性顺序串起来。
 *
 * 引擎本身是一个**纯组合函数**，不持有任何业务规则。所有规则都来自：
 *   - harness/contracts/   契约
 *   - harness/policies/    规则
 *   - harness/scenarios/   场景
 *   - src/planners/        Planner 实现
 *
 * M3 阶段：Schema/Policy/Scenario 都是返回 passed=true 的占位实现，
 * 让骨架贯通；M4 会替换为真实检查。
 */

import {
  EvaluationResult,
  type IntentSpec,
  type Plan,
  type RunStatus,
} from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { TraceEmitter, generateRunId } from "../trace/events.js"
import { RunArtifacts } from "../trace/writer.js"
import type { RunContext } from "./context.js"
import { decideApproval } from "./approval.js"
import { checkPolicy } from "./policyCheck.js"
import { checkSchema } from "./schemaCheck.js"
import { evaluateScenario } from "./scenarioEval.js"
import { execute, type ExecuteResult } from "./executor.js"
import { normalizeIntent } from "./intent.js"
import { generatePlan } from "./planner.js"

export interface RunResult {
  runId: string
  runDir: string
  status: RunStatus
  intent?: IntentSpec
  plan?: Plan
  evaluation?: EvaluationResult
  result?: ExecuteResult
}

/**
 * 跑一次完整 pipeline。无论成败都会落盘 runs/<id>/ 工件。
 */
export async function runPipeline(rawText: string): Promise<RunResult> {
  const cfg = getConfig()
  const runId = generateRunId()
  const startedAt = new Date().toISOString()
  const trace = new TraceEmitter(runId)
  const artifacts = new RunArtifacts(cfg.runsDir, runId)
  trace.on(artifacts.appendTrace)

  const ctx: RunContext = { runId, startedAt, trace, artifacts }
  artifacts.setStatus("created")

  let intent: IntentSpec | undefined
  let plan: Plan | undefined
  let evalResult: EvaluationResult | undefined

  try {
    // ---------- Intent ----------
    intent = normalizeIntent(rawText, ctx)

    // ---------- Plan ----------
    plan = await generatePlan(intent, ctx)

    // ---------- Check ----------
    const schema = checkSchema(plan, ctx)
    const policy = checkPolicy(plan, ctx)
    const scenario = evaluateScenario(plan, ctx)
    evalResult = EvaluationResult.parse({
      schemaCheck: schema,
      policyCheck: policy,
      scenarioCheck: scenario,
      passed: schema.passed && policy.passed && scenario.passed,
    })
    artifacts.writeEvaluation(evalResult)
    artifacts.setStatus("checked")

    // 三道检查的失败优先级：schema → policy → scenario。
    if (!schema.passed) return finalize(ctx, "rejected_by_schema",
      { intent, plan, evaluation: evalResult })
    if (!policy.passed) return finalize(ctx, "rejected_by_policy",
      { intent, plan, evaluation: evalResult })
    if (!scenario.passed) return finalize(ctx, "rejected_by_scenario",
      { intent, plan, evaluation: evalResult })

    // ---------- Approve ----------
    const decision = decideApproval(plan, intent, evalResult, ctx)
    if (decision === "rejected") {
      return finalize(ctx, "rejected", { intent, plan, evaluation: evalResult })
    }
    if (decision === "pending") {
      artifacts.setStatus("pending-approval")
      ctx.trace.emit({
        stage: "finalize",
        kind: "finalize.pending-approval",
        payload: {},
      })
      return { runId, runDir: artifacts.runDir, status: "pending-approval",
               intent, plan, evaluation: evalResult }
    }

    // decision === "auto"
    artifacts.setStatus("auto-approved")

    // ---------- Execute ----------
    const result = execute(plan, ctx)
    artifacts.writeResult(result)
    if (!result.committed) {
      return finalize(ctx, "committed_failed",
        { intent, plan, evaluation: evalResult, result })
    }

    return finalize(ctx, "committed",
      { intent, plan, evaluation: evalResult, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.trace.emit({
      stage: "finalize",
      kind: "finalize.failed",
      payload: { error: message },
    })
    artifacts.setStatus("failed")
    return {
      runId,
      runDir: artifacts.runDir,
      status: "failed",
      ...(intent !== undefined ? { intent } : {}),
      ...(plan !== undefined ? { plan } : {}),
      ...(evalResult !== undefined ? { evaluation: evalResult } : {}),
    }
  }
}

function finalize(
  ctx: RunContext,
  status: RunStatus,
  partial: Pick<RunResult, "intent" | "plan" | "evaluation" | "result">,
): RunResult {
  ctx.artifacts.setStatus(status)
  ctx.trace.emit({
    stage: "finalize",
    kind: `finalize.${status}`,
    payload: {},
  })
  return {
    runId: ctx.runId,
    runDir: ctx.artifacts.runDir,
    status,
    ...partial,
  }
}
