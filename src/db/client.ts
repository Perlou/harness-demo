/**
 * 业务平面 SQLite 客户端。
 *
 * 边界规则：
 *   - 控制平面（src/pipeline/*、src/planners/*）禁止通过本模块写业务表，
 *     写入只能由 src/pipeline/executor.ts 触发。
 *   - 读访问被允许：schemaCheck.ts 需要内省真实 schema、scenarioEval.ts
 *     需要跑 EXPLAIN QUERY PLAN。
 *
 * 客户端是进程单例。测试可以通过 `closeDb()` 在用例之间强制重开，从而
 * 切换到不同的 db 路径。
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import Database, { type Database as DatabaseType } from "better-sqlite3"

import { getConfig } from "../config.js"

let _db: DatabaseType | null = null
let _openedFor: string | null = null

const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "schema.sql",
)

/**
 * 返回单例数据库句柄。首次调用时会打开连接并保证 schema 已应用。
 */
export function getDb(): DatabaseType {
  const cfg = getConfig()
  if (_db !== null && _openedFor === cfg.dbPath) return _db

  if (_db !== null) {
    _db.close()
    _db = null
  }

  ensureParentDir(cfg.dbPath)
  const db = new Database(cfg.dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  applySchema(db)

  _db = db
  _openedFor = cfg.dbPath
  return db
}

/**
 * 删除全部业务表（连同 audit_log）并重新应用 schema。供 `harness seed` 使用。
 */
export function resetDb(): DatabaseType {
  const db = getDb()
  // 按外键反向顺序 drop。
  db.exec(`
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS inventory;
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS customers;
  `)
  applySchema(db)
  return db
}

/**
 * 关闭单例（供测试 / 进程退出使用）。
 */
export function closeDb(): void {
  if (_db !== null) {
    _db.close()
    _db = null
    _openedFor = null
  }
}

function applySchema(db: DatabaseType): void {
  const ddl = readFileSync(SCHEMA_PATH, "utf8")
  db.exec(ddl)
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
