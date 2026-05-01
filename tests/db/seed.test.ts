/**
 * M1 verification: `seed()` is deterministic across repeated invocations.
 *
 * This is the single most important property of the seed function — it lets us
 * write demo scenarios that always produce the same output, and it's the
 * judgement criterion in docs/roadmap.md M1.
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

describe("M1 — deterministic seed", () => {
  it("produces stable row counts and aggregates across two runs", () => {
    const a = seed()
    const dbA = getDb()
    const ordersA = dbA.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }
    const itemsA = dbA.prepare("SELECT COUNT(*) AS n FROM order_items").get() as { n: number }
    const sumA = dbA.prepare("SELECT ROUND(SUM(total), 2) AS s FROM orders").get() as { s: number }
    closeDb()

    // Reset DB file and re-seed against a fresh tmp path.
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

  it("respects target counts from roadmap M1", () => {
    const summary = seed()
    expect(summary.customers).toBe(50)
    expect(summary.products).toBe(20)
    expect(summary.orders).toBe(200)
    expect(summary.orderItems).toBe(500)
    expect(summary.inventory).toBe(20)
  })

  it("does not consult wall-clock time (orders span before REFERENCE_NOW)", () => {
    const summary = seed()
    expect(summary.latestOrderedAt <= REFERENCE_NOW).toBe(true)
    // 6 months ≈ 180 days; allow a tiny margin
    const earliest = new Date(summary.earliestOrderedAt).getTime()
    const ref = new Date(REFERENCE_NOW).getTime()
    const days = (ref - earliest) / (1000 * 60 * 60 * 24)
    expect(days).toBeGreaterThanOrEqual(0)
    expect(days).toBeLessThanOrEqual(181)
  })

  it("produces valid foreign keys and check constraints", () => {
    seed()
    const db = getDb()
    // No order_items reference a non-existent order
    const orphanItems = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM order_items oi
         LEFT JOIN orders o ON o.id = oi.order_id
         WHERE o.id IS NULL`,
      )
      .get() as { n: number }
    expect(orphanItems.n).toBe(0)

    // Every product has an inventory row
    const missingInv = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE i.product_id IS NULL`,
      )
      .get() as { n: number }
    expect(missingInv.n).toBe(0)

    // No negative totals
    const badTotals = db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE total < 0")
      .get() as { n: number }
    expect(badTotals.n).toBe(0)
  })
})
