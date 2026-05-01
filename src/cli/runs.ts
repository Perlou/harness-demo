/**
 * `harness runs` —— 列出 runs/ 目录下的全部运行。
 *
 * 输出形如：
 *
 *   ID                                STATUS              INTENT
 *   2026-05-01T03-45-28-d163          committed           上个月销售前 5 的产品
 *   2026-05-01T03-45-29-9af2          rejected_by_policy  导出所有客户的邮箱…
 *   ...
 *
 * 按 id（即 ISO 时间戳）降序排列，最新的在最上面。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { getConfig } from "../config.js"

export function runRunsList(): number {
  const cfg = getConfig()
  if (!existsSync(cfg.runsDir)) {
    process.stdout.write("（runs 目录还不存在；先用 `harness ask` 跑一次）\n")
    return 0
  }

  const entries = readdirSync(cfg.runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()

  if (entries.length === 0) {
    process.stdout.write("（runs 目录为空；先用 `harness ask` 跑一次）\n")
    return 0
  }

  const rows: Array<{ id: string; status: string; intent: string }> = []
  for (const id of entries) {
    const dir = join(cfg.runsDir, id)
    const statusPath = join(dir, "status")
    const intentPath = join(dir, "intent.json")
    if (!statSync(dir).isDirectory()) continue

    const status = existsSync(statusPath)
      ? readFileSync(statusPath, "utf8").trim()
      : "(unknown)"
    let intent = "(missing intent.json)"
    if (existsSync(intentPath)) {
      try {
        const obj = JSON.parse(readFileSync(intentPath, "utf8")) as {
          rawText?: string
        }
        intent = (obj.rawText ?? "").slice(0, 60)
      } catch {
        intent = "(invalid intent.json)"
      }
    }
    rows.push({ id, status, intent })
  }

  const idWidth = Math.max(...rows.map((r) => r.id.length), 2)
  const statusWidth = Math.max(...rows.map((r) => r.status.length), 6)
  const header = `${pad("ID", idWidth)}  ${pad("STATUS", statusWidth)}  INTENT`
  const sep = `${"-".repeat(idWidth)}  ${"-".repeat(statusWidth)}  ${"-".repeat(40)}`
  const lines = [header, sep]
  for (const r of rows) {
    lines.push(`${pad(r.id, idWidth)}  ${pad(r.status, statusWidth)}  ${r.intent}`)
  }
  process.stdout.write(lines.join("\n") + "\n")
  return 0
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}
