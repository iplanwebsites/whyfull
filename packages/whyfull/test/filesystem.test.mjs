import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  truncateSync,
  linkSync,
  symlinkSync,
  rmSync,
  readFileSync,
  statSync,
  realpathSync,
} from "node:fs"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  scanFilesystem,
  measure,
  startViewer,
  saveDiskSnapshot,
  loadDiskSnapshot,
  loadDiskPolicy,
  saveDiskPolicy,
  pathWithin,
} from "../dist/index.mjs"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "whyfull-disk-"))
  for (const folder of ["keep", "skip", "skip-sibling", "nested/deep"])
    mkdirSync(join(root, folder), { recursive: true })
  for (const folder of ["keep", "skip", "skip-sibling", "nested/deep"])
    writeFileSync(join(root, folder, "data.bin"), Buffer.alloc(65536, 1))
  writeFileSync(join(root, "sparse.bin"), Buffer.alloc(4096, 1))
  truncateSync(join(root, "sparse.bin"), 1024 ** 3)
  linkSync(join(root, "keep/data.bin"), join(root, "nested/hardlink.bin"))
  symlinkSync(root, join(root, "nested/cycle"))
  for (let i = 0; i < 70; i++)
    writeFileSync(join(root, "keep", `small-${i}`), Buffer.alloc(32, i))
  return root
}

test("scanner configurations agree with allocated-byte measurement, including sparse files and hardlinks", async () => {
  const root = fixture()
  try {
    const expected = measure(root)
    for (const [workers, engine] of [
      [1, "sync"],
      [4, "sync"],
      [2, "async"],
    ]) {
      const result = await scanFilesystem({ root, workers, engine })
      assert.equal(result.status, "complete")
      assert.equal(result.directories[0].bytes, expected.bytes)
      assert.equal(
        result.files,
        expected.files + 1,
        "file count includes both names of the hardlink"
      )
      assert.equal(result.skippedLinks, 1)
      assert.equal(result.issues, 0)
      assert.ok(
        result.directories[0].apparentBytes > 1024 ** 3,
        "sparse logical size remains available"
      )
      const kept = result.directories.find((d) => d.name === "keep")
      assert.equal(kept.ownFiles, 71)
      assert.equal(kept.topFiles.length, 32)
      assert.ok(
        kept.topFiles.every(
          (f, i, all) => i === 0 || all[i - 1].bytes >= f.bytes
        )
      )
      assert.ok(kept.ownBytes >= kept.topFiles.reduce((s, f) => s + f.bytes, 0))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("exclusion prunes descendants but not similarly named siblings; keep does not suppress measurement", async () => {
  const root = fixture()
  try {
    const result = await scanFilesystem({
      root,
      workers: 2,
      policy: { keep: [join(root, "keep")], exclude: [join(root, "skip")] },
    })
    assert.equal(
      result.directories.find((d) => d.name === "skip").state,
      "excluded"
    )
    assert.equal(result.directories.find((d) => d.name === "skip").bytes, 0)
    assert.equal(result.directories[0].excluded, 1)
    assert.ok(
      result.directories.find((d) => d.name === "skip-sibling").bytes > 0
    )
    assert.ok(result.directories.find((d) => d.name === "keep").bytes > 0)
    assert.equal(
      result.directories[0].bytes,
      measure(root).bytes - measure(join(root, "skip")).bytes
    )
    assert.equal(
      pathWithin(join(root, "skip-sibling"), join(root, "skip")),
      false
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("cancellation and excluded roots return explicitly incomplete or excluded inventories", async () => {
  const root = fixture()
  try {
    const controller = new AbortController()
    controller.abort()
    const cancelled = await scanFilesystem({ root, signal: controller.signal })
    assert.equal(cancelled.status, "cancelled")
    assert.equal(cancelled.files, 0)
    const excluded = await scanFilesystem({
      root,
      policy: { keep: [], exclude: [root] },
    })
    assert.equal(excluded.status, "complete")
    assert.equal(excluded.directories[0].state, "excluded")
    assert.equal(excluded.files, 0)
    await assert.rejects(scanFilesystem({ root, workers: 0 }), /workers/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("private snapshots round-trip and refuse overwrites; malformed settings are preserved", async () => {
  const root = fixture()
  try {
    const result = await scanFilesystem({ root, workers: 1 })
    const snapshot = join(root, "snapshot.json")
    await saveDiskSnapshot(result, snapshot)
    assert.deepEqual(await loadDiskSnapshot(snapshot), result)
    await assert.rejects(saveDiskSnapshot(result, snapshot), /EEXIST/)
    const generic = join(root, "generic.json")
    writeFileSync(generic, JSON.stringify(result))
    assert.deepEqual(
      await loadDiskSnapshot(generic),
      result,
      "minified JSON also imports"
    )
    writeFileSync(generic, JSON.stringify(result, null, 2))
    assert.deepEqual(
      await loadDiskSnapshot(generic),
      result,
      "pretty JSON also imports"
    )
    const original = readFileSync(snapshot, "utf8")
    writeFileSync(generic, original.replace(/,\n(?=\{)/, "\n"))
    await assert.rejects(
      loadDiskSnapshot(generic),
      /comma|Unexpected|separator|token|Token/
    )
    if (process.platform !== "win32")
      assert.equal(statSync(snapshot).mode & 0o777, 0o600)
    const config = join(root, "config.json")
    writeFileSync(
      config,
      JSON.stringify({ theme: "light", keep: [], exclude: [] })
    )
    saveDiskPolicy({ keep: [root], exclude: [] }, config)
    assert.deepEqual(loadDiskPolicy(config), {
      keep: [realpathSync(root)],
      exclude: [],
    })
    assert.equal(JSON.parse(readFileSync(config)).theme, "light")
    writeFileSync(config, "broken")
    assert.throws(() => saveDiskPolicy({ keep: [], exclude: [] }, config))
    assert.equal(readFileSync(config, "utf8"), "broken")
    const bad = JSON.parse(readFileSync(snapshot))
    bad.directories[0].children = [0]
    writeFileSync(snapshot, JSON.stringify(bad))
    await assert.rejects(loadDiskSnapshot(snapshot), /Invalid/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("loopback viewer authenticates requests, preserves measured data, and supports saved policies", async () => {
  const root = fixture()
  let viewer
  try {
    for (let i = 0; i < 160; i++) {
      const folder = join(root, `folder-${i}`)
      mkdirSync(folder)
      writeFileSync(join(folder, "data"), Buffer.alloc(8192, 1))
    }
    viewer = await startViewer({
      root,
      workers: 2,
      open: false,
      policyFile: join(root, "preferences.json"),
    })
    const url = new URL(viewer.url),
      token = url.hash.slice(1),
      base = url.origin
    const headers = { Authorization: `Bearer ${token}` }
    assert.equal((await fetch(`${base}/api/status`)).status, 401)
    assert.equal(
      (
        await fetch(`${base}/api/status`, {
          headers: { ...headers, Origin: "https://attacker.example" },
        })
      ).status,
      403
    )
    const spoofed = await new Promise((resolve, reject) => {
      const req = request(
        `${base}/api/status`,
        { headers: { ...headers, Host: "attacker.example" } },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        }
      )
      req.on("error", reject)
      req.end()
    })
    assert.equal(spoofed, 403)
    for (let i = 0; i < 100 && viewer.snapshot.status === "scanning"; i++)
      await new Promise((r) => setTimeout(r, 20))
    assert.equal(viewer.snapshot.status, "complete")
    const response = await fetch(`${base}/api/directory?id=0`, { headers })
    const data = await response.json()
    assert.ok(
      data.chart.children.length <= 49,
      "chart payload stays bounded on wide folders"
    )
    assert.equal(data.entries.length, 100)
    const nextPage = await (
      await fetch(`${base}/api/directory?id=0&offset=100`, { headers })
    ).json()
    assert.ok(nextPage.entries.length > 0)
    const found = await (
      await fetch(`${base}/api/directory?id=0&q=folder-159`, { headers })
    ).json()
    assert.equal(found.total, 1)
    assert.equal(data.node.value, viewer.snapshot.directories[0].bytes)
    const sum = data.chart.children.reduce((s, n) => s + n.value, 0)
    assert.equal(
      sum,
      data.node.value,
      "chart children partition the measured bytes"
    )
    const keep = viewer.snapshot.directories.find((d) => d.name === "keep")
    const changed = await fetch(`${base}/api/policy`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ id: keep.id, action: "keep" }),
    })
    assert.equal(changed.status, 200)
    const kept = await (
      await fetch(`${base}/api/directory?id=${keep.id}`, { headers })
    ).json()
    assert.equal(kept.node.kept, true)
    assert.ok(kept.node.value > 0)
    const keepBefore = data.chart.children.find(
      (entry) => entry.id === `d${keep.id}`
    )
    assert.deepEqual(
      kept.node.colorPath,
      keepBefore.colorPath,
      "directory color ancestry survives drilling down"
    )
    assert.deepEqual(kept.chart.colorPath, kept.node.colorPath)
    assert.equal(
      kept.chart.children.reduce(
        (count, child) =>
          count + (child.kind === "file" ? 1 : (child.files ?? 0)),
        0
      ),
      71,
      "file groups preserve exact counts"
    )
    const remainder = kept.chart.children.find(
      (child) => child.kind === "remainder"
    )
    assert.equal(
      remainder.files,
      keep.ownFiles,
      "all sub-1 MiB files are grouped"
    )
    assert.equal(remainder.name, `${remainder.files} files`)
    assert.ok(
      kept.chart.children
        .filter((child) => child.kind === "group")
        .every((child) => child.files > 0 && child.name.endsWith(" files"))
    )
    const all = await (
      await fetch(`${base}/api/directory?id=${keep.id}&files=all`, { headers })
    ).json()
    assert.equal(all.entries.length, 71)
    const shell = await fetch(`${base}/`)
    const html = await shell.text()
    const script = html.match(/src="([^" ]+\.js)"/)
    assert.ok(script)
    assert.equal((await fetch(`${base}${script[1]}`)).status, 200)
    assert.equal((await fetch(`${base}/explore`)).status, 200)
    const preferences = await fetch(`${base}/api/preferences`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "sunburst",
        sort: "name",
        lastPath: viewer.snapshot.root,
      }),
    })
    assert.equal(preferences.status, 200)
    const updated = await (
      await fetch(`${base}/api/status`, { headers })
    ).json()
    assert.equal(updated.viewer.view, "sunburst")
    assert.equal(updated.cleanup.mode, "demo")
    const snapshot = await (
      await fetch(`${base}/api/export`, { headers })
    ).json()
    assert.equal(snapshot.format, "whyfull-disk")
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("cleanup starts in demo, consumes previews once, and enforces native Trash opt-in and keep rules", async () => {
  const { TrashController } = await import("../dist/index.mjs")
  const root = realpathSync(fixture())
  try {
    const snapshot = await scanFilesystem({ root, workers: 1 })
    const policy = { keep: [], exclude: [] }
    const moved = []
    const options = {
      snapshot: () => snapshot,
      policy: () => policy,
      allowTrash: true,
      executor: async (path) => {
        moved.push(path)
      },
    }
    const controller = new TrashController(options)
    const folder = snapshot.directories.find((d) => d.name === "keep"),
      id = `d${folder.id}`
    assert.equal(controller.status().mode, "demo")
    const demo = await controller.prepare(id)
    assert.equal((await controller.execute(demo.id)).moved, false)
    assert.deepEqual(moved, [])
    await assert.rejects(controller.execute(demo.id), /already used/)
    await assert.rejects(controller.prepare("d0"), /root/)
    assert.throws(
      () =>
        new TrashController({ ...options, allowTrash: false }).setMode("trash"),
      /allow-trash/
    )
    assert.throws(
      () =>
        new TrashController({ ...options, snapshotMode: true }).setMode(
          "trash"
        ),
      /Saved inventories/
    )
    controller.setMode("trash")
    const stale = await controller.prepare(id)
    writeFileSync(join(folder.path, "new-file"), "changed")
    await assert.rejects(controller.execute(stale.id), /changed/)
    const guarded = await controller.prepare(id)
    policy.keep.push(join(folder.path, "data.bin"))
    await assert.rejects(controller.execute(guarded.id), /kept/)
    policy.keep = []
    const real = await controller.prepare(id)
    assert.equal((await controller.execute(real.id)).moved, true)
    assert.deepEqual(moved, [folder.path])
    await assert.rejects(controller.prepare(id), /already moved/)
    assert.equal(new TrashController(options).status().mode, "demo")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("directory marks persist independently of preferences; Finder reveals allowlisted directories through path aliases", async () => {
  const root = realpathSync(fixture()),
    config = join(root, "config.json"),
    opened = []
  let viewer
  try {
    viewer = await startViewer({
      root,
      workers: 1,
      open: false,
      policyFile: config,
      finder: async (path) => {
        opened.push(path)
      },
    })
    for (let i = 0; i < 100 && viewer.snapshot.status === "scanning"; i++)
      await new Promise((r) => setTimeout(r, 10))
    const snapshot = viewer.snapshot
    const url = new URL(viewer.url),
      headers = {
        Authorization: `Bearer ${url.hash.slice(1)}`,
        "Content-Type": "application/json",
      }
    const post = (endpoint, body) =>
      fetch(`${url.origin}/api/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    const folder = snapshot.directories.find((d) => d.name === "nested"),
      id = `d${folder.id}`
    assert.equal((await post("mark", { id, mark: "trash" })).status, 200)
    assert.equal((await post("preferences", { view: "sunburst" })).status, 200)
    assert.equal((await post("mark", { id, mark: "useless" })).status, 200)
    assert.equal((await post("finder", { id, path: "/etc" })).status, 200)
    assert.deepEqual(
      opened,
      [folder.path],
      "client-supplied arbitrary paths are ignored"
    )
    symlinkSync(root, join(root, "alias"))
    const original = folder.path
    folder.path = join(root, "alias", "nested")
    assert.equal((await post("finder", { id })).status, 200)
    assert.equal(
      opened.at(-1),
      original,
      "Finder resolves aliases in parent paths"
    )
    folder.path = original
    assert.equal((await post("finder", { id: "f0-0" })).status, 400)
    assert.equal((await post("finder", { id: "d99999999" })).status, 400)
    assert.equal((await post("mark", { id: "d0", mark: "trash" })).status, 400)
    assert.equal((await post("mark", { id, mark: "bogus" })).status, 400)
    const kept = snapshot.directories.find((d) => d.name === "keep")
    await post("policy", { id: kept.id, action: "keep" })
    assert.equal(
      (await post("mark", { id: `d${kept.id}`, mark: "trash" })).status,
      400
    )
    const altered = snapshot.directories.find((d) => d.name === "skip-sibling")
    rmSync(altered.path, { recursive: true })
    symlinkSync(root, altered.path)
    assert.equal((await post("finder", { id: `d${altered.id}` })).status, 200)
    assert.equal(
      opened.at(-1),
      root,
      "read-only reveal safely resolves directory symlinks"
    )
    assert.equal(opened.length, 3)
    assert.equal(
      readFileSync(join(folder.path, "deep/data.bin")).length,
      65536,
      "marks leave inventory files intact"
    )
    await viewer.close()
    viewer = await startViewer({
      root,
      open: false,
      snapshot,
      policyFile: config,
    })
    const reopened = new URL(viewer.url),
      auth = { Authorization: `Bearer ${reopened.hash.slice(1)}` }
    const data = await (
      await fetch(`${reopened.origin}/api/directory?id=0`, { headers: auth })
    ).json()
    assert.equal(data.entries.find((entry) => entry.id === id).mark, "useless")
    const status = await (
      await fetch(`${reopened.origin}/api/status`, { headers: auth })
    ).json()
    assert.equal(status.viewer.view, "sunburst")
    assert.ok(status.policy.keep.includes(kept.path))
    const cleared = await fetch(`${reopened.origin}/api/mark`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ id, mark: null }),
    })
    assert.equal(cleared.status, 200)
    assert.deepEqual(JSON.parse(readFileSync(config)).marks, {})
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("shortlist migrates legacy marks, survives scan changes, and reports Finder errors", async () => {
  const root = realpathSync(fixture()),
    config = join(root, "config.json")
  const missing = join(root, "gone"),
    folder = join(root, "nested")
  writeFileSync(
    config,
    JSON.stringify({ marks: { [folder]: "delete", [missing]: "useless" } })
  )
  let viewer
  try {
    viewer = await startViewer({
      root,
      workers: 1,
      open: false,
      policyFile: config,
      finder: async () => {
        throw new Error("Finder refused the request")
      },
    })
    for (let i = 0; i < 100 && viewer.snapshot.status === "scanning"; i++)
      await new Promise((r) => setTimeout(r, 10))
    const url = new URL(viewer.url),
      headers = {
        Authorization: `Bearer ${url.hash.slice(1)}`,
        "Content-Type": "application/json",
      }
    const get = async () =>
      (await fetch(`${url.origin}/api/shortlist`, { headers })).json()
    const post = (body) =>
      fetch(`${url.origin}/api/shortlist`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    const entries = await get()
    assert.equal(entries.length, 2)
    const measured = entries.find((entry) => entry.path === folder)
    assert.equal(measured.mark, "trash")
    assert.ok(measured.bytes > 0)
    assert.equal(measured.partial, false)
    const stale = entries.find((entry) => entry.path === missing)
    assert.equal(stale.bytes, null)
    assert.equal(stale.id, null)
    const failed = await post({ path: folder, action: "finder" })
    assert.equal(failed.status, 400)
    assert.match((await failed.json()).error, /Finder refused/)
    const gone = await post({ path: missing, action: "finder" })
    assert.equal(gone.status, 400)
    assert.match((await gone.json()).error, /missing or inaccessible/)
    assert.equal((await post({ path: root, action: "finder" })).status, 400)
    assert.equal((await post({ path: folder, action: "trash" })).status, 400)
    assert.equal((await post({ path: missing, action: "clear" })).status, 200)
    assert.equal((await get()).length, 1)
    assert.deepEqual(JSON.parse(readFileSync(config)).marks, {
      [folder]: "trash",
    })
    const snapshot = await scanFilesystem({
      root: join(root, "keep"),
      workers: 1,
    })
    const imported = await fetch(`${url.origin}/api/import`, {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
    })
    assert.equal(imported.status, 200)
    const outside = (await get())[0]
    assert.equal(outside.path, folder)
    assert.equal(outside.mark, "trash")
    assert.equal(outside.bytes, null)
    assert.equal((await post({ path: folder, action: "clear" })).status, 200)
    assert.deepEqual(await get(), [])
    assert.ok(
      statSync(folder).isDirectory(),
      "clearing shortlist never moves user data"
    )
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
