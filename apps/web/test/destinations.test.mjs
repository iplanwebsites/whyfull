import test from "node:test"
import assert from "node:assert/strict"
import {
  directoryLocation,
  diskUsage,
  isWithinDirectory,
} from "../src/lib/destinations.ts"

test("Home menu and breadcrumb aliases share a cached view independently of directory IDs", () => {
  assert.equal(
    directoryLocation("/Users/felix", 0),
    directoryLocation("/System/Volumes/Data/Users/felix", 521)
  )
  assert.notEqual(
    directoryLocation("/System/Volumes/Data", 0),
    directoryLocation("/", 0)
  )
  assert.notEqual(
    directoryLocation("/Users/felix"),
    directoryLocation("/Users/felix-old")
  )
  assert.equal(directoryLocation(undefined, 521), 521)
})

test("disk fullness uses system capacity and turns red at ninety percent", () => {
  assert.deepEqual(diskUsage({ used: 90, total: 100 }), {
    percent: 90,
    label: "90% full",
    full: true,
  })
  assert.equal(diskUsage({ used: 89, total: 100 }).full, false)
  assert.equal(diskUsage({ used: 99.8, total: 100 }).label, "99% full")
  assert.deepEqual(diskUsage({ used: 0, total: 100 }), {
    percent: 0,
    label: "0% full",
    full: false,
  })
  assert.equal(diskUsage({ used: 101, total: 100 }).percent, 100)
  for (const volume of [
    null,
    undefined,
    { used: 0, total: 0 },
    { used: NaN, total: 100 },
    { used: -1, total: 100 },
    { used: 1, total: Infinity },
  ])
    assert.equal(diskUsage(volume), null)
})

test("folder scope selects the project rather than Home and respects path boundaries", () => {
  assert.equal(
    isWithinDirectory("/Users/felix/project/build", "/Users/felix/project"),
    true
  )
  assert.equal(
    isWithinDirectory("/Users/felix/project-old", "/Users/felix/project"),
    false
  )
  assert.equal(
    isWithinDirectory(
      "/System/Volumes/Data/Users/felix/project",
      "/Users/felix/project"
    ),
    true
  )
  assert.equal(
    isWithinDirectory("C:\\work\\project\\build", "C:\\work\\project"),
    true
  )
  assert.equal(
    isWithinDirectory("C:\\work\\project-old", "C:\\work\\project"),
    false
  )
  assert.equal(isWithinDirectory("/project", "/"), true)
})
