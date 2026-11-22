import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  truncateSync,
  linkSync,
  rmSync,
  realpathSync,
  readFileSync,
  statSync,
  chmodSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setTimeout } from "node:timers/promises"
import {
  scanFilesystem,
  saveDiskSnapshot,
  loadDiskSnapshot,
  startViewer,
  ScanCache,
  rustScannerAvailability,
  releaseDiskSnapshot,
} from "../dist/index.mjs"

const available = rustScannerAvailability().available
function fixture() {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "whyfull rust ")))
  const root = join(work, "root")
  for (const name of [
    "",
    "nested",
    "empty",
    "skip",
    "skip-sibling",
    ".whyfull",
  ])
    mkdirSync(join(root, name), { recursive: true })
  for (const name of [
    "nested/data",
    "skip/data",
    "skip-sibling/data",
    ".whyfull/data",
  ])
    writeFileSync(join(root, name), Buffer.alloc(8192, 1))
  writeFileSync(join(root, "sparse"), Buffer.alloc(4096))
  truncateSync(join(root, "sparse"), 64 * 1024 ** 2)
  linkSync(join(root, "nested/data"), join(root, "link"))
  return {
    work,
    root,
    rustDirectory: join(work, ".whyfull", "working"),
    policyFile: join(work, "settings/config.json"),
  }
}

test(
  "failed experimental refresh keeps the Node map and allows switching back",
  { skip: Number(process.versions.node.split(".")[0]) < 22 },
  async () => {
    const f = fixture()
    const helper = join(f.work, "failed-crawler")
    writeFileSync(helper, "#!/bin/sh\nexit 7\n")
    chmodSync(helper, 0o700)
    let client
    try {
      client = await connection({
        root: f.root,
        policyFile: f.policyFile,
        rustDirectory: f.rustDirectory,
        rustBinary: helper,
      })
      const before = await client.complete()
      const cached = readFileSync(before.savedPath)
      await client.api("preferences", { scanner: "rust" })
      await client.api("rescan", {})
      let status
      for (let attempt = 0; attempt < 100; attempt++) {
        status = await client.api("status")
        if (!status.cache?.refreshing && status.saveError) break
        await setTimeout(20)
      }
      assert.match(status.saveError, /Rust scanner exited/)
      assert.equal(status.status, "complete")
      assert.equal(status.documentId, before.documentId)
      assert.equal(status.scanners.active, "node")
      assert.equal(status.files, before.files)
      assert.deepEqual(readFileSync(before.savedPath), cached)
      assert.ok((await client.api("directory")).entries.length)
      await client.api("preferences", { scanner: "node" })
      await client.api("rescan", {})
      assert.equal((await client.complete()).scanner, "node")
    } finally {
      await client?.viewer.close()
      rmSync(f.work, { recursive: true, force: true })
    }
  }
)

test(
  "Rust scanner preserves totals, tree navigation, sparse sizes and JSON exports",
  { skip: !available },
  async () => {
    const f = fixture()
    let native
    try {
      const options = {
        root: f.root,
        policy: { keep: [], exclude: [join(f.root, "skip")] },
      }
      const node = await scanFilesystem({ ...options, workers: 1 })
      native = await scanFilesystem({
        ...options,
        scanner: "rust",
        rustDirectory: f.rustDirectory,
      })
      assert.equal(native.scanner, "rust")
      assert.equal(native.workers, 4)
      assert.equal(native.status, "complete")
      assert.equal(native.files, node.files)
      assert.equal(native.directories.length, node.directories.length)
      assert.equal(native.directories[0].bytes, node.directories[0].bytes)
      assert.equal(
        native.directories[0].apparentBytes,
        node.directories[0].apparentBytes
      )
      assert.equal(native.directories[0].excluded, 2)
      for (const dir of native.directories) {
        const expected = node.directories.find((n) => n.path === dir.path)
        assert.ok(expected)
        assert.equal(dir.files, expected.files)
        assert.equal(dir.directories, expected.directories)
        assert.equal(dir.ownFiles, expected.ownFiles)
        assert.ok(
          dir.children.every((id) => native.directories[id].parent === dir.id)
        )
      }
      const exported = join(f.work, "export.json")
      await saveDiskSnapshot(native, exported)
      const restored = await loadDiskSnapshot(exported)
      assert.equal(restored.scanner, "rust")
      assert.equal(restored.directories[0].bytes, native.directories[0].bytes)
      assert.equal(statSync(exported).mode & 0o777, 0o600)
    } finally {
      if (native) releaseDiskSnapshot(native)
      rmSync(f.work, { recursive: true, force: true })
    }
  }
)

test(
  "Node and Rust caches stay independent, validate settings and survive released sessions",
  { skip: !available },
  async () => {
    const f = fixture()
    const options = {
      root: f.root,
      scanner: "rust",
      rustDirectory: f.rustDirectory,
    }
    const cache = ScanCache.forDirectory(f.root)
    let native, restored
    try {
      const node = await scanFilesystem({ root: f.root, workers: 1 })
      const nodePath = await cache.save(node, { root: f.root })
      const before = readFileSync(nodePath)
      native = await scanFilesystem(options)
      const path = await cache.save(native, options)
      assert.match(path, /\.sqlite$/)
      assert.deepEqual(readFileSync(nodePath), before)
      releaseDiskSnapshot(native)
      native = undefined
      restored = await cache.load(f.root, options)
      assert.equal(restored.scanner, "rust")
      assert.equal(restored.directories[0].files, node.files)
      assert.equal((await cache.load(f.root, { root: f.root })).scanner, "node")
      assert.equal(await cache.load(f.root, { ...options, topFiles: 8 }), null)
    } finally {
      if (native) releaseDiskSnapshot(native)
      if (restored) releaseDiskSnapshot(restored)
      rmSync(f.work, { recursive: true, force: true })
    }
  }
)

async function connection(options) {
  const viewer = await startViewer({ ...options, open: false })
  const url = new URL(viewer.url)
  const request = async (path, body) => {
    const response = await fetch(url.origin + "/api/" + path, {
      headers: {
        Authorization: `Bearer ${url.hash.slice(1)}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    })
    const value = await response.json()
    return { response, value }
  }
  const api = async (path, body) => {
    const { response, value } = await request(path, body)
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }
  const complete = async () => {
    for (let i = 0; i < 200; i++) {
      const status = await api("status")
      if (
        status.status === "complete" &&
        !status.cache?.refreshing &&
        status.savedPath
      )
        return status
      if (status.status === "failed") assert.fail(status.saveError)
      await setTimeout(20)
    }
    assert.fail("Scan did not finish")
  }
  return { viewer, request, api, complete }
}

test(
  "toggle applies to the next scan; Rust supports paginated browsing, marks, analysis, export and a Node rescan",
  { skip: !available },
  async () => {
    const f = fixture()
    let client
    try {
      client = await connection({
        root: f.root,
        policyFile: f.policyFile,
        rustDirectory: f.rustDirectory,
        scanOnStart: false,
      })
      const before = await client.api("status")
      assert.equal(before.scanners.selected, "node")
      assert.equal(before.scanners.rust.available, true)
      await client.api("preferences", { scanner: "rust", minFileBytes: 0 })
      const selected = await client.api("status")
      assert.equal(selected.scanners.selected, "rust")
      assert.equal(selected.scanners.active, "node")
      assert.equal(selected.documentId, before.documentId)
      assert.equal(selected.awaitingScan, true)
      await client.api("rescan", {})
      const rust = await client.complete()
      assert.equal(rust.scanner, "rust")
      assert.equal(rust.scanners.active, "rust")
      const view = await client.api("directory")
      assert.ok(view.entries.some((n) => n.name === "nested"))
      assert.equal(
        view.chart.children.reduce((sum, n) => sum + n.value, 0),
        rust.bytes
      )
      const nested = await client.api(
        "directory?path=" + encodeURIComponent(join(f.root, "nested"))
      )
      assert.equal(nested.node.path, join(f.root, "nested"))
      assert.equal(nested.crumbs.length, 2)
      const filtered = await client.api("directory?q=nest&sort=name")
      assert.equal(filtered.total, 1)
      assert.equal(filtered.entries[0].name, "nested")
      await client.api("mark", { id: nested.node.id, mark: "useless" })
      const shortlist = await client.api("shortlist")
      assert.equal(shortlist[0].path, nested.node.path)
      const analysis = await client.api("analysis")
      assert.ok(analysis)
      const exported = await client.api("export")
      assert.equal(exported.scanner, "rust")
      assert.equal(exported.directories.length, rust.directories)
      await client.api("preferences", { scanner: "node" })
      const unchanged = await client.api("status")
      assert.equal(unchanged.scanners.active, "rust")
      assert.equal(unchanged.scanners.selected, "node")
      assert.equal(unchanged.documentId, rust.documentId)
      await client.api("rescan", {})
      const node = await client.complete()
      assert.equal(node.scanner, "node")
      assert.equal(node.files, rust.files)
      assert.equal(node.bytes, rust.bytes)
      assert.equal(
        JSON.parse(readFileSync(f.policyFile)).viewer.scanner,
        "node"
      )
    } finally {
      await client?.viewer.close()
      rmSync(f.work, { recursive: true, force: true })
    }
  }
)

test("an unavailable Rust helper does not replace Node or persist an unusable selection", async () => {
  const f = fixture()
  let client
  try {
    client = await connection({
      root: f.root,
      policyFile: f.policyFile,
      scanOnStart: false,
      rustBinary: join(f.work, "missing"),
    })
    const status = await client.api("status")
    assert.equal(status.scanners.selected, "node")
    assert.equal(status.scanners.rust.available, false)
    const rejected = await client.request("preferences", { scanner: "rust" })
    assert.equal(rejected.response.status, 400)
    assert.equal((await client.api("status")).scanners.selected, "node")
  } finally {
    await client?.viewer.close()
    rmSync(f.work, { recursive: true, force: true })
  }
})

test(
  "cancelled and failed Rust replacements preserve the last completed cache",
  { skip: !available },
  async () => {
    const f = fixture()
    let native
    try {
      const cache = ScanCache.forDirectory(f.root)
      const options = {
        root: f.root,
        scanner: "rust",
        rustDirectory: f.rustDirectory,
      }
      native = await scanFilesystem(options)
      const path = await cache.save(native, options)
      const before = readFileSync(path)
      const signal = AbortSignal.abort()
      const cancelled = await scanFilesystem({ ...options, signal })
      assert.equal(cancelled.status, "cancelled")
      assert.equal(await cache.save(cancelled, options), null)
      releaseDiskSnapshot(cancelled)
      const helper = join(f.work, "bad-helper")
      writeFileSync(helper, "#!/bin/sh\nexit 7\n")
      chmodSync(helper, 0o700)
      await assert.rejects(
        scanFilesystem({ ...options, rustBinary: helper }),
        /Rust scanner exited/
      )
      assert.deepEqual(readFileSync(path), before)
    } finally {
      if (native) releaseDiskSnapshot(native)
      rmSync(f.work, { recursive: true, force: true })
    }
  }
)
