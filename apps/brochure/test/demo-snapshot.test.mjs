import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadDiskSnapshot } from "../../../packages/whyfull/dist/index.mjs"
import { createDemoSnapshot } from "../../../scripts/demo-snapshot.mjs"

test("screenshot inventory is deterministic and imports into the real viewer", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "whyfull-demo-test-"))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = join(temporary, "example-account")
  const snapshot = createDemoSnapshot(root)
  assert.deepEqual(snapshot, createDemoSnapshot(root))
  assert.equal(snapshot.directories[0].name, "Home")
  assert.equal(snapshot.directories.length, 76)
  assert.equal(snapshot.status, "complete")
  assert.deepEqual(snapshot.policy, { keep: [], exclude: [] })
  const path = join(temporary, "snapshot.json")
  await writeFile(path, JSON.stringify(snapshot))
  const loaded = await loadDiskSnapshot(path)
  assert.equal(loaded.root, root)
  assert.equal(loaded.directories[0].bytes, snapshot.directories[0].bytes)

  for (const directory of loaded.directories) {
    assert.ok(
      directory.path === root ||
        directory.path.startsWith(root + "/") ||
        directory.path.startsWith(root + "\\")
    )
    assert.equal(
      directory.bytes,
      directory.ownBytes +
        directory.children.reduce(
          (sum, id) => sum + loaded.directories[id].bytes,
          0
        )
    )
    assert.equal(
      directory.files,
      directory.ownFiles +
        directory.children.reduce(
          (sum, id) => sum + loaded.directories[id].files,
          0
        )
    )
  }
  assert.ok(
    loaded.directories.some(
      (entry) => entry.path === join(root, "Code", "ml-playground")
    )
  )
  assert.ok(
    loaded.directories.some(
      (entry) => entry.path === join(root, ".npm", "_cacache")
    )
  )
})

test("the demo generator rejects relative roots", () => {
  assert.throws(() => createDemoSnapshot("relative/home"), /absolute path/)
})
