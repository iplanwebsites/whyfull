import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs"
import os from "node:os"
import { join } from "node:path"
import { syncBuiltinESMExports } from "node:module"
import { startViewer, loadDiskSnapshot, ScanCache } from "../dist/index.mjs"

const cli = new URL("../dist/cli.mjs", import.meta.url).pathname
const cachePath = (root) => ScanCache.forDirectory(root).path(root)
function fixture() {
  const base = realpathSync(
    mkdtempSync(join(os.tmpdir(), "whyfull-directory-"))
  )
  const home = join(base, "home"),
    root = join(home, "project")
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "sample"), Buffer.alloc(65536))
  mkdirSync(join(root, ".whyfull"))
  writeFileSync(join(root, ".whyfull", "old-cache"), Buffer.alloc(131072))
  return { base, home, root }
}
function run(args, { root, home, ...options }) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 20000,
    ...options,
  })
}
async function client(viewer) {
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
    for (let i = 0; i < 300; i++) {
      const value = await request("status")
      if (predicate(value)) return value
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
    assert.fail("directory scan did not settle")
  }
  return { request, wait }
}

test("directory flag defaults to cwd; JSON scans cache locally and skip cache contents on repeat runs", async () => {
  const f = fixture()
  try {
    const first = JSON.parse(
      run(["--directory", "--scan", "--json", "--workers", "1"], f)
    )
    assert.equal(first.root, f.root)
    assert.equal(first.format, "whyfull-disk")
    assert.equal(first.files, 1)
    const internal = first.directories.find((d) => d.name === ".whyfull")
    assert.equal(internal.state, "excluded")
    assert.equal(internal.bytes, 0)
    assert.match(internal.reason, /Whyfull scan cache/)
    const directory = join(f.root, ".whyfull")
    const files = readdirSync(directory)
    assert.deepEqual(files.sort(), ["inventories", "latest.json", "old-cache"])
    const cache = cachePath(f.root)
    assert.equal((await loadDiskSnapshot(cache)).files, 1)
    if (process.platform !== "win32")
      assert.equal(statSync(cache).mode & 0o777, 0o600)
    const second = JSON.parse(
      run(["--json", "--workers", "1", "--directory"], f)
    )
    assert.equal(second.files, first.files)
    assert.equal(second.directories[0].bytes, first.directories[0].bytes)
    assert.deepEqual(readdirSync(directory), files)
    assert.equal(existsSync(join(f.home, ".config", "whyfull", "scans")), false)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("explicit directory paths compose with exports, exclusions, workers, engine, config, and terminal output", () => {
  const f = fixture()
  try {
    mkdirSync(join(f.root, "ignored"))
    writeFileSync(join(f.root, "ignored", "data"), "skip me")
    const config = join(f.base, "config.json")
    writeFileSync(
      config,
      JSON.stringify({ keep: [join(f.root, "sample")], exclude: [] })
    )
    const output = join(f.base, "report.json")
    const text = run(
      [
        "--directory=project",
        "--json",
        "--json-file",
        output,
        "--exclude",
        join(f.root, "ignored"),
        "--engine",
        "async",
        "--workers",
        "1",
        "--config",
        config,
      ],
      { ...f, cwd: f.home }
    )
    const report = JSON.parse(text)
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), report)
    assert.equal(report.root, f.root)
    assert.equal(report.files, 1)
    assert.equal(report.engine, "async")
    assert.deepEqual(report.policy.keep, [join(f.root, "sample")])
    const summary = run(["--directory", "project", "--tui", "--workers", "1"], {
      ...f,
      cwd: f.home,
    })
    assert.match(summary, /complete:/)
    assert.match(summary, /Cached .*\.whyfull/)
    assert.doesNotMatch(summary, /Choose an action/)
    assert.throws(
      () => run(["--directory", "--scan", "--json-file", output], f),
      /refusing to overwrite/
    )
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("invalid directory scopes fail before writing a cache or opening a browser", () => {
  const f = fixture()
  try {
    for (const args of [
      ["--directory=", "--json"],
      ["--directory", f.root, "--root", f.home, "--json"],
      ["--directory", f.root, "--directory", f.home, "--json"],
      ["--directory", join(f.root, "sample"), "--json"],
      ["--directory", join(f.root, "missing"), "--json"],
    ])
      assert.throws(() => run(args, f))
    assert.equal(existsSync(cachePath(f.root)), false)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("directory UI caches locally, visits Home on request, restores its scoped inventory, and reopens its cache", async () => {
  const f = fixture()
  const originalHome = os.homedir
  // A tiny fixture Home proves navigation without touching the real user's Home.
  os.homedir = () => f.home
  syncBuiltinESMExports()
  let viewer
  const options = {
    root: f.root,
    directoryMode: true,
    workers: 1,
    open: false,
    policyFile: join(f.base, "config.json"),
    drives: () => [],
  }
  try {
    viewer = await startViewer(options)
    let c = await client(viewer)
    const first = await c.wait((s) => !!s.savedPath)
    assert.equal(first.root, f.root)
    assert.ok(first.savedPath.startsWith(cachePath(f.root)))
    assert.equal(first.directoryDestination.id, f.root)
    assert.equal(first.directoryDestination.kind, "directory")
    assert.equal(
      first.homeDestination.scan,
      null,
      "Home is not scanned automatically"
    )
    assert.equal(first.files, 1)
    await c.request("scan-root", { root: f.home })
    const home = await c.wait((s) => s.root === f.home && !!s.savedPath)
    assert.ok(home.savedPath.startsWith(join(f.base, "scans")))
    assert.equal(home.directoryDestination.scan.documentId, first.documentId)
    const back = await c.request("scan-root", { root: f.root })
    assert.equal(back.root, f.root)
    assert.equal(back.documentId, first.documentId)
    assert.equal(back.status, "complete")
    assert.equal(back.files, 1)
    await viewer.close()
    viewer = await startViewer({ ...options, scanOnStart: false })
    c = await client(viewer)
    const restored = await c.request("status")
    assert.equal(restored.root, f.root)
    assert.equal(restored.cache.restored, true)
    assert.equal(restored.cache.refreshing, false)
    writeFileSync(join(f.root, "new-file"), "new leak")
    await c.request("rescan", {})
    const refreshed = await c.wait(
      (s) => !s.cache.refreshing && s.revision === 1 && !!s.savedPath
    )
    assert.equal(refreshed.files, 2)
    assert.equal((await loadDiskSnapshot(refreshed.savedPath)).files, 2)
  } finally {
    await viewer?.close()
    os.homedir = originalHome
    syncBuiltinESMExports()
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("bare --directory opens a scoped UI by default and deferred scans still save an explicit export", async () => {
  const f = fixture()
  run(["--directory", "--json", "--workers", "1"], f)
  const child = spawn(
    process.execPath,
    [cli, "--dir", "--no-open", "--no-scan", "--no-cache", "--workers", "1"],
    {
      cwd: f.root,
      env: { PATH: process.env.PATH, HOME: f.home },
    }
  )
  const closed = once(child, "close")
  try {
    const url = await new Promise((resolve, reject) => {
      let output = ""
      const timeout = setTimeout(
        () => reject(new Error(`UI did not start: ${output}`)),
        10000
      )
      child.stdout.on("data", (chunk) => {
        output += chunk
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#\w+/)
        if (match) {
          clearTimeout(timeout)
          resolve(match[0])
        }
      })
      child.once("close", () => {
        clearTimeout(timeout)
        reject(new Error(output))
      })
    })
    const c = await client({ url })
    const status = await c.request("status")
    assert.equal(status.root, f.root)
    assert.equal(status.awaitingScan, true)
    assert.equal(status.directoryDestination.id, f.root)
    assert.equal(status.files, 0)
    assert.equal(
      status.cache.restored,
      false,
      "CLI --no-cache bypasses the existing folder cache"
    )
  } finally {
    child.kill("SIGTERM")
    await closed
  }
  let viewer
  try {
    const exportFile = join(f.base, "export.json")
    viewer = await startViewer({
      root: f.root,
      directoryMode: true,
      workers: 1,
      open: false,
      scanOnStart: false,
      saveTo: exportFile,
      policyFile: join(f.base, "config.json"),
    })
    const c = await client(viewer)
    await c.request("rescan", {})
    await c.wait(() => existsSync(exportFile))
    assert.equal((await loadDiskSnapshot(exportFile)).root, f.root)
    assert.equal((await loadDiskSnapshot(exportFile)).files, 1)
  } finally {
    await viewer?.close()
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("--no-cache scans fresh, leaves existing cache untouched, and still exports JSON", () => {
  const f = fixture()
  try {
    run(["--directory", "--json", "--workers", "1"], f)
    const cache = cachePath(f.root)
    const original = readFileSync(cache, "utf8")
    writeFileSync(join(f.root, "later"), "fresh data")
    const output = join(f.base, "no-cache-export.json")
    const fresh = JSON.parse(
      run(
        [
          "--directory",
          "--json",
          "--no-cache",
          "--json-file",
          output,
          "--workers",
          "1",
        ],
        f
      )
    )
    assert.equal(fresh.files, 2)
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), fresh)
    assert.equal(readFileSync(cache, "utf8"), original)
    const clean = join(f.root, "clean")
    mkdirSync(clean)
    writeFileSync(join(clean, "sample"), "sample")
    assert.equal(
      JSON.parse(
        run(["--directory", clean, "--json", "--no-cache", "--workers", "1"], f)
      ).files,
      1
    )
    assert.equal(existsSync(join(clean, ".whyfull")), false)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("folder UI opens stale cache immediately and replaces it after a background refresh", async () => {
  const f = fixture()
  const options = {
    root: f.root,
    directoryMode: true,
    workers: 1,
    open: false,
    policyFile: join(f.base, "config.json"),
  }
  let viewer
  try {
    run(
      [
        "--directory",
        "--json",
        "--workers",
        "1",
        "--config",
        options.policyFile,
      ],
      f
    )
    writeFileSync(join(f.root, "later"), "fresh data")
    viewer = await startViewer(options)
    const stale = viewer.snapshot
    assert.equal(stale.status, "complete")
    assert.equal(
      stale.files,
      1,
      "the prior inventory is available before fresh workers finish"
    )
    const c = await client(viewer)
    const refreshed = await c.wait(
      (s) => s.revision === 1 && !s.cache.refreshing && !!s.savedPath
    )
    assert.equal(refreshed.files, 2)
    assert.equal(
      stale.files,
      1,
      "refresh swaps the inventory without mutating the displayed baseline"
    )
    assert.equal(refreshed.savedPath, cachePath(f.root))
    assert.equal((await loadDiskSnapshot(refreshed.savedPath)).files, 2)
  } finally {
    await viewer?.close()
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("--no-cache bypasses folder UI restore and persistent writes while preserving explicit exports", async () => {
  const f = fixture()
  const options = {
    root: f.root,
    directoryMode: true,
    workers: 1,
    open: false,
    policyFile: join(f.base, "config.json"),
  }
  let viewer
  try {
    run(
      [
        "--directory",
        "--json",
        "--workers",
        "1",
        "--config",
        options.policyFile,
      ],
      f
    )
    const cache = cachePath(f.root)
    const original = readFileSync(cache, "utf8")
    writeFileSync(join(f.root, "later"), "fresh data")
    const output = join(f.base, "explicit.json")
    viewer = await startViewer({
      ...options,
      cache: false,
      scanOnStart: false,
      saveTo: output,
    })
    const c = await client(viewer)
    const initial = await c.request("status")
    assert.equal(initial.awaitingScan, true)
    assert.equal(initial.files, 0)
    assert.equal(initial.cache.restored, false)
    await c.request("rescan", {})
    const fresh = await c.wait(
      (s) => s.status === "complete" && s.savedPath === output
    )
    assert.equal(fresh.files, 2)
    assert.equal((await loadDiskSnapshot(output)).files, 2)
    assert.equal(readFileSync(cache, "utf8"), original)
    assert.equal(existsSync(join(f.base, "scans")), false)
  } finally {
    await viewer?.close()
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("subfolder scans keep their own cache file without replacing the parent folder cache", async () => {
  const f = fixture()
  const childRoot = join(f.root, "child")
  mkdirSync(childRoot)
  writeFileSync(join(childRoot, "sample"), "child data")
  let viewer
  try {
    viewer = await startViewer({
      root: f.root,
      directoryMode: true,
      workers: 1,
      open: false,
      policyFile: join(f.base, "config.json"),
    })
    const c = await client(viewer)
    const first = await c.wait((s) => !!s.savedPath)
    const original = readFileSync(first.savedPath, "utf8")
    const node = viewer.snapshot.directories.find((d) => d.path === childRoot)
    await c.request("scan-folder", { id: `d${node.id}` })
    const child = await c.wait((s) => s.root === childRoot && !!s.savedPath)
    assert.equal(child.savedPath, cachePath(childRoot))
    assert.equal(readFileSync(first.savedPath, "utf8"), original)
    assert.equal((await loadDiskSnapshot(child.savedPath)).root, childRoot)
  } finally {
    await viewer?.close()
    rmSync(f.base, { recursive: true, force: true })
  }
})

test("--dir aliases --directory with cwd, explicit and equals paths, exports, and --no-cache", () => {
  const f = fixture()
  try {
    for (const args of [["--dir"], ["--dir", f.root], [`--dir=${f.root}`]]) {
      const output = JSON.parse(
        run([...args, "--json", "--no-cache", "--workers", "1"], f)
      )
      assert.equal(output.root, f.root)
      assert.equal(output.format, "whyfull-disk")
      assert.equal(output.files, 1)
    }
    const file = join(f.base, "alias-export.json")
    run(["--dir", "--scan", "--json-file", file, "--workers", "1"], f)
    assert.equal(JSON.parse(readFileSync(file, "utf8")).root, f.root)
    assert.equal(existsSync(cachePath(f.root)), true)
    assert.throws(() =>
      run(["--dir", f.root, "--directory", f.home, "--json"], f)
    )
    assert.match(run(["--help"], f), /--dir \[dir\]/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})
