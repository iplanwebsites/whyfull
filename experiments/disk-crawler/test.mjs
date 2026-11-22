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
  statSync,
  realpathSync,
  chmodSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import { scanToDatabase } from "./scan.mjs"
import { inspectDatabase } from "./inspect.mjs"
import { scanFilesystem } from "../../packages/whyfull/dist/index.mjs"

function fixture() {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-spike-test-")))
  const root = join(work, "root")
  for (const dir of [
    "",
    "keep",
    "skip",
    "skip-sibling",
    ".whyfull",
    "nested/deep",
    "empty",
    "wide",
  ])
    mkdirSync(join(root, dir), { recursive: true })
  for (const dir of ["keep", "skip", "skip-sibling", ".whyfull", "nested/deep"])
    writeFileSync(join(root, dir, "data.bin"), Buffer.alloc(8192, 1))
  writeFileSync(join(root, "sparse.bin"), Buffer.alloc(4096))
  truncateSync(join(root, "sparse.bin"), 1024 ** 3)
  for (let i = 0; i < 80; i++) {
    writeFileSync(
      join(root, "wide", `file-${String(i).padStart(3, "0")}`),
      Buffer.alloc(i * 1024, 1)
    )
    linkSync(join(root, "keep/data.bin"), join(root, "wide", `link-${i}`))
  }
  writeFileSync(join(root, '日本語\n".bin'), "hello")
  symlinkSync(root, join(root, "nested/cycle"))
  symlinkSync("/missing-target", join(root, "dangling"))
  return { work, root }
}

function read(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  return {
    db,
    metadata: JSON.parse(
      db.prepare("SELECT metadata FROM scan").get().metadata
    ),
  }
}

test("Rust and streaming Node preserve directory totals, sparse sizes, hardlinks, exclusions, and top files", async () => {
  const { work, root } = fixture()
  try {
    const excludes = [join(root, "skip")]
    const baseline = await scanFilesystem({
      root,
      workers: 1,
      topFiles: 5,
      policy: { keep: [], exclude: excludes },
    })
    for (const config of [
      { engine: "node-stream", workers: 1 },
      { engine: "rust", workers: 1, queueLimit: 1 },
      { engine: "rust", workers: 4, queueLimit: 1 },
      { engine: "rust", workers: 8, queueLimit: 16 },
    ]) {
      const output = join(work, `${config.engine}-${config.workers}.sqlite`)
      const result = await scanToDatabase({
        root,
        output,
        topFiles: 5,
        excludes,
        ...config,
      })
      assert.equal(result.status, "complete")
      assert.equal(result.bytes, baseline.directories[0].bytes)
      assert.equal(result.apparentBytes, baseline.directories[0].apparentBytes)
      assert.equal(result.files, baseline.files)
      assert.equal(result.directories, baseline.directories.length)
      assert.equal(result.skippedLinks, baseline.skippedLinks)
      assert.equal(result.issues, 0)
      assert.equal(result.excluded, 2)
      const view = inspectDatabase(output)
      assert.equal(view.partial, false)
      assert.equal(
        view.directory.ownBytes +
          view.children.reduce((sum, child) => sum + child.bytes, 0),
        result.bytes
      )
      assert.equal(inspectDatabase(output, 0, 2).children.length, 2)
      const { db, metadata } = read(output)
      try {
        assert.equal(metadata.status, "complete")
        const rows = db.prepare("SELECT * FROM directories").all()
        const ids = new Set(rows.map((r) => r.id))
        for (const row of rows) {
          assert.ok(
            row.id === 0
              ? row.parent === null
              : row.parent < row.id && ids.has(row.parent)
          )
          const top = JSON.parse(row.topFiles)
          assert.ok(top.length <= 5)
          assert.ok(top.every((f, i) => !i || top[i - 1].bytes >= f.bytes))
          assert.ok(top.reduce((s, f) => s + f.bytes, 0) <= row.ownBytes)
        }
        assert.equal(
          db.prepare("SELECT COUNT(*) AS n FROM hardlinks").get().n,
          1
        )
        const wide = rows.find((r) => r.name === "wide")
        assert.equal(wide.ownFiles, 160)
        // The largest regular files outrank the linked file regardless of
        // which worker claims the single hard-linked inode.
        assert.deepEqual(
          JSON.parse(wide.topFiles).map((f) => f.bytes),
          baseline.directories
            .find((r) => r.name === "wide")
            .topFiles.map((f) => f.bytes)
        )
        assert.equal(rows.find((r) => r.name === "skip").state, "excluded")
        assert.ok(rows.find((r) => r.name === "skip-sibling").ownBytes > 0)
        assert.equal(statSync(output).mode & 0o777, 0o600)
      } finally {
        db.close()
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test("queue saturation, deep paths, empty directories, and top-files=0", async () => {
  const { work, root } = fixture()
  try {
    let deep = root
    for (let i = 0; i < 80; i++) {
      deep = join(deep, "d")
      mkdirSync(deep)
    }
    writeFileSync(join(deep, "leaf"), "deep")
    for (const engine of ["node-stream", "rust"]) {
      const result = await scanToDatabase({
        root,
        output: join(work, `${engine}.sqlite`),
        engine,
        workers: 1,
        queueLimit: 1,
        topFiles: 0,
      })
      assert.equal(result.directories, 89)
      const { db } = read(join(work, `${engine}.sqlite`))
      try {
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM directories WHERE topFiles != '[]'"
            )
            .get().n,
          0
        )
      } finally {
        db.close()
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test("refuses symlink roots, overwrites, and self-counting output", async () => {
  const { work, root } = fixture()
  try {
    const link = join(work, "root-link")
    symlinkSync(root, link)
    await assert.rejects(
      scanToDatabase({ root: link, output: join(work, "link.sqlite") }),
      /symlink/
    )
    await assert.rejects(
      scanToDatabase({ root, output: join(root, "scan.sqlite") }),
      /outside/
    )
    const output = join(work, "existing.sqlite")
    writeFileSync(output, "keep")
    await assert.rejects(scanToDatabase({ root, output }), /EEXIST/)
    const inCache = join(root, ".whyfull/result.sqlite")
    assert.equal(
      (await scanToDatabase({ root, output: inCache })).status,
      "complete"
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test("persists received records on helper failure, rejects a missing summary, and handles cancellation", async () => {
  const { work, root } = fixture()
  try {
    const helper = join(work, "helper.mjs")
    // A helper that emits one valid completed directory, then dies. No claim
    // of resumability: the partial DB remains a useful inspectable artifact.
    writeFileSync(
      helper,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({kind:'start',protocol:1,root:process.argv[2]}));\nconsole.log(JSON.stringify({kind:'directory',id:0,parent:null,name:'root',ownBytes:0,ownApparentBytes:0,ownFiles:0,topFiles:[],skippedLinks:0,issues:0,state:'scanned',reason:null}));\nprocess.exit(7);\n`
    )
    chmodSync(helper, 0o700)
    const output = join(work, "failed.sqlite")
    await assert.rejects(
      scanToDatabase({ root, output, binary: helper }),
      /exited/
    )
    const { db, metadata } = read(output)
    try {
      assert.equal(metadata.status, "failed")
      assert.equal(metadata.directories, 1)
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM directories").get().n,
        1
      )
    } finally {
      db.close()
    }
    writeFileSync(
      helper,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({kind:'start',protocol:1,root:process.argv[2]}));\n`
    )
    await assert.rejects(
      scanToDatabase({
        root,
        output: join(work, "truncated.sqlite"),
        binary: helper,
      }),
      /without a summary/
    )
    await assert.rejects(
      scanToDatabase({
        root,
        output: join(work, "missing.sqlite"),
        binary: join(work, "missing-helper"),
      }),
      /ENOENT/
    )
    writeFileSync(
      helper,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({kind:'start',protocol:1,root:process.argv[2]}));\nconsole.log(JSON.stringify({kind:'progress',directories:0}));\nsetInterval(() => {}, 1000);\n`
    )
    const activeController = new AbortController()
    const activeOutput = join(work, "active-cancel.sqlite")
    await assert.rejects(
      scanToDatabase({
        root,
        output: activeOutput,
        binary: helper,
        signal: activeController.signal,
        onProgress: () => activeController.abort(),
      }),
      /cancelled/
    )
    const active = read(activeOutput)
    assert.equal(active.metadata.status, "cancelled")
    active.db.close()
    for (const engine of ["rust", "node-stream"]) {
      const controller = new AbortController()
      controller.abort()
      const output = join(work, `cancel-${engine}.sqlite`)
      await assert.rejects(
        scanToDatabase({
          root,
          output,
          engine,
          workers: 1,
          signal: controller.signal,
        }),
        /cancelled/
      )
      const { db, metadata } = read(output)
      assert.equal(metadata.status, "cancelled")
      db.close()
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
