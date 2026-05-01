/**
 * Business-plane SQLite client.
 *
 * Rules:
 *   - The control plane (src/pipeline/*, src/planners/*) MUST NOT import this
 *     module to perform writes — only src/pipeline/executor.ts is allowed to.
 *   - Read access is permitted for schemaCheck.ts (introspect actual schema)
 *     and scenarioEval.ts (EXPLAIN QUERY PLAN).
 *
 * The client is process-singleton. Tests can call `closeDb()` between cases to
 * force a re-open against a different path.
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
 * Return the singleton database handle, opening it (and ensuring the schema
 * exists) on first use.
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
 * Drop every business table (NOT audit_log resets too) and re-apply the schema.
 * Used by `harness seed`.
 */
export function resetDb(): DatabaseType {
  const db = getDb()
  // Drop in reverse-FK order.
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
 * Close the singleton (for tests / shutdown).
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
