/**
 * Typed runtime configuration loaded from environment variables.
 *
 * The config object is the single entry point through which the rest of the
 * codebase reads runtime knobs. We resolve it once at startup so that the
 * downstream pipeline never reaches into `process.env` directly.
 *
 * NOTE: this file is part of the harness ENGINE, not the harness CONTRACTS.
 * Contracts (Zod schemas) live under `harness/contracts/`.
 */

import { config as loadDotenv } from "dotenv"
import { z } from "zod"

loadDotenv()

const HarnessMode = z.enum(["demo", "live"])
export type HarnessMode = z.infer<typeof HarnessMode>

const ConfigSchema = z.object({
  mode: HarnessMode.default("demo"),
  openaiApiKey: z.string().optional(),
  runsDir: z.string().default("./runs"),
  dbPath: z.string().default("./data/demo.sqlite"),
  rowBudgetRead: z.coerce.number().int().positive().default(10_000),
  rowBudgetWrite: z.coerce.number().int().positive().default(1_000),
  liveModel: z.string().default("gpt-4o-mini"),
})

export type HarnessConfig = z.infer<typeof ConfigSchema>

function fromEnv(): HarnessConfig {
  const parsed = ConfigSchema.safeParse({
    mode: process.env.HARNESS_MODE,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    runsDir: process.env.HARNESS_RUNS_DIR,
    dbPath: process.env.HARNESS_DB_PATH,
    rowBudgetRead: process.env.HARNESS_ROW_BUDGET_READ,
    rowBudgetWrite: process.env.HARNESS_ROW_BUDGET_WRITE,
    liveModel: process.env.HARNESS_LIVE_MODEL,
  })

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  return parsed.data
}

let _cached: HarnessConfig | null = null

/**
 * Resolve the typed config once and cache it. Tests can call `resetConfig()`
 * to force a re-read after mutating `process.env`.
 */
export function getConfig(): HarnessConfig {
  if (_cached === null) _cached = fromEnv()
  return _cached
}

export function resetConfig(): void {
  _cached = null
}

/**
 * Assert the config is valid for the requested mode. Called by CLI commands
 * that actually need to run the pipeline (e.g. `ask`).
 */
export function assertReadyFor(mode: HarnessMode): void {
  const cfg = getConfig()
  if (cfg.mode !== mode && mode === "live") {
    return // The CLI may want to validate even when not the active mode.
  }
  if (cfg.mode === "live" && !cfg.openaiApiKey) {
    throw new Error(
      "HARNESS_MODE=live requires OPENAI_API_KEY to be set. " +
        "Switch to HARNESS_MODE=demo or provide an API key.",
    )
  }
}
