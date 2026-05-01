/**
 * Policy 检查 —— 加载 harness/policies/*.yaml，逐条对 Plan 的 step 跑 matcher。
 *
 * matcher 注册表是 **封闭的**。yaml 引用未注册的 type 会被忽略并 emit
 * 一个 trace warning，**不允许悄悄变成代码逻辑**。
 *
 * 当前注册的 matcher：
 *   - column-reference     forbidden 列出现在 SQL 中
 *   - table-without-where  指定表的查询缺 WHERE
 *   - statement-kind       SQL 动词命中（INSERT/UPDATE/DELETE）
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
  type SqlAction,
} from "../../harness/contracts/index.js"
import type { RunContext } from "./context.js"
import { inspectSql, type SqlInspection } from "./sqlInspect.js"

// ---------------------------------------------------------------------------
// yaml schema
// ---------------------------------------------------------------------------

const StepKind = z.enum(["read", "write"])
const Decision = z.enum(["reject", "require_approval"])

const ColumnReferenceMatcher = z.object({
  type: z.literal("column-reference"),
  columns: z.array(z.string().min(1)).min(1),
})

const TableWithoutWhereMatcher = z.object({
  type: z.literal("table-without-where"),
  tables: z.array(z.string().min(1)).min(1),
})

const StatementKindMatcher = z.object({
  type: z.literal("statement-kind"),
  kinds: z.array(z.enum(["select", "insert", "update", "delete"])).min(1),
})

const Matcher = z.discriminatedUnion("type", [
  ColumnReferenceMatcher,
  TableWithoutWhereMatcher,
  StatementKindMatcher,
])
type Matcher = z.infer<typeof Matcher>

const PolicyDoc = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  applies_to: z.object({
    steps: z.array(StepKind).min(1),
  }),
  match: Matcher,
  on_match: z.object({
    decision: Decision,
    message: z.string().min(1),
    suggestion: z.string().optional(),
  }),
})
type PolicyDoc = z.infer<typeof PolicyDoc>

// ---------------------------------------------------------------------------
// 加载
// ---------------------------------------------------------------------------

const POLICIES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../harness/policies",
)

let _cached: PolicyDoc[] | null = null

export function loadPolicies(): PolicyDoc[] {
  if (_cached !== null) return _cached
  const files = readdirSync(POLICIES_DIR).filter((f) => f.endsWith(".yaml"))
  const policies: PolicyDoc[] = []
  for (const file of files) {
    const raw = readFileSync(join(POLICIES_DIR, file), "utf8")
    const parsed = yaml.load(raw) as unknown
    const result = PolicyDoc.safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `policies/${file} 解析失败：\n` +
          result.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n"),
      )
    }
    policies.push(result.data)
  }
  _cached = policies
  return policies
}

/** 仅供测试使用：清掉缓存以便修改 yaml 后重新加载。 */
export function resetPolicyCache(): void {
  _cached = null
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function checkPolicy(plan: Plan, ctx: RunContext): CheckOutcome {
  ctx.trace.emit({
    stage: "check",
    kind: "check.policy.started",
    payload: { stepCount: plan.steps.length },
  })

  const policies = loadPolicies()
  const findings: CheckFinding[] = []

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!
    if (step.kind !== "sql") continue
    const inspection = inspectSql(step.sql)
    const stepKind = step.mode

    for (const policy of policies) {
      if (!policy.applies_to.steps.includes(stepKind)) continue
      const localFindings = applyMatcher(policy, step, inspection, i)
      findings.push(...localFindings)
    }
  }

  const passed = !findings.some((f) => f.level === "error")
  ctx.trace.emit({
    stage: "check",
    kind: passed ? "check.policy.passed" : "check.policy.failed",
    payload: { findings },
  })
  return { passed, findings }
}

// ---------------------------------------------------------------------------
// matcher 注册表（封闭集合）
// ---------------------------------------------------------------------------

function applyMatcher(
  policy: PolicyDoc,
  step: SqlAction,
  inspect: SqlInspection,
  stepIndex: number,
): CheckFinding[] {
  switch (policy.match.type) {
    case "column-reference":
      return matchColumnReference(policy, policy.match, inspect, stepIndex)
    case "table-without-where":
      return matchTableWithoutWhere(policy, policy.match, inspect, stepIndex)
    case "statement-kind":
      return matchStatementKind(policy, policy.match, inspect, stepIndex)
    default: {
      const _exhaustive: never = policy.match
      throw new Error(`未知 matcher: ${String(_exhaustive)}`)
    }
  }
}

function matchColumnReference(
  policy: PolicyDoc,
  matcher: z.infer<typeof ColumnReferenceMatcher>,
  inspect: SqlInspection,
  stepIndex: number,
): CheckFinding[] {
  const forbidden = new Set(matcher.columns.map((c) => c.toLowerCase()))
  const findings: CheckFinding[] = []
  for (const ref of inspect.qualifiedColumns) {
    const key = `${ref.table}.${ref.column}`
    if (forbidden.has(key)) {
      findings.push(buildFinding(policy, stepIndex, { column: key }))
    }
  }
  return findings
}

function matchTableWithoutWhere(
  policy: PolicyDoc,
  matcher: z.infer<typeof TableWithoutWhereMatcher>,
  inspect: SqlInspection,
  stepIndex: number,
): CheckFinding[] {
  if (inspect.hasWhereClause) return []
  const watched = new Set(matcher.tables.map((t) => t.toLowerCase()))
  const findings: CheckFinding[] = []
  for (const table of inspect.tables) {
    if (watched.has(table)) {
      findings.push(buildFinding(policy, stepIndex, { table }))
    }
  }
  return findings
}

function matchStatementKind(
  policy: PolicyDoc,
  matcher: z.infer<typeof StatementKindMatcher>,
  inspect: SqlInspection,
  stepIndex: number,
): CheckFinding[] {
  if (inspect.kind === "other") return []
  if (!matcher.kinds.includes(inspect.kind as (typeof matcher.kinds)[number])) {
    return []
  }
  return [buildFinding(policy, stepIndex, { kind: inspect.kind.toUpperCase() })]
}

// ---------------------------------------------------------------------------
// finding 构造
// ---------------------------------------------------------------------------

function buildFinding(
  policy: PolicyDoc,
  stepIndex: number,
  fillers: Record<string, string>,
): CheckFinding {
  const message = renderTemplate(policy.on_match.message, fillers)
  const finding: CheckFinding = {
    ruleId: policy.id,
    level: policy.on_match.decision === "reject" ? "error" : "warning",
    message,
    location: `steps[${stepIndex}].sql`,
    ...(policy.on_match.suggestion !== undefined
      ? { suggestion: renderTemplate(policy.on_match.suggestion, fillers) }
      : {}),
    ...(policy.on_match.decision === "require_approval"
      ? { requiresApproval: true }
      : {}),
  }
  return finding
}

function renderTemplate(
  template: string,
  fillers: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => fillers[key] ?? m)
}
