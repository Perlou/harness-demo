/**
 * SQL inspector 单测。覆盖动词识别、表/列提取、WHERE/LIMIT 检测、
 * 注释和字符串字面量的剥离。
 */

import { describe, expect, it } from "vitest"
import { inspectSql } from "../../src/pipeline/sqlInspect.js"

describe("M4 — sqlInspect", () => {
  it("识别 SELECT 动词 + FROM 表 + JOIN 表", () => {
    const r = inspectSql(
      "SELECT o.id, p.name FROM orders o JOIN products p ON p.id = o.id WHERE o.id = 1",
    )
    expect(r.kind).toBe("select")
    expect([...r.tables].sort()).toEqual(["orders", "products"])
    expect(r.hasWhereClause).toBe(true)
    expect(r.hasLimitClause).toBe(false)
  })

  it("识别 UPDATE / INSERT / DELETE 的目标表", () => {
    expect(inspectSql("UPDATE customers SET name='x' WHERE id=1").kind).toBe(
      "update",
    )
    expect([...inspectSql("UPDATE customers SET x=1").tables]).toEqual([
      "customers",
    ])
    expect([...inspectSql("INSERT INTO orders VALUES (1)").tables]).toEqual([
      "orders",
    ])
    expect([...inspectSql("DELETE FROM inventory WHERE id=1").tables]).toEqual([
      "inventory",
    ])
  })

  it("提取限定列引用，去重 + 小写化", () => {
    const r = inspectSql(
      "SELECT customers.email, Customers.Phone FROM customers WHERE customers.id = 1",
    )
    const keys = r.qualifiedColumns.map((c) => `${c.table}.${c.column}`).sort()
    expect(keys).toEqual(["customers.email", "customers.id", "customers.phone"])
  })

  it("剥离注释和字符串字面量，避免假命中", () => {
    const r = inspectSql(`
      -- WHERE this should not count
      SELECT 1 AS one /* JOIN nope */
      FROM products
      WHERE name != 'something.else'
    `)
    expect(r.tables).toEqual(new Set(["products"]))
    expect(r.qualifiedColumns).toHaveLength(0)
    expect(r.hasWhereClause).toBe(true)
  })

  it("LIMIT 检测", () => {
    expect(inspectSql("SELECT * FROM x LIMIT 10").hasLimitClause).toBe(true)
    expect(inspectSql("SELECT * FROM x").hasLimitClause).toBe(false)
  })

  it("无法识别的动词回退为 other", () => {
    expect(inspectSql("EXPLAIN QUERY PLAN SELECT 1").kind).toBe("other")
    expect(inspectSql("VACUUM").kind).toBe("other")
  })
})
