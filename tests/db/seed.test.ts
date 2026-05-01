/**
 * M1 验证：`seed()` 在重复调用时具有确定性。
 *
 * 这是 seed 函数最重要的单一性质——它让我们能写出每次输出都相同的演示
 * 剧本，也是 docs/roadmap.md M1 的判定标准。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { closeDb, getDb } from "../../src/db/client.js"
import { seed, REFERENCE_NOW } from "../../src/db/seed.js"
import { resetConfig } from "../../src/config.js"

let tmpRoot: string
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  tmpRoot = mkdtempSync(join(tmpdir(), "harness-seed-"))
  process.env.HARNESS_DB_PATH = join(tmpRoot, "demo.sqlite")
  resetConfig()
  closeDb()
})

afterEach(() => {
  closeDb()
  process.env = originalEnv
  resetConfig()
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe("M1 — 确定性 seed", () => {
  it("两次跑出来的行数和聚合完全相同", () => {
    const a = seed()
    const dbA = getDb()
    const ordersA = dbA.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }
    const itemsA = dbA.prepare("SELECT COUNT(*) AS n FROM order_items").get() as { n: number }
    const sumA = dbA.prepare("SELECT ROUND(SUM(total), 2) AS s FROM orders").get() as { s: number }
    closeDb()

    // 切到一个新的临时目录，重新 seed。
    rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-seed-"))
    process.env.HARNESS_DB_PATH = join(tmpRoot, "demo.sqlite")
    resetConfig()

    const b = seed()
    const dbB = getDb()
    const ordersB = dbB.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }
    const itemsB = dbB.prepare("SELECT COUNT(*) AS n FROM order_items").get() as { n: number }
    const sumB = dbB.prepare("SELECT ROUND(SUM(total), 2) AS s FROM orders").get() as { s: number }
    closeDb()

    expect(b).toEqual(a)
    expect(ordersB.n).toBe(ordersA.n)
    expect(itemsB.n).toBe(itemsA.n)
    expect(sumB.s).toBe(sumA.s)
  })

  it("行数符合 roadmap M1 设定的目标", () => {
    const summary = seed()
    expect(summary.customers).toBe(50)
    expect(summary.products).toBe(20)
    expect(summary.orders).toBe(200)
    expect(summary.orderItems).toBe(500)
    expect(summary.inventory).toBe(20)
  })

  it("不依赖 wall-clock，订单时间窗口都早于 REFERENCE_NOW", () => {
    const summary = seed()
    expect(summary.latestOrderedAt <= REFERENCE_NOW).toBe(true)
    // 6 个月 ≈ 180 天，留一点余量
    const earliest = new Date(summary.earliestOrderedAt).getTime()
    const ref = new Date(REFERENCE_NOW).getTime()
    const days = (ref - earliest) / (1000 * 60 * 60 * 24)
    expect(days).toBeGreaterThanOrEqual(0)
    expect(days).toBeLessThanOrEqual(181)
  })

  it("外键完整、CHECK 约束全部满足", () => {
    seed()
    const db = getDb()
    // 没有 order_items 指向不存在的 order
    const orphanItems = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM order_items oi
         LEFT JOIN orders o ON o.id = oi.order_id
         WHERE o.id IS NULL`,
      )
      .get() as { n: number }
    expect(orphanItems.n).toBe(0)

    // 每个 product 都有对应的 inventory 行
    const missingInv = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE i.product_id IS NULL`,
      )
      .get() as { n: number }
    expect(missingInv.n).toBe(0)

    // 没有负的 total
    const badTotals = db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE total < 0")
      .get() as { n: number }
    expect(badTotals.n).toBe(0)
  })
})
