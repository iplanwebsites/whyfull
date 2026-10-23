import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverCaches, findWorktrees } from "../dist/index.mjs"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "whyfull-storage-"))
  t.after(() => {
    if (process.platform === "darwin") execFileSync("/usr/bin/trash", [root])
  })
  return root
}

function payload(path) {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "artifact"), Buffer.alloc(65536, 1))
}

test("project scan finds Turbo and ScriptC including nested Zig, without splitting hashes", (t) => {
  const root = fixture(t)
  const repo = join(root, "group", "app")
  payload(join(repo, ".turbo", "cache"))
  payload(join(repo, ".scriptc-cache-v1", "zig"))
  payload(join(repo, ".scriptc-cache-v1", "ab", "hash"))
  payload(join(repo, ".cache", "release-checks"))
  payload(join(repo, "node_modules", "dependency", ".turbo"))
  payload(join(repo, "build", ".scriptc-cache-v1"))
  payload(join(repo, ".artifacts", "precious-evidence"))
  const result = discoverCaches({
    roots: [],
    projectRoots: [{ path: root, label: "Project cache" }],
    threshold: 1,
    drill: 0,
  })
  assert.deepEqual(
    result.dirs.map((entry) => entry.path).sort(),
    [
      join(repo, ".turbo"),
      join(repo, ".scriptc-cache-v1"),
      join(repo, ".cache", "release-checks"),
    ].sort()
  )
  assert.ok(
    result.dirs.find((entry) => entry.name === ".scriptc-cache-v1").bytes >=
      131072
  )
})

test("cache roots are deduplicated, thresholds respected and symlinks excluded", (t) => {
  const root = fixture(t)
  payload(join(root, ".turbo", "cache"))
  const outside = join(root, "outside")
  payload(outside)
  symlinkSync(outside, join(root, ".scriptc-cache-v1"), "dir")
  const options = {
    roots: [],
    projectRoots: [
      { path: root, label: "Project" },
      { path: root, label: "Duplicate" },
    ],
    threshold: 1,
    drill: 0,
  }
  assert.deepEqual(
    discoverCaches(options).dirs.map((entry) => entry.name),
    [".turbo"]
  )
  assert.equal(discoverCaches({ ...options, threshold: 1e9 }).dirs.length, 0)
})

test("Codex production worktrees and missing temporary registrations are found from main repo", (t) => {
  const root = fixture(t)
  const main = join(root, "web", "git", "maru", "workspace")
  const admin = join(main, ".git", "worktrees")
  for (const [name, present] of [
    ["production-current", true],
    ["production-redeploy", true],
    ["missing-tmp", false],
  ]) {
    const entry = join(admin, name)
    const checkout = present
      ? join(root, ".codex", "worktrees", name, "workspace")
      : join(root, "tmp", "scratchpad", "wt")
    mkdirSync(entry, { recursive: true })
    writeFileSync(join(entry, "gitdir"), `${join(checkout, ".git")}\n`)
    writeFileSync(join(entry, "HEAD"), `${"a".repeat(40)}\n`)
    if (present) {
      payload(checkout)
      writeFileSync(join(checkout, ".git"), `gitdir: ${entry}\n`)
    }
  }
  const result = findWorktrees({ roots: [main], includeDefaults: false })
  const entries = result.clusters.flatMap((cluster) => cluster.worktrees)
  assert.equal(entries.length, 3)
  assert.equal(
    entries.find((entry) => entry.name === "missing-tmp").state,
    "stale"
  )
  for (const entry of entries.filter((entry) => entry.state === "linked")) {
    assert.equal(entry.tool, "codex")
    assert.equal(entry.detached, true)
    assert.equal(entry.recommendation.command, null)
    assert.match(entry.recommendation.summary, /preserve any commits/)
    assert.ok(entry.bytes >= 65536)
  }
})
