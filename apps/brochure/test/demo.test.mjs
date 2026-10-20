import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { loadDiskSnapshot } from "../../../packages/whyfull/src/disk-snapshot.ts"

test("fictional demo imports into the real viewer with consistent inventory totals", async () => {
  const data = await loadDiskSnapshot(
    fileURLToPath(new URL("../src/demo-snapshot.json", import.meta.url))
  )
  assert.equal(data.root, "/Example")
  assert.equal(data.directories[0].bytes, 320 * 1024 ** 3)
  for (const directory of data.directories) {
    assert.ok(
      directory.path === "/Example" || directory.path.startsWith("/Example/")
    )
    assert.equal(
      directory.bytes,
      directory.ownBytes +
        directory.children.reduce(
          (sum, id) => sum + data.directories[id].bytes,
          0
        )
    )
    assert.equal(
      directory.files,
      directory.ownFiles +
        directory.children.reduce(
          (sum, id) => sum + data.directories[id].files,
          0
        )
    )
  }
})
