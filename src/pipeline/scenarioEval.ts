/**
 * Scenario 评估 —— 加载 harness/scenarios/*.yaml，对 step 做状态相关检查。
 *
 * 与 policy 的差异：scenario 需要看真实数据库状态（行数估算、explain
 * 计划等），不能仅凭 SQL 文本判断。
 *
 * 当前注册的 scenario type（封闭）：
 *   - explain-row-estimate  把 SELECT 包成 COUNT(*) 子查询，与阈值比较
 */

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import yaml from "js-yaml"
import { z } from "zod"

import {
  type CheckFinding,
  type CheckOutcome,
  type Plan,
} from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { getDb } from "../db/client.js"
import type { RunContext } from "./context.js"

// ---------------------------------------------------------------------------
// yaml schema
// ---------------------------------------------------------------------------

const StepKind = z.enum(["read", "write"])

const ThresholdEnv = z.object({ source: z.literal("env") })
const ThresholdInline = z.object({
  source: z.literal("inline"),
  read: z.number().int().nonnegative().optional(),
  write: z.number().int().nonnegative().optional(),
})
const Threshold = z.discriminatedUnion("source", [ThresholdEnv, ThresholdInline])

const ScenarioDoc = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  type: z.literal("explain-row-estimate"),
  applies_to: z.object({
    steps: z.array(StepKind).min(1),
  }),
  threshold: Threshold,
  on_exceed: z.object({
    decision: z.literal("reject"),
    message: z.string().min(1),
    suggestion: z.string().optional(),
  }),
})
type ScenarioDoc = z.infer<typeof ScenarioDoc>

// ---------------------------------------------------------------------------
// 加载
// ---------------------------------------------------------------------------

const SCENARIOS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../harness/scenarios",
)

let _cached: ScenarioDoc[] | null = null

export function loadScenarios(): ScenarioDoc[] {
  if (_cached !== null) return _cached
  const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".yaml"))
  const scenarios: ScenarioDoc[] = []
  for (const file of files) {
    const raw = readFileSync(join(SCENARIOS_DIR, file), "utf8")
    const parsed = yaml.load(raw) as unknown
    const result = ScenarioDoc.safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `scenarios/${file} 解析失败：\n` +
          result.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n"),
      )
    }
    scenarios.push(result.data)
  }
  _cached = scenarios
  return scenarios
}

/** 测试用：重置缓存。 */
export function resetScenarioCache(): void {
  _cached = null
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function evaluateScenario(plan: Plan, ctx: RunContext): CheckOutcome {
  ctx.trace.emit({
    stage: "check",
    kind: "check.scenario.started",
    payload: { stepCount: plan.steps.length },
  })

  const scenarios = loadScenarios()
  const findings: CheckFinding[] = []

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!
    if (step.kind !== "sql") continue
    for (const scenario of scenarios) {
      if (!scenario.applies_to.steps.includes(step.mode)) continue
      const localFindings = applyScenario(scenario, step.sql, step.mode, i)
      findings.push(...localFindings)
    }
  }

  const passed = !findings.some((f) => f.level === "error")
  ctx.trace.emit({
    stage: "check",
    kind: passed ? "check.scenario.passed" : "check.scenario.failed",
    payload: { findings },
  })
  return { passed, findings }
}

// ---------------------------------------------------------------------------
// scenario 注册表（封闭）
// ---------------------------------------------------------------------------

function applyScenario(
  scenario: ScenarioDoc,
  sql: string,
  mode: "read" | "write",
  stepIndex: number,
): CheckFinding[] {
  switch (scenario.type) {
    case "explain-row-estimate":
      return runRowEstimate(scenario, sql, mode, stepIndex)
    default: {
      const _exhaustive: never = scenario.type
      throw new Error(`未知 scenario type: ${String(_exhaustive)}`)
    }
  }
}

function runRowEstimate(
  scenario: ScenarioDoc,
  sql: string,
  mode: "read" | "write",
  stepIndex: number,
): CheckFinding[] {
  const threshold = resolveThreshold(scenario, mode)
  if (threshold === null) return []

  let estimated: number
  try {
    estimated = probeRowCount(sql, mode)
  } catch (err) {
    // 探查失败本身不应该导致 scenario 失败（schema check 已经在前面拦了）。
    // 这里只留 warning 给 trace。
    return [
      {
        ruleId: scenario.id,
        level: "warning",
        message: `行数探查失败：${err instanceof Error ? err.message : String(err)}`,
        location: `steps[${stepIndex}].sql`,
      },
    ]
  }

  if (estimated <= threshold) return []
  const message = renderTemplate(scenario.on_exceed.message, {
    rows: estimated.toString(),
    threshold: threshold.toString(),
  })
  const finding: CheckFinding = {
    ruleId: scenario.id,
    level: "error",
    message,
    location: `steps[${stepIndex}].sql`,
    ...(scenario.on_exceed.suggestion !== undefined
      ? {
          suggestion: renderTemplate(scenario.on_exceed.suggestion, {
            rows: estimated.toString(),
            threshold: threshold.toString(),
          }),
        }
      : {}),
  }
  return [finding]
}

function resolveThreshold(
  scenario: ScenarioDoc,
  mode: "read" | "write",
): number | null {
  if (scenario.threshold.source === "env") {
    const cfg = getConfig()
    return mode === "read" ? cfg.rowBudgetRead : cfg.rowBudgetWrite
  }
  // inline
  const v = mode === "read" ? scenario.threshold.read : scenario.threshold.write
  return v ?? null
}

/**
 * 把 SELECT 包成 `SELECT COUNT(*) FROM (...)` 跑一次，得到该 SQL 在
 * 当前 DB 状态下会返回多少行。仅对 read 模式有意义。
 *
 * 写操作的"会影响多少行"探查更复杂（需要 dry-run 或 BEGIN…ROLLBACK），
 * v1 简化处理：写操作直接走 audit + 审批门，不在这里做 estimate。
 */
function probeRowCount(sql: string, mode: "read" | "write"): number {
  if (mode !== "read") return 0
  const db = getDb()
  const cleaned = sql.replace(/;\s*$/, "")
  const probe = `SELECT COUNT(*) AS n FROM (${cleaned}) AS sub`
  const row = db.prepare(probe).get() as { n: number }
  return row.n
}

function renderTemplate(
  template: string,
  fillers: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => fillers[key] ?? m)
}
