/**
 * 出厂剧本端到端测试通用 fixture。
 *
 * 每个 scenario test 通过这里搭/拆环境（临时 DB、临时 runs、reset 缓存），
 * 让 4 个 e2e 测试互不干扰。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { closeDb } from "../../src/db/client.js"
import { seed } from "../../src/db/seed.js"
import { resetConfig } from "../../src/config.js"
import { resetPolicyCache } from "../../src/pipeline/policyCheck.js"
import { resetScenarioCache } from "../../src/pipeline/scenarioEval.js"

export interface ScenarioFixture {
  tmpRoot: string
  cleanup(): void
}

export function setupScenarioEnv(): ScenarioFixture {
  const originalEnv = { ...process.env }
  const tmpRoot = mkdtempSync(join(tmpdir(), "harness-scenario-"))
  process.env.HARNESS_DB_PATH = join(tmpRoot, "demo.sqlite")
  process.env.HARNESS_RUNS_DIR = join(tmpRoot, "runs")
  resetConfig()
  resetPolicyCache()
  resetScenarioCache()
  closeDb()
  seed()
  closeDb()

  return {
    tmpRoot,
    cleanup() {
      closeDb()
      process.env = originalEnv
      resetConfig()
      resetPolicyCache()
      resetScenarioCache()
      rmSync(tmpRoot, { recursive: true, force: true })
    },
  }
}

/** 把 trace.jsonl 解析为事件 kind 列表，方便断言。 */
export function readTraceKinds(runDir: string): string[] {
  const raw = readFileSync(join(runDir, "trace.jsonl"), "utf8")
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => (JSON.parse(l) as { kind: string }).kind)
}
