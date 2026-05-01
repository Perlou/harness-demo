#!/usr/bin/env node
/**
 * CLI 入口。注册所有子命令并分发。
 *
 * M0 阶段所有子命令都是占位实现，进入后报错并退出。后续每个里程碑会用
 * 真实实现替换其中一个。详见 docs/roadmap.md。
 */

import { Command } from "commander"
import { getConfig } from "../config.js"
import { runAsk } from "./ask.js"
import { runSeed } from "./seed.js"

const NOT_IMPLEMENTED_EXIT_CODE = 64

const program = new Command()

program
  .name("harness")
  .description(
    "Harness Engineering 教学 demo：基于 Intent/Plan/Check/Approve/Execute/Trace " +
      "管道的 SQL 助手 CLI。",
  )
  .version("0.1.0")

program
  .command("ask")
  .description("提交一条自然语言意图，跑完整 harness pipeline")
  .argument("<question>", "自然语言请求，例如 \"上个月销售前 5\"")
  .action(async (question: string) => {
    const code = await runAsk(question)
    process.exit(code)
  })

program
  .command("approve")
  .description("批准一个待审批的运行，执行其 staged plan")
  .argument("<run-id>", "来自 runs/ 目录的运行 id")
  .action((_runId: string) => {
    stub("approve", "M6 会落地两阶段审批。")
  })

program
  .command("reject")
  .description("拒绝一个待审批的运行，并强制要求理由")
  .argument("<run-id>", "来自 runs/ 目录的运行 id")
  .requiredOption("--reason <text>", "拒绝原因（必填）")
  .action((_runId: string, _opts: { reason: string }) => {
    stub("reject", "M6 会落地两阶段拒绝。")
  })

program
  .command("runs")
  .description("列出最近的运行（id、状态、意图摘要、时间）")
  .action(() => {
    stub("runs", "M6 会读取 runs/ 目录列出运行。")
  })

program
  .command("show")
  .description("打印某个运行的 report.md")
  .argument("<run-id>", "来自 runs/ 目录的运行 id")
  .action((_runId: string) => {
    stub("show", "M7 会把 runs/<id>/report.md 输出到 stdout。")
  })

program
  .command("mode")
  .description("打印当前 harness 模式（demo 或 live）")
  .action(() => {
    const cfg = getConfig()
    process.stdout.write(`${cfg.mode}\n`)
  })

program
  .command("seed")
  .description("初始化或重置 demo SQLite 数据库（确定性 seed）")
  .action(() => {
    runSeed()
  })

function stub(command: string, note: string): void {
  process.stderr.write(
    `[harness] '${command}' 尚未实现。\n` +
      `[harness] ${note}\n` +
      `[harness] 里程碑排期见 docs/roadmap.md。\n`,
  )
  process.exit(NOT_IMPLEMENTED_EXIT_CODE)
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `[harness] 严重错误：${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})
