/**
 * Demo 出厂剧本的关键词探测器。被 intent 阶段和 demo planner 共享，
 * 保证两端理解一致。
 *
 * 4 个剧本（与 docs/requirements.md §5 对齐）：
 *
 *   case A · top-sales        →  happy path（read 自动放行）
 *   case B · export-pii       →  policy 拦截（PII 字段）
 *   case C · count-orders     →  policy 拦截（缺 WHERE 时间过滤）
 *   case D · mark-completed   →  approval gate（写操作）
 *
 * 没命中任何剧本 → 返回 null，由调用方走 fallback。
 */

export type DemoCase =
  | "top-sales"
  | "export-pii"
  | "count-orders"
  | "mark-completed"

export function detectCase(rawText: string): DemoCase | null {
  const t = rawText.trim()
  if (matchesAll(t, [/销售|sales/i, /前\s*\d+|top\b/i])) return "top-sales"
  if (matchesAny(t, [/邮箱|email/i, /手机|phone/i])) return "export-pii"
  if (matchesAll(t, [/orders|订单/i, /行|条|数量|多少/])) return "count-orders"
  if (matchesAll(t, [/标记|完成/, /已完成|未确认|90.*?天|completed/i])) {
    return "mark-completed"
  }
  return null
}

function matchesAll(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.every((p) => p.test(text))
}

function matchesAny(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some((p) => p.test(text))
}
