/**
 * Live Mode 的 Planner —— 通过 OpenAI Chat Completions 把 IntentSpec
 * 翻译成结构化 Plan。
 *
 * 核心约束（与 docs/architecture.md §9.2 对齐）：
 *   - prompt 模板来自 harness/prompts/，是仓库内可被 review 的工件
 *   - 输出走 response_format: { type: "json_object" }
 *   - 收到的 JSON 用 Zod (Plan) 严格校验；不合法 → emit
 *     plan.invalid_structure → 抛错让 engine 进入 failed 终态
 *   - **下游 pipeline（Schema / Policy / Scenario / Approval / Executor）
 *     完全不变** —— 这是 harness engineering "同一套环境同时约束规则
 *     系统和真实模型" 的核心论点
 *
 * 测试可以通过 `setLivePlannerClientForTests()` 注入一个假的 OpenAI 客户端。
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import OpenAI from "openai"

import { Plan, type IntentSpec } from "../../harness/contracts/index.js"
import { getConfig } from "../config.js"
import { getDb } from "../db/client.js"
import type { RunContext } from "../pipeline/context.js"
import type { Planner } from "../pipeline/planner.js"

// ---------------------------------------------------------------------------
// OpenAI 客户端的最小契约（便于测试 mock）
// ---------------------------------------------------------------------------

export interface ChatLike {
  chat: {
    completions: {
      create(params: {
        model: string
        messages: Array<{ role: "system" | "user"; content: string }>
        response_format?: { type: "json_object" }
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>
      }>
    }
  }
}

/** 测试钩子：注入一个假客户端（设为 null 可恢复真客户端）。 */
let _testClient: ChatLike | null = null
export function setLivePlannerClientForTests(client: ChatLike | null): void {
  _testClient = client
}

// ---------------------------------------------------------------------------
// Prompt 模板加载
// ---------------------------------------------------------------------------

const PROMPTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../harness/prompts",
)

function loadPlannerTemplate(): string {
  return readFileSync(resolve(PROMPTS_DIR, "planner.tmpl"), "utf8")
}

function renderTemplate(
  template: string,
  fillers: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key: string) =>
    fillers[key] !== undefined ? fillers[key]! : m,
  )
}

// ---------------------------------------------------------------------------
// db schema 文本（注入 prompt 用）
// ---------------------------------------------------------------------------

function dbSchemaForPrompt(): string {
  const db = getDb()
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as Array<{ name: string }>

  const lines: string[] = []
  for (const t of tables) {
    const cols = db
      .prepare(`PRAGMA table_info(${t.name})`)
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>
    const colDescs = cols.map((c) => {
      const flags: string[] = []
      if (c.pk === 1) flags.push("PK")
      if (c.notnull === 1) flags.push("NOT NULL")
      return `  ${c.name} ${c.type}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`
    })
    lines.push(`${t.name}:`, ...colDescs, "")
  }
  return lines.join("\n").trim()
}

// ---------------------------------------------------------------------------
// LivePlanner 工厂
// ---------------------------------------------------------------------------

export function createLivePlanner(): Planner {
  return {
    name: "live",
    async generate(intent: IntentSpec, ctx?: RunContext): Promise<Plan> {
      const cfg = getConfig()
      const client = resolveClient()
      const prompt = renderTemplate(loadPlannerTemplate(), {
        db_schema: dbSchemaForPrompt(),
        intent_json: JSON.stringify(intent, null, 2),
        run_id: ctx?.runId ?? "live-run",
      })

      ctx?.trace.emit({
        stage: "plan",
        kind: "plan.live_request",
        payload: { model: cfg.liveModel, promptBytes: prompt.length },
      })

      const completion = await client.chat.completions.create({
        model: cfg.liveModel,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: intent.rawText },
        ],
        response_format: { type: "json_object" },
      })

      const raw = completion.choices[0]?.message.content ?? ""
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        ctx?.trace.emit({
          stage: "plan",
          kind: "plan.invalid_structure",
          payload: {
            stage: "json_parse",
            error: err instanceof Error ? err.message : String(err),
            sample: raw.slice(0, 200),
          },
        })
        throw new Error(
          "LivePlanner: 模型返回的内容不是合法 JSON",
        )
      }

      const result = Plan.safeParse(parsed)
      if (!result.success) {
        ctx?.trace.emit({
          stage: "plan",
          kind: "plan.invalid_structure",
          payload: {
            stage: "schema_validate",
            issues: result.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
        })
        throw new Error(
          "LivePlanner: 模型返回的 JSON 不符合 Plan schema",
        )
      }

      ctx?.trace.emit({
        stage: "plan",
        kind: "plan.live_response_validated",
        payload: { stepCount: result.data.steps.length },
      })
      return result.data
    },
  }
}

function resolveClient(): ChatLike {
  if (_testClient !== null) return _testClient
  const cfg = getConfig()
  if (!cfg.openaiApiKey) {
    throw new Error(
      "HARNESS_MODE=live 需要设置 OPENAI_API_KEY；或切回 HARNESS_MODE=demo。",
    )
  }
  return new OpenAI({ apiKey: cfg.openaiApiKey })
}
