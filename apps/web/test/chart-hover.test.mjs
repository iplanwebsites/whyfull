import assert from "node:assert/strict"
import test from "node:test"
import { isHoveredEntry } from "../src/lib/chart-hover.ts"

const folder = (id, path) => ({
  id,
  path,
  name: id,
  kind: "directory",
  value: 1,
})

test("hover links a branch in both directions across macOS path aliases", () => {
  const parent = folder("d1", "/System/Volumes/Data/Users/felix/Photos")
  const child = folder("d2", "/Users/felix/Photos/Peru")
  assert.equal(isHoveredEntry(parent, child), true)
  assert.equal(isHoveredEntry(child, parent), true)
  assert.equal(
    isHoveredEntry(parent, folder("d3", "/Users/felix/Photos-old")),
    false
  )
  assert.equal(
    isHoveredEntry(parent, folder("d4", "/Users/felix/Music")),
    false
  )
})

test("hover handles pathless aggregates and no active hover", () => {
  const group = { id: "other", name: "Files", kind: "remainder", value: 1 }
  assert.equal(isHoveredEntry(group, { ...group }), true)
  assert.equal(isHoveredEntry(group, { ...group, id: "different" }), false)
  assert.equal(isHoveredEntry(group, null), false)
})
