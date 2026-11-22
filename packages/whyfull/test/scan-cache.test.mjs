import test from "node:test"
import v8 from "node:v8"
import { syncBuiltinESMExports } from "node:module"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  statSync,
  readFileSync,
  readdirSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startViewer, loadDiskSnapshot } from "../dist/index.mjs"

async function fixture(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "whyfull-cache-test-"))
  )
  const root = join(directory, "drive"),
    other = join(directory, "other")
  mkdirSync(root)
  mkdirSync(other)
  // Enough work to observe and cancel a refresh before it finishes.
  for (let i = 0; i < 1000; i++) mkdirSync(join(root, `folder-${i}`))
  writeFileSync(join(root, "before"), "first report")
  const viewers = []
  t.after(async () => {
    for (const viewer of viewers) await viewer.close()
    rmSync(directory, { recursive: true, force: true })
  })
  async function launch(extra = {}) {
    const viewer = await startViewer({
      root,
      workers: 1,
      open: false,
      policyFile: join(directory, "config.json"),
      drives: () =>
        [root, other].map((id) => ({
          id,
          name: id,
          default: false,
          volume: null,
        })),
      ...extra,
    })
    viewers.push(viewer)
    const url = new URL(viewer.url)
    async function request(path, body) {
      const response = await fetch(`${url.origin}/api/${path}`, {
        headers: {
          Authorization: `Bearer ${url.hash.slice(1)}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) }),
      })
      const value = await response.json()
      assert.equal(response.status, 200, JSON.stringify(value))
      return value
    }
    async function wait(predicate) {
      for (let i = 0; i < 500; i++) {
        const status = await request("status")
        if (predicate(status)) return status
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.fail("scan did not settle")
    }
    return {
      viewer,
      request,
      wait,
      async close() {
        viewers.splice(viewers.indexOf(viewer), 1)
        await viewer.close()
      },
    }
  }
  return { root, other, directory, launch }
}

test("completed scans survive restart, refresh without changing the displayed inventory, and swap once complete", async (t) => {
  const { root, launch } = await fixture(t)
  const first = await launch()
  const saved = await first.wait((s) => !!s.savedPath)
  assert.equal((await loadDiskSnapshot(saved.savedPath)).files, 1)
  if (process.platform !== "win32")
    assert.equal(statSync(saved.savedPath).mode & 0o777, 0o600)
  await first.close()
  writeFileSync(join(root, "folder-0", "after"), "second report")
  const second = await launch()
  const oldInventory = second.viewer.snapshot
  assert.equal(oldInventory.status, "complete")
  assert.equal(oldInventory.files, 1)
  assert.equal(
    oldInventory.durationMs,
    saved.durationMs,
    "completed scan duration survives restart"
  )
  const initial = await second.request("status")
  assert.equal(initial.cache.restored, true)
  assert.equal(initial.cache.refreshing, true)
  assert.equal(initial.progress.estimateBasis, "history")
  assert.ok(initial.progress.percent >= 0 && initial.progress.percent < 100)
  const drive = (await second.request("drives")).find((d) => d.id === root)
  assert.equal(drive.scan.progress.estimateBasis, "history")
  assert.equal(drive.scan.lastCompletedAt, saved.completedAt)
  assert.equal(drive.scan.lastDurationMs, saved.durationMs)
  assert.equal(drive.scan.canCancel, true)
  assert.ok(
    drive.scan.progress.percent >= 0 && drive.scan.progress.percent < 100
  )
  assert.equal(
    initial.durationMs,
    saved.durationMs,
    "refresh keeps the previous duration as its baseline"
  )
  assert.equal((await second.request("directory")).node.files, 1)
  const folderQuery = `directory?path=${encodeURIComponent(join(root, "folder-0"))}`
  assert.equal(
    (await second.request(folderQuery)).node.files,
    0,
    "nested folders remain browsable with saved sizes during refresh"
  )
  const refreshed = await second.wait(
    (s) => !s.cache.refreshing && s.revision === 1 && !!s.savedPath
  )
  assert.equal(refreshed.documentId, initial.documentId)
  assert.equal(refreshed.files, 2)
  assert.equal(
    oldInventory.files,
    1,
    "old tree is never mutated during refresh"
  )
  assert.equal((await loadDiskSnapshot(refreshed.savedPath)).files, 2)
  assert.equal((await second.request("directory")).node.files, 2)
  assert.equal(
    (await second.request(folderQuery)).node.files,
    1,
    "the same folder path resolves to updated sizes after refresh"
  )
  await second.close()
  const third = await launch()
  assert.equal(third.viewer.snapshot.files, 2)
})

test("cancelled refresh retains the good cache; explicit rescan also keeps the map available", async (t) => {
  const { root, other, launch } = await fixture(t)
  const first = await launch()
  const saved = await first.wait((s) => !!s.savedPath)
  const originalFile = readFileSync(saved.savedPath, "utf8")
  await first.close()
  writeFileSync(join(root, "later"), "new")
  const second = await launch()
  await second.request("cancel", {})
  const stopped = await second.wait((s) => !s.cache.refreshing)
  assert.equal(stopped.status, "complete")
  assert.equal(stopped.files, 1)
  assert.equal(stopped.revision, 0)
  assert.equal(
    stopped.progress,
    null,
    "stopped refresh releases its partial tree"
  )
  assert.equal(readFileSync(saved.savedPath, "utf8"), originalFile)
  const refreshing = await second.request("rescan", {})
  assert.equal(refreshing.files, 1)
  assert.equal(refreshing.cache.refreshing, true)
  await second.request("scan-root", { root: other })
  await second.wait((s) => !!s.savedPath)
  await second.request("scan-root", { root })
  const complete = await second.wait(
    (s) => !s.cache.refreshing && s.revision === 1
  )
  assert.equal(
    complete.files,
    2,
    "refresh completes even while another drive is visible"
  )
})

test("incompatible settings and corrupt cache fall back to live scans", async (t) => {
  const { root, directory, launch } = await fixture(t)
  const first = await launch()
  const saved = await first.wait((s) => !!s.savedPath)
  await first.close()
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({ keep: [], exclude: [join(root, "folder-0")] })
  )
  const changed = await launch()
  assert.equal(changed.viewer.snapshot.status, "scanning")
  assert.equal(changed.viewer.snapshot.files, 0)
  await changed.close()
  writeFileSync(saved.savedPath, "broken JSON")
  const corrupt = await launch()
  assert.equal(corrupt.viewer.snapshot.status, "scanning")
  const complete = await corrupt.wait((s) => !!s.savedPath)
  assert.equal(complete.status, "complete")
  assert.equal(
    readdirSync(join(directory, "scans")).filter((f) => f.endsWith(".tmp"))
      .length,
    0
  )
})

test("SQLite refresh completes without depending on a large JavaScript inventory heap", async (t) => {
  const { root, launch } = await fixture(t)
  const first = await launch()
  const saved = await first.wait((s) => !!s.savedPath)
  const original = readFileSync(saved.savedPath, "utf8")
  await first.close()
  writeFileSync(join(root, "later"), "new")
  const statistics = v8.getHeapStatistics
  t.mock.method(v8, "getHeapStatistics", () => ({
    ...statistics(),
    used_heap_size: 90,
    heap_size_limit: 100,
  }))
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  })
  const second = await launch()
  const complete = await second.wait(
    (s) => !s.cache.refreshing && !!s.savedPath
  )
  assert.equal(complete.status, "complete")
  assert.equal(complete.files, 2)
  assert.equal(complete.saveError, null)
  assert.notEqual(readFileSync(saved.savedPath, "utf8"), original)
})

test("cache:false skips disk cache restoration and writes without removing the previous good cache", async (t) => {
  const { root, launch } = await fixture(t)
  const first = await launch()
  const saved = await first.wait((s) => !!s.savedPath)
  const original = readFileSync(saved.savedPath, "utf8")
  await first.close()
  writeFileSync(join(root, "after"), "fresh data")
  const fresh = await launch({ cache: false })
  assert.equal(fresh.viewer.snapshot.files, 0)
  const complete = await fresh.wait((s) => s.status === "complete")
  assert.equal(complete.files, 2)
  assert.equal(complete.cache.restored, false)
  assert.equal(complete.savedPath, null)
  assert.equal(readFileSync(saved.savedPath, "utf8"), original)
})
