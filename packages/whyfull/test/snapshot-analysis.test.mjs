import test from "node:test"
import assert from "node:assert/strict"
import { analyzeSnapshot, validateViewerReport } from "../dist/index.mjs"

function tree(root = "/no-longer-mounted/home") {
  const snapshot = {
    format: "whyfull-disk",
    schemaVersion: 1,
    root,
    startedAt: "2026-10-24T10:00:00Z",
    completedAt: "2026-10-24T10:01:00Z",
    durationMs: 60000,
    status: "complete",
    workers: 1,
    engine: "sync",
    files: 4,
    skippedLinks: 0,
    issues: 0,
    policy: { keep: [], exclude: [] },
    directories: [],
  }
  function add(path, parent, bytes, extra = {}) {
    const id = snapshot.directories.length
    const node = {
      id,
      parent,
      path,
      name: path.split(/[\\/]/).pop(),
      children: [],
      topFiles: [],
      ownBytes: bytes,
      ownApparentBytes: bytes * 2,
      ownFiles: 1,
      bytes,
      apparentBytes: bytes * 2,
      files: 1,
      directories: 0,
      issues: 0,
      excluded: 0,
      state: "scanned",
      ...extra,
    }
    snapshot.directories.push(node)
    if (parent !== null) snapshot.directories[parent].children.push(id)
    return node
  }
  add(root, null, 8000)
  return { snapshot, add }
}
function definition(path, extra = {}) {
  return {
    id: "test-cache",
    label: "Test cache",
    group: "Packages",
    tier: "AUTO",
    hint: "Review this cache",
    paths: { darwin: [], linux: [], win32: [] },
    candidates: [path],
    ...extra,
  }
}

test("snapshot analysis reuses allocated sizes and child facts without accessing recorded paths", () => {
  const { snapshot, add } = tree()
  const cache = add(`${snapshot.root}/cache`, 0, 6500)
  add(`${cache.path}/old`, cache.id, 5000)
  add(`${cache.path}/new`, cache.id, 1500)
  const before = JSON.stringify(snapshot)
  const report = analyzeSnapshot(
    snapshot,
    [definition(cache.path), definition("/outside", { id: "outside" })],
    { platform: "linux", top: 1 }
  )
  assert.equal(report.targets[0].bytes, 6500)
  assert.equal(report.targets[0].children[0].bytes, 5000)
  assert.equal(report.targets[0].children[0].atimeMs, -1)
  assert.equal(report.targets[0].children.length, 1)
  assert.equal(report.targets[1].present, false)
  assert.equal(report.targets[1].bytes, null)
  assert.equal(report.generatedAt, snapshot.completedAt)
  assert.equal(report.completedAt, snapshot.completedAt)
  assert.equal(report.inventory.root, snapshot.root)
  assert.match(
    report.inventory.limitations.join(" "),
    /no additional filesystem scan/
  )
  assert.equal(
    JSON.stringify(snapshot),
    before,
    "analysis must not mutate its inventory"
  )
  assert.equal(validateViewerReport(report), report)
})

test("unfinished inventories cannot produce recommendations", () => {
  for (const status of ["scanning", "cancelled", "failed"]) {
    const { snapshot } = tree()
    snapshot.status = status
    assert.throws(() => analyzeSnapshot(snapshot, []), /Complete the disk scan/)
  }
})

test("excluded and unreadable descendants preserve lower bounds and unknown sizes", () => {
  const { snapshot, add } = tree()
  const cache = add(`${snapshot.root}/cache`, 0, 5000)
  add(`${cache.path}/excluded`, cache.id, 0, { state: "excluded", excluded: 1 })
  const denied = add(`${snapshot.root}/denied`, 0, 0, {
    state: "unreadable",
    issues: 1,
  })
  const report = analyzeSnapshot(snapshot, [
    definition(cache.path),
    definition(denied.path, { id: "denied" }),
    definition(`${cache.path}/excluded`, { id: "excluded" }),
  ])
  assert.equal(report.targets[0].partial, true)
  assert.equal(report.targets[0].detailMeasurementsPartial, true)
  assert.equal(report.targets[1].bytes, null)
  assert.equal(report.targets[1].denied, true)
  assert.equal(report.targets[2].present, false)
  assert.equal(report.exact, false)
})

test("matching handles macOS Data aliases and Windows case without resolving filesystem paths", () => {
  const mac = tree("/System/Volumes/Data/Users/test")
  const cache = mac.add(`${mac.snapshot.root}/cache`, 0, 123)
  assert.equal(
    analyzeSnapshot(mac.snapshot, [definition("/Users/test/cache")], {
      platform: "darwin",
    }).targets[0].path,
    cache.path
  )
  const windows = tree("C:\\Users\\test")
  windows.add("C:\\Users\\test\\Cache", 0, 456)
  assert.equal(
    analyzeSnapshot(windows.snapshot, [definition("c:\\users\\TEST\\cache")], {
      platform: "win32",
    }).targets[0].bytes,
    456
  )
})

test("untracked caches and possible worktree folders carry review advice without invented Git metadata", () => {
  const { snapshot, add } = tree()
  const cache = add(`${snapshot.root}/.cache`, 0, 4000)
  add(`${cache.path}/unknown-app`, cache.id, 4000)
  const worktrees = add(`${snapshot.root}/.worktrees`, 0, 3000)
  add(`${worktrees.path}/old`, worktrees.id, 3000)
  const report = analyzeSnapshot(snapshot, [])
  assert.ok(
    report.targets.some(
      (item) => item.group === "Untracked caches" && item.bytes === 4000
    )
  )
  const worktree = report.targets.find((item) => item.group === "Worktrees")
  assert.match(worktree.hint, /Verify Git registration/)
  assert.equal(worktree.recommendation, undefined)
  assert.equal(report.worktrees, undefined)
  assert.equal(report.options.worktrees, false)
})

test("large Turbo cache folders are flagged as rebuildable destinations", () => {
  const { snapshot, add } = tree()
  const project = add(`${snapshot.root}/project`, 0, 400e6)
  const turbo = add(`${project.path}/.turbo`, project.id, 400e6)
  const cache = add(`${turbo.path}/cache`, turbo.id, 400e6)
  const report = analyzeSnapshot(snapshot, [])
  const finding = report.targets.find((item) => item.path === cache.path)
  assert.equal(finding.group, "Build caches")
  assert.equal(finding.tier, "REBUILD")
  assert.match(finding.hint, /Turbo build cache/)
  assert.equal(
    report.targets.some((item) => item.path === turbo.path),
    false
  )
})

test("possible worktree folders remain visible inside a classified tool home", () => {
  const { snapshot, add } = tree()
  const tool = add(`${snapshot.root}/.codex`, 0, 3000)
  const worktrees = add(`${tool.path}/worktrees`, tool.id, 3000)
  add(`${worktrees.path}/bucket`, worktrees.id, 3000)
  const report = analyzeSnapshot(snapshot, [
    definition(tool.path, { id: "codex-home", tier: "APP" }),
  ])
  assert.ok(report.targets.some((item) => item.group === "Worktrees"))
})
