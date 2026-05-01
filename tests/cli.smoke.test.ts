/**
 * M0 smoke test: prove the CLI can be loaded and reports its registered
 * subcommands. We don't actually execute argv parsing here — we just import
 * config to make sure the env-validation path doesn't blow up on defaults.
 *
 * Real subcommand behaviour is exercised in later milestones.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { getConfig, resetConfig } from "../src/config.js"

describe("M0 — config loading", () => {
  beforeEach(() => {
    resetConfig()
  })

  it("loads with safe defaults when env is empty", () => {
    const original = { ...process.env }
    delete process.env.HARNESS_MODE
    delete process.env.HARNESS_RUNS_DIR
    delete process.env.HARNESS_DB_PATH
    delete process.env.HARNESS_ROW_BUDGET_READ
    delete process.env.HARNESS_ROW_BUDGET_WRITE
    delete process.env.HARNESS_LIVE_MODEL

    try {
      const cfg = getConfig()
      expect(cfg.mode).toBe("demo")
      expect(cfg.runsDir).toBe("./runs")
      expect(cfg.dbPath).toBe("./data/demo.sqlite")
      expect(cfg.rowBudgetRead).toBe(10_000)
      expect(cfg.rowBudgetWrite).toBe(1_000)
    } finally {
      process.env = original
      resetConfig()
    }
  })

  it("rejects an unknown HARNESS_MODE", () => {
    const original = process.env.HARNESS_MODE
    process.env.HARNESS_MODE = "wat"
    try {
      expect(() => getConfig()).toThrow(/Invalid environment configuration/)
    } finally {
      if (original === undefined) delete process.env.HARNESS_MODE
      else process.env.HARNESS_MODE = original
      resetConfig()
    }
  })

  it("coerces numeric budgets from strings", () => {
    const original = { ...process.env }
    process.env.HARNESS_ROW_BUDGET_READ = "500"
    process.env.HARNESS_ROW_BUDGET_WRITE = "50"
    try {
      const cfg = getConfig()
      expect(cfg.rowBudgetRead).toBe(500)
      expect(cfg.rowBudgetWrite).toBe(50)
    } finally {
      process.env = original
      resetConfig()
    }
  })
})
