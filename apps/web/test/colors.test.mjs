import { test } from "node:test"
import assert from "node:assert/strict"
import {
  chartColors,
  colorFor,
  branchColor,
  childColor,
} from "../src/lib/chart-colors.ts"
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
function ancestry(root, path = []) {
  root.colorPath = path
  const ranked = [...(root.children ?? [])].sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name)
  )
  ranked.forEach((child, index) => ancestry(child, [...path, index]))
  return root
}
function distance(a, b) {
  const lab = ({ l, c, h }) => [
    l,
    c * Math.cos((h * Math.PI) / 180),
    c * Math.sin((h * Math.PI) / 180),
  ]
  const x = lab(a),
    y = lab(b)
  return Math.hypot(...x.map((v, i) => v - y[i]))
}
ancestry(root)
test("siblings branch perceptually while drill-down and sorting preserve directory colors", () => {
  const colors = chartColors(root)
  assert.notEqual(colors.get("first").fill, colors.get("second").fill)
  assert.notEqual(colors.get("first-a").fill, colors.get("first-b").fill)
  assert.notEqual(colors.get("first").fill, colors.get("first-a").fill)
  const drilled = chartColors(root.children[0])
  assert.deepEqual(drilled.get("first"), colors.get("first"))
  assert.deepEqual(drilled.get("first-a"), colors.get("first-a"))
  assert.deepEqual(
    colorFor(new Map(), root.children[0]),
    colors.get("first"),
    "off-chart list entries use the same ancestry"
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
      new Set(wide.children.slice(0, 6).map((n) => colors.get(n.id).fill)).size,
      6
    )
    assert.ok(
      new Set(wide.children.map((n) => colors.get(n.id).fill)).size >= 12
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

test("largest child is nearest its parent and depth alternates hue and tone strategies", () => {
  for (let depth = 1; depth <= 16; depth++) {
    const parent = branchColor(Array.from({ length: depth - 1 }, () => 0))
    const largest = childColor(parent, 0, depth)
    for (let rank = 1; rank <= 8; rank++)
      assert.ok(
        distance(parent, largest) <
          distance(parent, childColor(parent, rank, depth))
      )
    const sibling = childColor(parent, 1, depth)
    if (depth % 2 === 0)
      assert.ok(Math.abs(sibling.l - parent.l) > Math.abs(largest.l - parent.l))
    assert.ok(Number.isFinite(sibling.h) && sibling.c > 0)
  }
})

test("sibling separation survives lightness/chroma bounds at deep levels", () => {
  for (const l of [0.43, 0.64, 0.83])
    for (const c of [0.065, 0.19])
      for (const h of [20, 140, 250]) {
        const parent = { l, c, h }
        for (let depth = 1; depth <= 20; depth++)
          for (let rank = 1; rank <= 24; rank++) {
            assert.ok(
              distance(parent, childColor(parent, 0, depth)) <
                distance(parent, childColor(parent, rank, depth))
            )
          }
      }
})
