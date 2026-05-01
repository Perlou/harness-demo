/**
 * Demo 模式的 Planner。
 *
 * M3 占位实现：永远返回一份合法的 read-only Plan（`SELECT 1 AS one`），
 * 让骨架能跑通。
 *
 * M5 会重写为 case-based dispatch，覆盖出厂剧本（happy path / PII 拦截 /
 * 可修复 policy / 写操作 approval）。
 */

import { Plan, type IntentSpec } from "../../harness/contracts/index.js"
import type { Planner } from "../pipeline/planner.js"

export const demoPlanner: Planner = {
  name: "demo",
  generate(intent: IntentSpec): Plan {
    return Plan.parse({
      intentId: intent.rawText.slice(0, 32) || "demo",
      steps: [
        {
          kind: "sql",
          mode: "read",
          sql: "SELECT 1 AS one",
          expectedColumns: ["one"],
          estimatedRows: 1,
        },
      ],
      rationale: "M3 占位 plan：返回常量 1，仅用于验证 pipeline 五阶段贯通。",
    })
  },
}
