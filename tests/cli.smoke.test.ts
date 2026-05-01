/**
 * M0 冒烟测试：证明 CLI 模块能被加载、config 解析路径不会因默认值崩溃。
 * 这里不真正跑 argv 解析——只是 import config，确保校验路径走得通。
 *
 * 真正的子命令行为在后续里程碑测试。
 */

import { describe, it, expect, beforeEach } from "vitest"
import { getConfig, resetConfig } from "../src/config.js"

describe("M0 — config 加载", () => {
  beforeEach(() => {
    resetConfig()
  })

  it("env 为空时使用安全默认值", () => {
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

  it("拒绝未知的 HARNESS_MODE", () => {
    const original = process.env.HARNESS_MODE
    process.env.HARNESS_MODE = "wat"
    try {
      expect(() => getConfig()).toThrow(/环境变量配置不合法/)
    } finally {
      if (original === undefined) delete process.env.HARNESS_MODE
      else process.env.HARNESS_MODE = original
      resetConfig()
    }
  })

  it("把字符串形式的数值预算 coerce 成 number", () => {
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
