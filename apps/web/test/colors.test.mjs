import { test } from "node:test"
import assert from "node:assert/strict"
import { chartColors, colorFor } from "../src/lib/chart-colors.ts"
const node = (id, value, children = []) => ({
  id,
  name: id,
  value,
  kind: "directory",
  children,
})
const root = node("root", 100, [
  node("first", 60, [
    node("first-a", 40, [node("first-a-a", 20)]),
    node("first-b", 20),
  ]),
  node("second", 40, [node("second-a", 40)]),
])
function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function hue(hex) {
  const [r, g, b] = rgb(hex),
    hi = Math.max(r, g, b),
    lo = Math.min(r, g, b),
    d = hi - lo
  return (
    ((hi === r ? (g - b) / d : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) *
      60 +
      360) %
    360
  )
}
test("siblings have distinct colors, descendants keep the branch hue, and sorting does not recolor entries", () => {
  const colors = chartColors(root)
  assert.notEqual(colors.get("first").fill, colors.get("second").fill)
  assert.notEqual(colors.get("first-a").fill, colors.get("first-b").fill)
  assert.notEqual(colors.get("first").fill, colors.get("first-a").fill)
  assert.ok(
    Math.abs(hue(colors.get("first").fill) - hue(colors.get("first-a").fill)) <
      2
  )
  assert.deepEqual(
    [...chartColors({ ...root, children: [...root.children].reverse() })],
    [...colors]
  )
  assert.equal(colorFor(colors, root.children[0]), colors.get("first"))
})
test("both themes keep opaque branch fills, tinted separators, and at least 4.5:1 text contrast", () => {
  const wide = node(
    "root",
    500,
    Array.from({ length: 48 }, (_, i) =>
      node(
        "branch" + i,
        100 - i,
        Array.from({ length: 8 }, (_, j) =>
          node(`child${i}-${j}`, 10 - j, [node(`leaf${i}-${j}`, 1)])
        )
      )
    )
  )
  for (const dark of [false, true]) {
    const colors = chartColors(wide, dark)
    assert.equal(
      new Set(wide.children.map((n) => colors.get(n.id).fill)).size,
      48
    )
    for (const { fill, stroke, text } of colors.values()) {
      assert.notEqual(stroke, "#ffffff")
      assert.notEqual(stroke, fill)
      const a = luminance(fill),
        b = luminance(text)
      assert.ok(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
        `${fill} / ${text}`
      )
    }
  }
  assert.notEqual(
    chartColors(root, true).get("first").fill,
    chartColors(root, false).get("first").fill
  )
})
