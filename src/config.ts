/**
 * 从环境变量加载并校验后的运行时配置。
 *
 * 整个代码库统一通过这里读取运行时旋钮，下游 pipeline 不允许直接访问
 * `process.env`。配置在启动时一次性解析并缓存。
 *
 * 注意：本文件属于 harness ENGINE，不属于 harness CONTRACTS。
 * 契约（Zod schema）放在 `harness/contracts/`。
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
    throw new Error(`环境变量配置不合法：\n${issues}`)
  }

  return parsed.data
}

let _cached: HarnessConfig | null = null

/**
 * 获取已解析并缓存的配置；首次调用时执行解析。
 * 测试可以通过 `resetConfig()` 在修改 `process.env` 后强制重新解析。
 */
export function getConfig(): HarnessConfig {
  if (_cached === null) _cached = fromEnv()
  return _cached
}

export function resetConfig(): void {
  _cached = null
}

/**
 * 检查当前配置是否满足某个模式的运行前提。被 CLI 中真正会跑 pipeline
 * 的子命令（例如 `ask`）调用。
 */
export function assertReadyFor(mode: HarnessMode): void {
  const cfg = getConfig()
  if (cfg.mode !== mode && mode === "live") {
    return // CLI 在非 live 模式下也允许预校验。
  }
  if (cfg.mode === "live" && !cfg.openaiApiKey) {
    throw new Error(
      "HARNESS_MODE=live 需要设置 OPENAI_API_KEY。" +
        "请改回 HARNESS_MODE=demo，或提供 API key。",
    )
  }
}
