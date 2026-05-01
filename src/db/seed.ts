/**
 * Deterministic seed for the demo SQLite database.
 *
 * Determinism guarantees (verified by tests/db/seed.test.ts):
 *   - Identical SEED_SALT → identical row counts, identical sums, identical
 *     min/max timestamps.
 *   - The output of `seed()` does NOT depend on wall-clock time. We anchor
 *     "now" to a fixed reference date so that demo runs against the seeded
 *     data are stable.
 *
 * Counts (per docs/roadmap.md M1):
 *   - 50  customers
 *   - 20  products  (4 categories × 5 each)
 *   - 200 orders    (spanning 6 months back from the reference date)
 *   - 500 order_items
 *   - 20  inventory rows (one per product)
 *   - 0   audit_log (populated at runtime by the executor)
 */

import { resetDb } from "./client.js"

/** Anchored "now" — keeps demo data stable across machines and clocks. */
export const REFERENCE_NOW = "2026-05-01T00:00:00.000Z"

/** Salt mixed into the PRNG seed. Bump to regenerate the canonical fixture. */
const SEED_SALT = 0x484e_5353 // ascii "HNSS"

const FIRST_NAMES = [
  "Anna", "Ben", "Cora", "Dan", "Eve", "Felix", "Grace", "Henry",
  "Ivy", "Jack", "Kate", "Leo", "Mia", "Noah", "Olive", "Paul",
  "Quinn", "Ruth", "Sam", "Tara", "Uma", "Vince", "Will", "Xena",
  "Yara", "Zane",
]
const LAST_NAMES = [
  "Adler", "Bishop", "Carter", "Dale", "Esposito", "Fox", "Gold",
  "Hayes", "Iverson", "Jensen", "Kim", "Lopez", "Moore", "Nakamura",
  "O'Brien", "Park", "Quinn", "Reyes", "Singh", "Tanaka",
]

const PRODUCT_CATEGORIES = [
  {
    name: "Electronics",
    items: ["Headphones", "Webcam", "USB-C Hub", "Mech Keyboard", "Trackpad"],
    priceRange: [29, 199] as const,
  },
  {
    name: "Apparel",
    items: ["Tee", "Hoodie", "Cap", "Socks", "Jacket"],
    priceRange: [12, 89] as const,
  },
  {
    name: "Books",
    items: ["Designing Data-Intensive Apps", "The Pragmatic Programmer",
      "Refactoring", "Domain-Driven Design", "Working Effectively with Legacy Code"],
    priceRange: [25, 65] as const,
  },
  {
    name: "Food",
    items: ["Coffee Beans", "Dark Chocolate", "Tea Set", "Granola", "Olive Oil"],
    priceRange: [8, 49] as const,
  },
]

const ORDER_STATUSES = ["placed", "shipped", "delivered", "completed", "cancelled"] as const

interface SeedSummary {
  customers: number
  products: number
  orders: number
  orderItems: number
  inventory: number
  earliestOrderedAt: string
  latestOrderedAt: string
  totalRevenue: number
}

/**
 * Wipe and re-populate the business database. Returns a summary that's used by
 * tests to assert determinism.
 */
export function seed(): SeedSummary {
  const db = resetDb()
  const rng = mulberry32(SEED_SALT)

  // ---------- customers ----------
  const insertCustomer = db.prepare(
    "INSERT INTO customers (id, name, email, phone, created_at) VALUES (?, ?, ?, ?, ?)",
  )
  const customerCount = 50
  const insertCustomers = db.transaction(() => {
    for (let id = 1; id <= customerCount; id++) {
      const first = pick(rng, FIRST_NAMES)
      const last = pick(rng, LAST_NAMES)
      const name = `${first} ${last}`
      const email = `${first.toLowerCase()}.${last.toLowerCase().replace(/['']/g, "")}+${id}@example.com`
      const phone = `+1-555-${pad(rngInt(rng, 0, 999), 3)}-${pad(rngInt(rng, 0, 9999), 4)}`
      const createdAt = isoDaysBefore(REFERENCE_NOW, rngInt(rng, 30, 365))
      insertCustomer.run(id, name, email, phone, createdAt)
    }
  })
  insertCustomers()

  // ---------- products ----------
  const insertProduct = db.prepare(
    "INSERT INTO products (id, name, sku, price, category) VALUES (?, ?, ?, ?, ?)",
  )
  const insertInventory = db.prepare(
    "INSERT INTO inventory (product_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, ?)",
  )

  type ProductRow = { id: number; price: number }
  const products: ProductRow[] = []

  const insertProducts = db.transaction(() => {
    let id = 1
    for (const category of PRODUCT_CATEGORIES) {
      for (const item of category.items) {
        const [low, high] = category.priceRange
        const price = round2(low + rng() * (high - low))
        const sku = `${category.name.slice(0, 3).toUpperCase()}-${pad(id, 4)}`
        insertProduct.run(id, item, sku, price, category.name)
        insertInventory.run(
          id,
          rngInt(rng, 0, 500),
          rngInt(rng, 0, 50),
          REFERENCE_NOW,
        )
        products.push({ id, price })
        id++
      }
    }
  })
  insertProducts()

  // ---------- orders + order_items ----------
  const insertOrder = db.prepare(
    "INSERT INTO orders (id, customer_id, status, ordered_at, shipped_at, total) VALUES (?, ?, ?, ?, ?, ?)",
  )
  const insertItem = db.prepare(
    "INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
  )

  const orderCount = 200
  const targetItemCount = 500

  // Pre-assign each order an item count so the total is exactly targetItemCount.
  // Each order gets 1..5 items; we draw and then trim/extend to hit the target.
  const itemCounts: number[] = []
  for (let i = 0; i < orderCount; i++) itemCounts.push(rngInt(rng, 1, 5))
  let total = itemCounts.reduce((a, b) => a + b, 0)
  // Adjust to exactly targetItemCount.
  while (total !== targetItemCount) {
    const idx = rngInt(rng, 0, orderCount - 1)
    if (total < targetItemCount && itemCounts[idx]! < 8) {
      itemCounts[idx]!++
      total++
    } else if (total > targetItemCount && itemCounts[idx]! > 1) {
      itemCounts[idx]!--
      total--
    }
  }

  let earliestOrdered = "9999-12-31T00:00:00.000Z"
  let latestOrdered = "0000-01-01T00:00:00.000Z"
  let revenue = 0
  let nextItemId = 1

  const insertAll = db.transaction(() => {
    for (let oid = 1; oid <= orderCount; oid++) {
      const customerId = rngInt(rng, 1, customerCount)
      const ordered = isoDaysBefore(REFERENCE_NOW, rngInt(rng, 0, 180))
      if (ordered < earliestOrdered) earliestOrdered = ordered
      if (ordered > latestOrdered) latestOrdered = ordered

      const status = ORDER_STATUSES[rngInt(rng, 0, ORDER_STATUSES.length - 1)]!
      const shipped =
        status === "placed" || status === "cancelled"
          ? null
          : isoDaysAfter(ordered, rngInt(rng, 1, 5))

      const lineCount = itemCounts[oid - 1]!
      let orderTotal = 0
      const lines: Array<{ pid: number; qty: number; unit: number }> = []
      for (let li = 0; li < lineCount; li++) {
        const product = products[rngInt(rng, 0, products.length - 1)]!
        const qty = rngInt(rng, 1, 4)
        lines.push({ pid: product.id, qty, unit: product.price })
        orderTotal += qty * product.price
      }
      orderTotal = round2(orderTotal)
      revenue += orderTotal

      insertOrder.run(oid, customerId, status, ordered, shipped, orderTotal)
      for (const line of lines) {
        insertItem.run(nextItemId++, oid, line.pid, line.qty, line.unit)
      }
    }
  })
  insertAll()

  return {
    customers: customerCount,
    products: products.length,
    orders: orderCount,
    orderItems: targetItemCount,
    inventory: products.length,
    earliestOrderedAt: earliestOrdered,
    latestOrderedAt: latestOrdered,
    totalRevenue: round2(revenue),
  }
}

// ---------- helpers ----------

/** Mulberry32: tiny, fast, deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b_79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rngInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[rngInt(rng, 0, arr.length - 1)]!
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0")
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isoDaysBefore(refIso: string, days: number): string {
  const d = new Date(refIso)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

function isoDaysAfter(refIso: string, days: number): string {
  const d = new Date(refIso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}
