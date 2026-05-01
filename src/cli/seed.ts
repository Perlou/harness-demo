/**
 * `harness seed` — initialize / reset the demo SQLite database with
 * deterministic fixture data.
 */

import { closeDb } from "../db/client.js"
import { seed } from "../db/seed.js"
import { getConfig } from "../config.js"

export function runSeed(): void {
  const cfg = getConfig()
  const summary = seed()
  closeDb()

  const lines: string[] = [
    `harness seed → ${cfg.dbPath}`,
    "",
    `  customers       : ${summary.customers}`,
    `  products        : ${summary.products}`,
    `  inventory rows  : ${summary.inventory}`,
    `  orders          : ${summary.orders}`,
    `  order_items     : ${summary.orderItems}`,
    `  audit_log       : 0 (populated at runtime)`,
    "",
    `  earliest order  : ${summary.earliestOrderedAt}`,
    `  latest order    : ${summary.latestOrderedAt}`,
    `  total revenue   : $${summary.totalRevenue.toFixed(2)}`,
    "",
  ]
  process.stdout.write(lines.join("\n"))
}
