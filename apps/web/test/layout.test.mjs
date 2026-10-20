import { test } from "node:test"
import assert from "node:assert/strict"
import { horizontalTreemap } from "../src/lib/treemap-layout.ts"
test("treemap partitions preserve weighted areas without overlap", () => {
  const entries = Array.from({ length: 130 }, (_, i) => ({
    id: i,
    value: (i + 1) ** 2,
  }))
  const total = entries.reduce((s, e) => s + e.value, 0),
    bounds = { x: 7, y: 11, width: 1000, height: 650 }
  const result = horizontalTreemap(entries, bounds)
  assert.equal(result.length, entries.length)
  let area = 0
  for (const { entry, rect } of result) {
    area += rect.width * rect.height
    assert.ok(
      Math.abs(
        (rect.width * rect.height) / (1000 * 650) - entry.value / total
      ) < 1e-12
    )
    assert.ok(
      rect.x >= 7 &&
        rect.y >= 11 &&
        rect.x + rect.width <= 1007 + 1e-9 &&
        rect.y + rect.height <= 661 + 1e-9
    )
  }
  assert.ok(Math.abs(area - 650000) < 1e-6)
  for (let i = 0; i < result.length; i++)
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i].rect,
        b = result[j].rect
      assert.ok(
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) < 1e-8 ||
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) < 1e-8
      )
    }
})
test("treemap favors wide readable bands and ignores empty entries", () => {
  const result = horizontalTreemap([{ value: 5 }, { value: 5 }, { value: 0 }], {
    x: 0,
    y: 0,
    width: 800,
    height: 500,
  })
  assert.equal(result.length, 2)
  assert.equal(result[0].rect.width, 800)
  assert.equal(result[0].rect.height, 250)
})
