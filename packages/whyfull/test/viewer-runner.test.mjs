import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  rmSync,
  readFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  scanFilesystem,
  saveDiskSnapshot,
  loadViewerFile,
  validateViewerReport,
  listScanDrives,
  defaultScanRoot,
  startViewer,
  buildJsonReport,
} from "../dist/index.mjs"
function reportFor(root) {
  return buildJsonReport({
    report: {
      platform: process.platform,
      volume: null,
      targets: [
        {
          id: "fixture",
          label: "Fixture cache",
          group: "tests",
          tier: "REBUILD",
          hint: "Rebuild this test cache if needed.",
          path: root,
          bytes: 4096,
          present: true,
          children: [
            {
              name: "child",
              path: join(root, "child"),
              bytes: 4096,
              atimeMs: 0,
            },
          ],
          candidates: [root],
          paths: { darwin: [root], linux: [root], win32: [root] },
        },
      ],
      denied: 0,
      partial: 0,
      exact: true,
      total: 4096,
      generatedAt: new Date().toISOString(),
    },
    options: {},
    durationMs: 1,
  })
}
const fixture = () =>
  realpathSync(mkdtempSync(join(tmpdir(), "whyfull-runner-test-")))
test("viewer file loader accepts both generated report formats and rejects invalid reports", async () => {
  const root = fixture()
  try {
    mkdirSync(join(root, "child"))
    writeFileSync(join(root, "child", "data"), "sample")
    const snapshot = await scanFilesystem({ root, workers: 1 }),
      disk = join(root, "disk.json")
    await saveDiskSnapshot(snapshot, disk)
    assert.deepEqual((await loadViewerFile(disk)).snapshot, snapshot)
    const report = reportFor(root),
      file = join(root, "report.json")
    writeFileSync(file, JSON.stringify(report))
    assert.deepEqual((await loadViewerFile(file)).report, report)
    assert.throws(
      () => validateViewerReport({ ...report, schemaVersion: 2 }),
      /supported/
    )
    assert.throws(
      () =>
        validateViewerReport({
          ...report,
          targets: [{ ...report.targets[0], bytes: -1 }],
        }),
      /Invalid/
    )
    writeFileSync(file, "not-json")
    await assert.rejects(loadViewerFile(file))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test("drive discovery lists the default volume without walking its files", () => {
  const drives = listScanDrives()
  assert.ok(drives.some((d) => d.id === defaultScanRoot() && d.default))
  assert.equal(new Set(drives.map((d) => d.id)).size, drives.length)
  assert.equal(drives[0].default, true)
})
test("runner imports reports atomically, exports original data, and scans selected drive roots in demo mode", async () => {
  const root = fixture(),
    other = fixture(),
    opened = []
  let viewer
  try {
    mkdirSync(join(root, "child"))
    writeFileSync(join(root, "child", "data"), "sample")
    writeFileSync(join(other, "other"), "other data")
    const snapshot = await scanFilesystem({ root, workers: 1 }),
      report = reportFor(root)
    viewer = await startViewer({
      root,
      open: false,
      workers: 1,
      snapshot,
      policyFile: join(root, "config.json"),
      allowTrash: true,
      finder: async (path) => opened.push(path),
      drives: () => [
        { id: root, name: "Data", default: true, volume: null },
        { id: other, name: "Other drive", default: false, volume: null },
      ],
    })
    const url = new URL(viewer.url),
      auth = { Authorization: `Bearer ${url.hash.slice(1)}` }
    const get = async (path) =>
      (await fetch(`${url.origin}/api/${path}`, { headers: auth })).json()
    const post = (path, body) =>
      fetch(`${url.origin}/api/${path}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    assert.equal((await get("drives"))[1].name, "Other drive")
    const original = await get("status")
    assert.equal(
      (await post("scan-root", { root: "/unlisted-root" })).status,
      400
    )
    const bad = await fetch(`${url.origin}/api/import`, {
      method: "POST",
      headers: auth,
      body: "{ invalid json",
    })
    assert.equal(bad.status, 400)
    assert.equal(
      (await get("status")).documentId,
      original.documentId,
      "invalid imports keep the current inventory"
    )
    const imported = await fetch(`${url.origin}/api/import`, {
      method: "POST",
      headers: {
        ...auth,
        "X-Whyfull-Name": encodeURIComponent("cache report.json"),
      },
      body: JSON.stringify(report),
    })
    assert.equal(imported.status, 200)
    const importedStatus = await imported.json()
    assert.equal(importedStatus.source.kind, "report")
    assert.equal(importedStatus.source.name, "cache report.json")
    assert.equal(importedStatus.cleanup.mode, "demo")
    assert.equal(importedStatus.cleanup.enabled, false)
    assert.deepEqual(await get("report"), report)
    assert.deepEqual(await get("export"), report)
    assert.equal((await post("report/finder", { path: root })).status, 200)
    assert.deepEqual(opened, [root])
    assert.equal((await post("report/finder", { path: other })).status, 400)
    assert.equal((await post("cleanup-mode", { mode: "trash" })).status, 400)
    const switched = await post("scan-root", { root: other })
    assert.equal(switched.status, 200)
    assert.equal((await switched.json()).snapshotMode, false)
    for (let i = 0; i < 100 && viewer.snapshot.status === "scanning"; i++)
      await new Promise((r) => setTimeout(r, 10))
    assert.equal(viewer.snapshot.root, other)
    assert.equal(viewer.snapshot.status, "complete")
    assert.equal(viewer.snapshot.files, 1)
    assert.equal((await get("status")).cleanup.mode, "demo")
    const disk = await fetch(`${url.origin}/api/import`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(snapshot),
    })
    assert.equal(disk.status, 200)
    assert.equal((await disk.json()).source.kind, "snapshot")
    assert.equal((await get("directory?id=0")).node.path, root)
    assert.equal(readFileSync(join(root, "child", "data"), "utf8"), "sample")
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }
})
