#!/usr/bin/env node
/**
 * CLI entry point. Registers all subcommands and dispatches.
 *
 * In M0 the subcommands are stubs that announce themselves and exit. Each
 * milestone replaces one stub with a real implementation. See docs/roadmap.md.
 */

import { Command } from "commander"
import { getConfig } from "../config.js"

const NOT_IMPLEMENTED_EXIT_CODE = 64

const program = new Command()

program
  .name("harness")
  .description(
    "Teaching demo of Harness Engineering: SQL assistant with " +
      "Intent/Plan/Check/Approve/Execute/Trace pipeline.",
  )
  .version("0.1.0")

program
  .command("ask")
  .description("Submit a natural-language intent and run the harness pipeline")
  .argument("<question>", "Natural-language request, e.g. \"上个月销售前 5\"")
  .action((_question: string) => {
    stub("ask", "M3 will implement Intent → Plan → Check; M5 will land scenarios.")
  })

program
  .command("approve")
  .description("Approve a pending-approval run, executing the staged plan")
  .argument("<run-id>", "Run id from runs/ directory")
  .action((_runId: string) => {
    stub("approve", "M6 will implement two-phase approval.")
  })

program
  .command("reject")
  .description("Reject a pending-approval run with a reason")
  .argument("<run-id>", "Run id from runs/ directory")
  .requiredOption("--reason <text>", "Why this run is being rejected (required)")
  .action((_runId: string, _opts: { reason: string }) => {
    stub("reject", "M6 will implement two-phase rejection.")
  })

program
  .command("runs")
  .description("List recent runs (id, status, intent, timestamp)")
  .action(() => {
    stub("runs", "M6 will list runs/ directory contents.")
  })

program
  .command("show")
  .description("Print the report.md of a given run")
  .argument("<run-id>", "Run id from runs/ directory")
  .action((_runId: string) => {
    stub("show", "M7 will render runs/<id>/report.md to stdout.")
  })

program
  .command("mode")
  .description("Print the active harness mode (demo or live)")
  .action(() => {
    const cfg = getConfig()
    process.stdout.write(`${cfg.mode}\n`)
  })

program
  .command("seed")
  .description("Initialize or reset the demo SQLite database")
  .action(() => {
    stub("seed", "M1 will populate ./data/demo.sqlite with deterministic seed data.")
  })

function stub(command: string, note: string): void {
  process.stderr.write(
    `[harness] '${command}' is not implemented yet.\n` +
      `[harness] ${note}\n` +
      `[harness] See docs/roadmap.md for the milestone schedule.\n`,
  )
  process.exit(NOT_IMPLEMENTED_EXIT_CODE)
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `[harness] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})
