-- 业务平面 schema。仅由 src/db/ 持有。
-- harness 控制平面禁止直接引用这些表，写入只能通过 src/pipeline/executor.ts。
--
-- 所有时间戳都用 ISO 8601 字符串（TEXT）：人类可读、便于在 trace 工件中 diff。

PRAGMA foreign_keys = ON;

-------------------------------------------------------------------------------
-- customers（客户）
-- email 与 phone 是 PII，由 harness/policies/pii-fields.yaml 拦截。
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  email        TEXT    NOT NULL UNIQUE,         -- PII
  phone        TEXT    NOT NULL,                 -- PII
  created_at   TEXT    NOT NULL                  -- ISO 8601
);

-------------------------------------------------------------------------------
-- products（商品）
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  sku          TEXT    NOT NULL UNIQUE,
  price        REAL    NOT NULL CHECK (price >= 0),
  category     TEXT    NOT NULL
);

-------------------------------------------------------------------------------
-- orders（订单）
-- 该表的查询必须带 ordered_at 时间范围，由
-- harness/policies/require-time-bounds.yaml 强制。
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  status       TEXT    NOT NULL CHECK (status IN ('placed','shipped','delivered','completed','cancelled')),
  ordered_at   TEXT    NOT NULL,
  shipped_at   TEXT,
  total        REAL    NOT NULL CHECK (total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders(ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer   ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);

-------------------------------------------------------------------------------
-- order_items（订单行）
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   REAL    NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);

-------------------------------------------------------------------------------
-- inventory（库存）
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
  product_id   INTEGER PRIMARY KEY REFERENCES products(id),
  on_hand      INTEGER NOT NULL CHECK (on_hand >= 0),
  reserved     INTEGER NOT NULL CHECK (reserved >= 0),
  updated_at   TEXT    NOT NULL
);

-------------------------------------------------------------------------------
-- audit_log（审计日志）
-- append-only。仅由 src/pipeline/executor.ts 在「检查全过且已审批」之后写入。
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT    NOT NULL,
  action        TEXT    NOT NULL,
  target_table  TEXT    NOT NULL,
  target_id     TEXT,
  before_json   TEXT,
  after_json    TEXT,
  at            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_run    ON audit_log(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_table  ON audit_log(target_table);
CREATE INDEX IF NOT EXISTS idx_audit_at     ON audit_log(at);
