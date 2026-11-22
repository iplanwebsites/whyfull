import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  linkSync,
  rmSync,
  readdirSync,
  realpathSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"
import {
  scanFilesystem,
  releaseDiskSnapshot,
  ScanCache,
  loadDiskSnapshot,
} from "../dist/index.mjs"

test("Node streams wide folders and hard-link batches into SQLite with a 32 MiB heap", () => {
  const work = realpathSync(
      mkdtempSync(join(tmpdir(), "whyfull sqlite wide "))
    ),
    root = join(work, "root")
  mkdirSync(root)
  try {
    writeFileSync(join(root, "origin"), Buffer.alloc(4096))
    for (let i = 0; i < 2048; i++) {
      mkdirSync(join(root, `d${i}`))
      linkSync(join(root, "origin"), join(root, `l${i}`))
    }
    for (let i = 0; i < 4096; i++) writeFileSync(join(root, `f${i}`), "")
    const runner = join(work, "run.mjs")
    writeFileSync(
      runner,
      `
    import {scanFilesystem,ScanCache,releaseDiskSnapshot} from ${JSON.stringify(new URL("../dist/index.mjs", import.meta.url).href)};
    const options={root:${JSON.stringify(root)},workers:4,inventoryDirectory:${JSON.stringify(join(work, ".whyfull/working"))}};
    const snapshot=await scanFilesystem(options);
    const file=await new ScanCache(${JSON.stringify(join(work, ".whyfull/cache"))}).save(snapshot,options);
    console.log(JSON.stringify({file,storage:snapshot.storage,files:snapshot.files,root:snapshot.directories[0],timings:snapshot.timings}));
    releaseDiskSnapshot(snapshot);
  `
    )
    const result = JSON.parse(
      execFileSync(process.execPath, ["--max-old-space-size=32", runner], {
        encoding: "utf8",
        timeout: 30000,
      })
    )
    assert.equal(result.storage, "sqlite")
    assert.equal(result.files, 6145)
    assert.equal(result.root.bytes, 4096)
    assert.equal(result.root.directories, 2048)
    assert.ok(
      result.timings.totalMs >=
        result.timings.crawlMs +
          result.timings.aggregationMs +
          result.timings.indexingMs -
          5
    )
    const db = new DatabaseSync(result.file, { readOnly: true })
    try {
      assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok")
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM directories WHERE state IN ('pending','working')"
          )
          .get().n,
        0
      )
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hardlinks").get().n, 1)
    } finally {
      db.close()
    }
    assert.equal(
      readdirSync(join(work, ".whyfull/working")).filter((f) =>
        f.endsWith(".sqlite")
      ).length,
      0
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test("SQLite cache loads are private, preserve engine identity, and release without deleting cache", async () => {
  const work = realpathSync(
      mkdtempSync(join(tmpdir(), "whyfull sqlite lifecycle "))
    ),
    root = join(work, "root")
  mkdirSync(root)
  writeFileSync(join(root, "data"), "inventory")
  let first, second, imported
  try {
    const options = {
      root,
      workers: 1,
      inventoryDirectory: join(work, ".whyfull/working"),
    }
    first = await scanFilesystem(options)
    const cache = new ScanCache(join(work, ".whyfull/cache"))
    const file = await cache.save(first, options)
    releaseDiskSnapshot(first)
    first = null
    second = await cache.load(root, options)
    assert.equal(second.scanner, "node")
    assert.equal(second.storage, "sqlite")
    imported = await loadDiskSnapshot(file)
    assert.equal(imported.files, 1)
    releaseDiskSnapshot(imported)
    imported = null
    assert.equal(second.directories[0].files, 1)
    assert.equal(await cache.load(root, { ...options, scanner: "rust" }), null)
  } finally {
    for (const snapshot of [first, second, imported])
      if (snapshot) releaseDiskSnapshot(snapshot)
    rmSync(work, { recursive: true, force: true })
  }
})
