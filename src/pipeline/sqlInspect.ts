/**
 * 极简 SQL 检查器。
 *
 * 用途：给 schema/policy/scenario 检查提供结构化的 SQL 元信息（动词、
 * 引用的表、限定列引用、是否带 WHERE / LIMIT）。
 *
 * 这不是一个完整的 SQL parser，而是 demo 范围内够用的正则提取器。
 * 已知不处理的场景：
 *   - CTE / 子查询里的列别名（视为没有限定）
 *   - 多语句（仅检查首条 SQL）
 *   - 字符串字面量里的 "table.col" 假命中
 *   - 注释里的关键字假命中（已通过先剥离注释缓解）
 *
 * 这些边界对我们的 4 个出厂剧本是够用的；如果未来需要支持更复杂的 SQL，
 * 应该换一个真实的 SQL parser 而不是把正则写得更花。
 */

export type SqlKind = "select" | "insert" | "update" | "delete" | "other"

export interface ColumnRef {
  table: string
  column: string
}

export interface SqlInspection {
  kind: SqlKind
  /** 引用到的表名（小写，去重）。 */
  tables: ReadonlySet<string>
  /** 形如 `customers.email` 的限定列引用（去重）。 */
  qualifiedColumns: ReadonlyArray<ColumnRef>
  hasWhereClause: boolean
  hasLimitClause: boolean
}

const KIND_PATTERN = /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i

const FROM_TABLE_PATTERN = /\bFROM\s+([a-zA-Z_][\w]*)/gi
const JOIN_TABLE_PATTERN = /\bJOIN\s+([a-zA-Z_][\w]*)/gi
const UPDATE_TABLE_PATTERN = /\bUPDATE\s+([a-zA-Z_][\w]*)/i
const INSERT_TABLE_PATTERN = /\bINSERT\s+INTO\s+([a-zA-Z_][\w]*)/i
const DELETE_TABLE_PATTERN = /\bDELETE\s+FROM\s+([a-zA-Z_][\w]*)/i

const QUALIFIED_COL_PATTERN = /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b/g
const WHERE_PATTERN = /\bWHERE\b/i
const LIMIT_PATTERN = /\bLIMIT\b/i

export function inspectSql(sql: string): SqlInspection {
  const stripped = stripCommentsAndStrings(sql).trim()
  const kind = detectKind(stripped)

  const tables = new Set<string>()
  collectMatches(stripped, FROM_TABLE_PATTERN, tables)
  collectMatches(stripped, JOIN_TABLE_PATTERN, tables)
  collectFirstMatch(stripped, UPDATE_TABLE_PATTERN, tables)
  collectFirstMatch(stripped, INSERT_TABLE_PATTERN, tables)
  collectFirstMatch(stripped, DELETE_TABLE_PATTERN, tables)

  const seen = new Set<string>()
  const qualifiedColumns: ColumnRef[] = []
  for (const m of stripped.matchAll(QUALIFIED_COL_PATTERN)) {
    const table = m[1]!.toLowerCase()
    const column = m[2]!.toLowerCase()
    const key = `${table}.${column}`
    if (seen.has(key)) continue
    seen.add(key)
    qualifiedColumns.push({ table, column })
  }

  return {
    kind,
    tables,
    qualifiedColumns,
    hasWhereClause: WHERE_PATTERN.test(stripped),
    hasLimitClause: LIMIT_PATTERN.test(stripped),
  }
}

function detectKind(sql: string): SqlKind {
  const m = KIND_PATTERN.exec(sql)
  if (!m) return "other"
  return m[1]!.toLowerCase() as SqlKind
}

function collectMatches(
  sql: string,
  pattern: RegExp,
  out: Set<string>,
): void {
  for (const m of sql.matchAll(pattern)) {
    out.add(m[1]!.toLowerCase())
  }
}

function collectFirstMatch(
  sql: string,
  pattern: RegExp,
  out: Set<string>,
): void {
  const m = pattern.exec(sql)
  if (m) out.add(m[1]!.toLowerCase())
}

/**
 * 剥离 `--` / `/* * /` 注释，并把字符串字面量替换成空白，避免出现
 * 字符串里的 `'a.b'` 被误识别为限定列。
 */
function stripCommentsAndStrings(sql: string): string {
  let out = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
  // 把单引号字符串内部替换成空格（保留长度，避免影响其他正则）。
  out = out.replace(/'([^']|'')*'/g, (lit) => " ".repeat(lit.length))
  return out
}
