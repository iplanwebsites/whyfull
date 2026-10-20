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
    assert.throws(
      () =>
        validateViewerReport({
          ...report,
          targets: [
            {
              ...report.targets[0],
              storeVersions: [
                { name: "v3", path: join(root, "v3"), bytes: -1 },
              ],
            },
          ],
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
    const childPath = join(root, "child")
    assert.equal(
      (await post("report/action", { path: other, action: "trash" })).status,
      400
    )
    assert.equal(
      (await post("report/action", { path: childPath, action: "trash" }))
        .status,
      200
    )
    let shortlist = await get("shortlist")
    assert.equal(shortlist[0].path, childPath)
    assert.equal(shortlist[0].bytes, 4096)
    assert.match(shortlist[0].id, /^report:/)
    assert.equal(
      (await get("report/locations")).find((item) => item.path === childPath)
        .mark,
      "trash"
    )
    assert.equal(
      (await post("report/action", { path: root, action: "keep" })).status,
      200
    )
    assert.equal(
      (await post("report/action", { path: childPath, action: "trash" }))
        .status,
      400
    )
    assert.equal(
      (await post("report/action", { path: root, action: "unkeep" })).status,
      200
    )
    assert.equal(
      (await post("report/action", { path: childPath, action: "useless" }))
        .status,
      200
    )
    assert.equal((await get("shortlist"))[0].mark, "useless")
    assert.equal(
      (
        await post("report/action", {
          path: childPath,
          action: "shell",
          command: "echo unsafe",
        })
      ).status,
      400
    )
    assert.equal(
      (await post("report/action", { path: childPath, action: "clear" }))
        .status,
      200
    )
    assert.equal((await get("shortlist")).length, 0)
    const inspected = await post("report/action", {
      path: childPath,
      action: "scan",
    })
    assert.equal(inspected.status, 200)
    const inspection = await inspected.json()
    assert.equal(inspection.root, childPath)
    assert.equal(inspection.cleanup.mode, "demo")
    assert.equal(inspection.source.kind, "live")

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

test("large file directories report the true count and can start a scoped live listing from a snapshot", async () => {
  const root = fixture(),
    photos = join(root, "photos")
  let viewer
  try {
    mkdirSync(photos)
    for (let i = 0; i < 150; i++)
      writeFileSync(join(photos, `${i}.bin`), Buffer.alloc(8192))
    const snapshot = await scanFilesystem({ root, workers: 1 })
    const node = snapshot.directories.find((entry) => entry.path === photos)
    viewer = await startViewer({
      root,
      snapshot,
      workers: 1,
      open: false,
      policyFile: join(root, "config.json"),
    })
    const url = new URL(viewer.url),
      headers = {
        Authorization: `Bearer ${url.hash.slice(1)}`,
        "Content-Type": "application/json",
      }
    const get = async (path) =>
      (await fetch(`${url.origin}/api/${path}`, { headers })).json()
    const post = (body) =>
      fetch(`${url.origin}/api/scan-folder`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    const listed = await get(`directory?id=${node.id}`)
    assert.equal(listed.total, 32)
    assert.equal(listed.ownFiles, 150)
    assert.equal(listed.retainedFiles, 32)
    assert.equal(listed.fileScope, "largest")
    assert.ok(listed.largestFileBytes > 0)
    assert.ok(
      listed.largestFileBytes / listed.ownBytes < 0.01,
      "largest file is under 1% of direct file space"
    )
    assert.equal((await post({ id: "f1", path: photos })).status, 400)
    assert.equal((await post({ id: "d999999" })).status, 400)
    const switched = await post({ id: `d${node.id}`, path: "/etc" })
    assert.equal(switched.status, 200)
    const status = await switched.json()
    assert.equal(
      status.root,
      photos,
      "scope comes from inventory ID, not a client-supplied path"
    )
    assert.equal(status.snapshotMode, false)
    assert.equal(status.cleanup.mode, "demo")
    for (let i = 0; i < 100 && viewer.snapshot.status === "scanning"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    const all = await get("directory?id=0&files=all")
    assert.equal(all.fileScope, "all")
    assert.equal(all.total, 150)
    assert.equal(all.entries.length, 100)
    const next = await get("directory?id=0&files=all&offset=100")
    assert.equal(next.entries.length, 50)
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test(
  "ui and app launch the bundled viewer, open the default browser, and preserve report/no-open options",
  { skip: process.platform === "win32" },
  async () => {
    const { spawn } = await import("node:child_process")
    const { once } = await import("node:events")
    const { delimiter } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const { existsSync, unlinkSync } = await import("node:fs")
    const root = fixture()
    const launchLog = join(root, "browser.json")
    const reportFile = join(root, "report.json")
    writeFileSync(reportFile, JSON.stringify(reportFor(root)))
    // Observe the OS opener contract without launching real browsers in tests.
    writeFileSync(
      join(root, process.platform === "darwin" ? "open" : "xdg-open"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(launchLog)}, JSON.stringify(process.argv.slice(2)))\n`,
      { mode: 0o700 }
    )
    try {
      for (const entry of [
        { args: ["ui", "--root", root], opens: true, kind: "live" },
        { args: ["app", "--root", root], opens: true, kind: "live" },
        {
          args: ["ui", "--no-open", "--root", root],
          opens: false,
          kind: "live",
        },
        {
          args: ["app", reportFile, "--no-open"],
          opens: false,
          kind: "report",
        },
      ]) {
        if (existsSync(launchLog)) unlinkSync(launchLog)
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("../dist/cli.mjs", import.meta.url)),
            ...entry.args,
            "--config",
            join(root, "config.json"),
          ],
          {
            env: {
              ...process.env,
              PATH: `${root}${delimiter}${process.env.PATH}`,
            },
            stdio: ["ignore", "pipe", "pipe"],
          }
        )
        const closed = once(child, "close")
        try {
          const url = await new Promise((resolve, reject) => {
            let output = ""
            const timer = setTimeout(
              () => reject(new Error(`Viewer did not start: ${output}`)),
              10000
            )
            child.stdout.on("data", (chunk) => {
              output += chunk
              const match = output.match(
                /http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/
              )
              if (match) {
                clearTimeout(timer)
                resolve(new URL(match[0]))
              }
            })
            child.on("error", (error) => {
              clearTimeout(timer)
              reject(error)
            })
            child.on("close", (code) => {
              clearTimeout(timer)
              reject(new Error(`Viewer exited ${code}: ${output}`))
            })
          })
          const response = await fetch(`${url.origin}/api/status`, {
            headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
          })
          assert.equal(response.status, 200)
          const status = await response.json()
          assert.equal(status.source.kind, entry.kind)
          assert.equal(status.cleanup.mode, "demo")
          if (entry.kind === "live") assert.equal(status.root, root)
          if (entry.opens) {
            for (let i = 0; i < 100 && !existsSync(launchLog); i++)
              await new Promise((resolve) => setTimeout(resolve, 10))
            assert.deepEqual(JSON.parse(readFileSync(launchLog, "utf8")), [
              url.href,
            ])
          } else {
            await new Promise((resolve) => setTimeout(resolve, 100))
            assert.equal(existsSync(launchLog), false)
          }
        } finally {
          child.kill("SIGTERM")
          await closed
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test("viewer hides negligible files by default, preserves chart totals and IDs, and reveals them on request", async () => {
  const root = fixture()
  let viewer
  try {
    mkdirSync(join(root, "small-project"))
    writeFileSync(join(root, "small-project", "readme.txt"), "keep visible")
    writeFileSync(join(root, "movie.bin"), Buffer.alloc(16 * 1024 * 1024))
    for (const name of [
      ".DS_Store",
      "._photo.jpg",
      "Thumbs.db",
      "desktop.ini",
      "tiny.txt",
    ])
      writeFileSync(join(root, name), Buffer.alloc(4096))
    writeFileSync(join(root, "._large"), Buffer.alloc(128 * 1024))
    viewer = await startViewer({
      root,
      open: false,
      workers: 1,
      policyFile: join(root, "config.json"),
    })
    for (let i = 0; i < 200 && viewer.snapshot.status === "scanning"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    const url = new URL(viewer.url)
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}` }
    const get = async (path) =>
      (await fetch(`${url.origin}/api/${path}`, { headers })).json()
    const normal = await get("directory?id=0")
    assert.deepEqual(
      normal.entries.map((entry) => entry.name).sort(),
      ["._large", "movie.bin", "small-project"].sort()
    )
    assert.equal(normal.ownFiles, 7, "filtered files remain measured")
    assert.equal(
      normal.chart.children.reduce((sum, entry) => sum + entry.value, 0),
      normal.node.value
    )
    assert.equal(
      normal.chart.children.find((entry) => entry.kind === "remainder").files,
      5
    )
    assert.ok(
      !normal.chart.children.some((entry) => entry.name === ".DS_Store")
    )
    const movie = normal.entries.find((entry) => entry.name === "movie.bin")
    assert.equal(
      viewer.snapshot.directories[0].topFiles[Number(movie.id.split("-")[1])]
        .name,
      "movie.bin"
    )
    const search = await get("directory?id=0&q=.DS_Store")
    assert.equal(search.entries.length, 1)
    assert.equal(search.entries[0].name, ".DS_Store")
    const all = await get("directory?id=0&files=all")
    assert.equal(all.entries.length, 8)
    assert.ok(all.entries.some((entry) => entry.name === "tiny.txt"))
    const project = normal.entries.find(
      (entry) => entry.name === "small-project"
    )
    assert.equal(
      (await get(`directory?id=${project.id.slice(1)}`)).entries[0].name,
      "readme.txt",
      "small files stay visible when they are meaningful within their own folder"
    )
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
