import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startViewer, scanFilesystem } from "../dist/index.mjs"

async function fixture(t, { directories = 0, saved = false, ...options } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-navigation-")))
  const a = join(root, "a"),
    b = join(root, "b"),
    child = join(a, "child")
  mkdirSync(child, { recursive: true })
  mkdirSync(b)
  for (let i = 0; i < directories; i++) mkdirSync(join(a, `folder-${i}`))
  writeFileSync(join(child, "first"), "first")
  writeFileSync(join(b, "second"), "second")
  const viewer = await startViewer({
    root: a,
    ...(saved
      ? { snapshot: await scanFilesystem({ root: a, workers: 1 }) }
      : {}),
    workers: 1,
    open: false,
    policyFile: join(root, "policy.json"),
    drives: () =>
      [a, b, child].map((id) => ({
        id,
        name: id,
        default: false,
        volume: null,
      })),
    ...options,
  })
  t.after(async () => {
    await viewer.close()
    rmSync(root, { recursive: true, force: true })
  })
  const url = new URL(viewer.url)
  const headers = {
    Authorization: `Bearer ${url.hash.slice(1)}`,
    "Content-Type": "application/json",
  }
  async function request(path, body) {
    const response = await fetch(`${url.origin}/api/${path}`, {
      headers,
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return result
  }
  async function complete() {
    for (let i = 0; i < 200; i++) {
      const status = await request("status")
      if (status.status !== "scanning" && !status.cache?.refreshing) {
        assert.equal(status.status, "complete")
        return status
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail("Scan did not finish")
  }
  return { viewer, root, a, b, child, request, complete, url, headers }
}

test("drive selection and nested destinations reuse results; only explicit rescan sees changes", async (t) => {
  const { a, b, child, request, complete } = await fixture(t)
  const original = await complete()
  writeFileSync(join(child, "added-later"), "new data")
  for (let i = 0; i < 2; i++) {
    const same = await request("scan-root", { root: a })
    assert.equal(same.documentId, original.documentId)
    assert.equal(same.startedAt, original.startedAt)
    assert.equal(same.files, 1)
  }
  const nested = await request("scan-root", { root: child })
  assert.equal(nested.documentId, original.documentId)
  assert.equal(nested.root, a)
  assert.equal(nested.navigation.path, child)
  const folder = await request(`directory?path=${encodeURIComponent(child)}`)
  assert.equal(folder.node.path, child)
  assert.equal(folder.crumbs[0].path, a)
  assert.equal(folder.node.files, 1)
  const switched = await request("scan-root", { root: b })
  assert.notEqual(switched.documentId, original.documentId)
  const other = await complete()
  const restored = await request("scan-root", { root: a })
  assert.equal(restored.documentId, original.documentId)
  assert.equal(restored.startedAt, original.startedAt)
  assert.equal(restored.status, "complete")
  assert.equal(
    restored.files,
    1,
    "returning restores cached data, without touching disk"
  )
  assert.equal(
    (await request("status")).progress,
    null,
    "inactive completed scanners release their memory"
  )
  assert.equal(
    (await request("scan-root", { root: b })).documentId,
    other.documentId
  )
  await request("open-scan", { documentId: original.documentId })
  assert.equal(
    (await request("status")).documentId,
    original.documentId,
    "browser history can restore a specific scan"
  )
  const fresh = await request("rescan", {})
  assert.equal(fresh.documentId, original.documentId)
  assert.equal(
    fresh.files,
    1,
    "rescan keeps the previous complete report visible"
  )
  const refreshed = await complete()
  assert.equal(refreshed.files, 2)
  assert.equal(refreshed.revision, original.revision + 1)
  assert.equal(
    (await request("scan-root", { root: b })).documentId,
    other.documentId,
    "rescan replaces only its own destination"
  )
})

test("switching and opening reports keep ongoing scans alive, including completion in the background", async (t) => {
  const { viewer, a, b, request, complete } = await fixture(t, {
    directories: 1000,
  })
  const firstSnapshot = viewer.snapshot
  const original = await request("status")
  assert.equal(original.status, "scanning")
  assert.ok(
    original.volume.total > 0,
    "capacity is available before scanning finishes"
  )
  assert.ok(original.volume.used >= 0)
  const initialDrive = (await request("drives")).find((drive) => drive.id === a)
  assert.equal(initialDrive.scan.documentId, original.documentId)
  assert.ok(initialDrive.scan.progress.elapsedMs >= 0)
  assert.ok(initialDrive.scan.progress.files >= 0)
  assert.ok(initialDrive.scan.progress.bytes >= 0)
  assert.ok(initialDrive.scan.progress.usedBytes > 0)
  assert.equal(typeof initialDrive.scan.progress.phase, "string")
  assert.ok("remainingMs" in initialDrive.scan.progress)
  await request("scan-root", { root: b })
  const backgroundDrive = (await request("drives")).find(
    (drive) => drive.id === a
  )
  assert.equal(backgroundDrive.scan.documentId, original.documentId)
  if (backgroundDrive.scan.status === "scanning") {
    assert.ok(
      backgroundDrive.scan.progress.elapsedMs >=
        initialDrive.scan.progress.elapsedMs
    )
    assert.ok(
      backgroundDrive.scan.progress.files >= initialDrive.scan.progress.files
    )
  } else assert.equal(backgroundDrive.scan.status, "complete")
  await complete()
  assert.notEqual(firstSnapshot.status, "cancelled")
  const running = await request("scan-root", { root: a })
  assert.equal(running.documentId, original.documentId)
  assert.equal(running.startedAt, original.startedAt)
  await request("scan-root", { root: b })
  for (let i = 0; firstSnapshot.status === "scanning" && i < 200; i++)
    await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(
    firstSnapshot.status,
    "complete",
    "switching away must never cancel a scan"
  )
  const restored = await request("scan-root", { root: a })
  assert.equal(restored.documentId, original.documentId)
  assert.equal(restored.startedAt, original.startedAt)
  assert.equal(restored.files, 1)
  const exported = await request("export")
  const imported = await request("import", exported)
  assert.equal((await request("status")).source.kind, "snapshot")
  assert.equal(
    (await request("scan-root", { root: a })).documentId,
    imported.documentId,
    "selecting the currently open snapshot never scans"
  )
  await request("scan-root", { root: b })
  await request("open-scan", { documentId: imported.documentId })
  assert.equal(
    (await request("status")).documentId,
    imported.documentId,
    "history restores an imported snapshot independently of a live scan of the same root"
  )
  await request("scan-root", { root: b })
  assert.equal(
    (await request("scan-root", { root: a })).documentId,
    original.documentId,
    "opening a report preserves the live inventory"
  )
})

test("unknown history entries fail without scanning or replacing the current inventory", async (t) => {
  const { request, complete, url, headers } = await fixture(t)
  const original = await complete()
  const response = await fetch(`${url.origin}/api/open-scan`, {
    method: "POST",
    headers,
    body: JSON.stringify({ documentId: "missing" }),
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /no longer available/)
  assert.equal((await request("status")).documentId, original.documentId)
})

test("an initially opened snapshot covers nested destinations and survives switching disks without rescanning", async (t) => {
  const { a, b, child, request, complete } = await fixture(t, { saved: true })
  const original = await request("status")
  assert.equal(original.source.kind, "snapshot")
  assert.equal(
    (await request("scan-root", { root: a })).documentId,
    original.documentId
  )
  const nested = await request("scan-root", { root: child })
  assert.equal(nested.documentId, original.documentId)
  assert.equal(nested.navigation.path, child)
  await request("scan-root", { root: b })
  await complete()
  const restored = await request("scan-root", { root: a })
  assert.equal(restored.documentId, original.documentId)
  assert.equal(restored.source.kind, "snapshot")
  assert.equal(restored.status, "complete")
  assert.equal(restored.startedAt, original.startedAt)
  await request("scan-root", { root: b })
  await request("open-scan", { documentId: original.documentId })
  assert.equal((await request("status")).documentId, original.documentId)
})

test("destination metadata follows the shared parent inventory instead of restoring an older folder scan", async (t) => {
  const { a, b, child, request, complete } = await fixture(t)
  const original = await complete()
  let destinations = await request("drives")
  assert.equal(destinations.find((d) => d.id === b).scan, null)
  assert.equal(
    destinations.find((d) => d.id === child).scan.documentId,
    original.documentId
  )
  assert.equal(destinations.find((d) => d.id === child).scan.status, "complete")
  const nested = await request("scan-folder", { id: "d1" })
  await complete()
  assert.notEqual(nested.documentId, original.documentId)
  await request("scan-root", { root: a })
  const parentSnapshot = await request("status")
  assert.equal(parentSnapshot.documentId, original.documentId)
  destinations = await request("drives")
  assert.equal(
    destinations.find((d) => d.id === child).scan.documentId,
    original.documentId
  )
  const selected = await request("scan-root", { root: child })
  assert.equal(selected.documentId, original.documentId)
  assert.equal(selected.navigation.path, child)
  assert.equal(
    selected.progress,
    null,
    "shared navigation keeps the restored inventory without starting a scanner"
  )
  assert.equal(
    (await request("status")).homeDestination.id,
    selected.homeDirectory
  )
  await request("scan-root", { root: b })
  await complete()
  destinations = await request("drives")
  assert.equal(
    destinations.find((d) => d.id === a).scan.status,
    "complete",
    "archived inventories retain their completion metadata"
  )
})

test("stopping a background drive targets its document without switching or cancelling the visible scan", async (t) => {
  const { viewer, a, b, request, url, headers } = await fixture(t, {
    directories: 5000,
  })
  const original = await request("status")
  const background = viewer.snapshot
  await request("scan-root", { root: b })
  const visible = await request("status")
  assert.equal(visible.root, b)
  const cancelled = await request("cancel", { documentId: original.documentId })
  assert.equal(cancelled.documentId, visible.documentId)
  assert.equal(cancelled.root, b)
  assert.notEqual(cancelled.status, "cancelled")
  assert.equal(background.status, "cancelled")
  const drive = (await request("drives")).find((d) => d.id === a)
  assert.equal(drive.scan.status, "cancelled")
  assert.equal(drive.scan.canCancel, false)
  const response = await fetch(`${url.origin}/api/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ documentId: "missing" }),
  })
  assert.equal(response.status, 400)
  assert.equal((await request("status")).documentId, visible.documentId)
  assert.notEqual((await request("status")).status, "cancelled")
})

test("suggestions follow completed inventories, reuse recorded sizes, and stay scoped while switching drives", async (t) => {
  const { a, b, child, request, complete } = await fixture(t)
  const original = await complete()
  const first = await request("analysis")
  assert.equal(first.source, "Completed disk inventory")
  assert.equal(first.report.inventory.root, a)
  assert.equal(first.report.generatedAt, original.completedAt)
  assert.equal(
    (await request("diagnostics")).runs.length,
    0,
    "automatic suggestions must not start a diagnostic subprocess"
  )
  writeFileSync(join(child, "added-after-scan"), "not in the inventory")
  const again = await request("analysis")
  assert.deepEqual(
    again.report,
    first.report,
    "suggestions never remeasure changed folders"
  )
  await request("scan-root", { root: b })
  await complete()
  assert.equal((await request("analysis")).report.inventory.root, b)
  await request("scan-root", { root: a })
  assert.deepEqual(
    (await request("analysis")).report,
    first.report,
    "restoring an inventory restores its own suggestions"
  )
})
