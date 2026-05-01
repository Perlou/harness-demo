/**
 * Pipeline 引擎 —— 把 5 个 stage 按线性顺序串起来。
 *
 * 引擎本身是一个**纯组合函数**，不持有任何业务规则。所有规则都来自：
 *   - harness/contracts/   契约
 *   - harness/policies/    规则
 *   - harness/scenarios/   场景
 *   - src/planners/        Planner 实现
 *
 * M3-M5 的占位检查已被 M4 替换为真实实现；M6 把 pending-approval 接到
 * 独立的 approve/reject 命令；M7 在每个 finalize 路径都把 report.md 落盘。
 */

import {
  EvaluationResult,
  type IntentSpec,
  type Plan,
  type RunStatus,
} from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { TraceEmitter, generateRunId } from "../trace/events.js"
import { renderReport } from "../trace/report.js"
import { RunArtifacts } from "../trace/writer.js"
import type { RunContext } from "./context.js"
import { decideApproval } from "./approval.js"
import { checkPolicy } from "./policyCheck.js"
import { checkSchema } from "./schemaCheck.js"
import { evaluateScenario } from "./scenarioEval.js"
import { execute, type ExecuteResult } from "./executor.js"
import { normalizeIntent } from "./intent.js"
import { generatePlan } from "./planner.js"
import { detectCase } from "../planners/cases.js"

export interface RunResult {
  runId: string
  runDir: string
  status: RunStatus
  intent?: IntentSpec
  plan?: Plan
  evaluation?: EvaluationResult
  result?: ExecuteResult
  reportPath: string
}

/**
 * 跑一次完整 pipeline。无论成败都会落盘 runs/<id>/ 工件 + report.md。
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
    if (!schema.passed) return finalize(ctx, "rejected_by_schema", startedAt,
      { intent, plan, evaluation: evalResult }, rawText)
    if (!policy.passed) return finalize(ctx, "rejected_by_policy", startedAt,
      { intent, plan, evaluation: evalResult }, rawText)
    if (!scenario.passed) return finalize(ctx, "rejected_by_scenario", startedAt,
      { intent, plan, evaluation: evalResult }, rawText)

    // ---------- Approve ----------
    const decision = decideApproval(plan, intent, evalResult, ctx)
    if (decision === "rejected") {
      return finalize(ctx, "rejected", startedAt,
        { intent, plan, evaluation: evalResult }, rawText)
    }
    if (decision === "pending") {
      artifacts.setStatus("pending-approval")
      ctx.trace.emit({
        stage: "finalize",
        kind: "finalize.pending-approval",
        payload: {},
      })
      const finishedAt = new Date().toISOString()
      writeReportFor(ctx, "pending-approval", startedAt, finishedAt, {
        intent, plan, evaluation: evalResult,
      }, rawText)
      return {
        runId,
        runDir: artifacts.runDir,
        status: "pending-approval",
        intent,
        plan,
        evaluation: evalResult,
        reportPath: reportPathFor(artifacts.runDir),
      }
    }

    // decision === "auto"
    artifacts.setStatus("auto-approved")

    // ---------- Execute ----------
    const result = execute(plan, ctx)
    artifacts.writeResult(result)
    if (!result.committed) {
      return finalize(ctx, "committed_failed", startedAt,
        { intent, plan, evaluation: evalResult, result }, rawText)
    }

    return finalize(ctx, "committed", startedAt,
      { intent, plan, evaluation: evalResult, result }, rawText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.trace.emit({
      stage: "finalize",
      kind: "finalize.failed",
      payload: { error: message },
    })
    artifacts.setStatus("failed")
    const finishedAt = new Date().toISOString()
    writeReportFor(ctx, "failed", startedAt, finishedAt,
      { intent, plan, evaluation: evalResult }, rawText)
    return {
      runId,
      runDir: artifacts.runDir,
      status: "failed",
      ...(intent !== undefined ? { intent } : {}),
      ...(plan !== undefined ? { plan } : {}),
      ...(evalResult !== undefined ? { evaluation: evalResult } : {}),
      reportPath: reportPathFor(artifacts.runDir),
    }
  }
}

interface FinalizePartial {
  intent?: IntentSpec
  plan?: Plan
  evaluation?: EvaluationResult
  result?: ExecuteResult
}

function finalize(
  ctx: RunContext,
  status: RunStatus,
  startedAt: string,
  partial: FinalizePartial,
  rawText: string,
): RunResult {
  ctx.artifacts.setStatus(status)
  ctx.trace.emit({
    stage: "finalize",
    kind: `finalize.${status}`,
    payload: {},
  })
  const finishedAt = new Date().toISOString()
  writeReportFor(ctx, status, startedAt, finishedAt, partial, rawText)
  return {
    runId: ctx.runId,
    runDir: ctx.artifacts.runDir,
    status,
    ...partial,
    reportPath: reportPathFor(ctx.artifacts.runDir),
  }
}

function writeReportFor(
  ctx: RunContext,
  status: RunStatus,
  startedAt: string,
  finishedAt: string,
  partial: FinalizePartial,
  rawText: string,
): void {
  const cfg = getConfig()
  const md = renderReport(
    {
      runId: ctx.runId,
      status,
      mode: cfg.mode,
      startedAt,
      finishedAt,
      ...partial,
      detectedCase: detectCase(rawText) ?? undefined,
    },
    ctx.artifacts.runDir,
  )
  ctx.artifacts.writeReport(md)
}

function reportPathFor(runDir: string): string {
  return `${runDir}/report.md`
}
