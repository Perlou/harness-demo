/**
 * `harness seed` —— 用确定性的 fixture 数据初始化或重置 demo SQLite 库。
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
    `  audit_log       : 0（运行时由 executor 写入）`,
    "",
    `  earliest order  : ${summary.earliestOrderedAt}`,
    `  latest order    : ${summary.latestOrderedAt}`,
    `  total revenue   : $${summary.totalRevenue.toFixed(2)}`,
    "",
  ]
  process.stdout.write(lines.join("\n"))
}
