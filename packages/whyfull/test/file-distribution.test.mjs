import { test } from "node:test"
import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  statSync,
  rmSync,
  realpathSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createFileDistribution,
  addFileSize,
  measureFileDistribution,
  scanFilesystem,
  startViewer,
} from "../dist/index.mjs"
const MiB = 1024 ** 2,
  GiB = 1024 ** 3

test("distribution distinguishes tiny sidecars, typical photos, and a giant outlier", () => {
  const result = createFileDistribution()
  addFileSize(result, 512)
  for (let i = 0; i < 1000; i++) addFileSize(result, 20 * MiB)
  addFileSize(result, GiB)
  assert.equal(result.files, 1002)
  assert.deepEqual(
    result.buckets.map((bucket) => bucket.files),
    [1, 0, 1000, 0, 1, 0]
  )
  assert.equal(result.largestBytes, GiB)
  assert.equal(result.averageBytes, (512 + 1000 * 20 * MiB + GiB) / 1002)
  assert.equal(
    result.buckets.reduce((sum, bucket) => sum + bucket.bytes, 0),
    result.bytes
  )
  const sparse = createFileDistribution()
  addFileSize(sparse, GiB, 4096)
  assert.equal(
    sparse.buckets[4].files,
    1,
    "classifies logical size even for a sparse file"
  )
  assert.equal(sparse.bytes, 4096, "space remains allocated bytes")
  assert.equal(sparse.averageBytes, GiB)
  assert.throws(() => addFileSize(sparse, -1))
})
test("size buckets have exact boundaries and handle empty and zero-byte files", () => {
  const result = createFileDistribution()
  assert.equal(result.averageBytes, 0)
  for (const size of [0, MiB - 1, MiB, 10 * MiB, 100 * MiB, GiB, 10 * GiB])
    addFileSize(result, size)
  assert.deepEqual(
    result.buckets.map((bucket) => bucket.files),
    [2, 1, 1, 1, 1, 1]
  )
})
test("measurement reads direct metadata and an inventory-authorized endpoint supports old snapshots", async () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "whyfull-distribution-"))
  )
  let viewer
  try {
    writeFileSync(join(root, "photo"), Buffer.alloc(8192))
    writeFileSync(join(root, "sidecar"), "x")
    mkdirSync(join(root, "child"))
    writeFileSync(
      join(root, "child", "nested"),
      "excluded from direct distribution"
    )
    symlinkSync(join(root, "photo"), join(root, "link"))
    const result = await measureFileDistribution(root)
    assert.equal(result.files, 2)
    assert.equal(result.logicalBytes, 8193)
    assert.equal(
      result.bytes,
      (statSync(join(root, "photo")).blocks +
        statSync(join(root, "sidecar")).blocks) *
        512
    )
    assert.ok(result.measuredAt)
    await assert.rejects(
      measureFileDistribution(root, AbortSignal.abort()),
      /cancelled/
    )
    const snapshot = await scanFilesystem({ root, workers: 1 })
    viewer = await startViewer({
      root,
      snapshot,
      open: false,
      policyFile: join(root, "preferences.json"),
    })
    const url = new URL(viewer.url),
      headers = {
        Authorization: `Bearer ${url.hash.slice(1)}`,
        "Content-Type": "application/json",
      }
    const post = (body, auth = headers) =>
      fetch(`${url.origin}/api/file-distribution`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      })
    assert.equal((await post({ id: "d0" }, {})).status, 401)
    assert.equal((await post({ id: "f0-0" })).status, 400)
    assert.equal((await post({ id: "d999999" })).status, 400)
    const response = await post({ id: "d0", path: "/etc" })
    assert.equal(response.status, 200)
    assert.equal(
      (await response.json()).files,
      2,
      "ignores arbitrary client paths"
    )
    assert.equal(
      viewer.snapshot,
      snapshot,
      "measurement does not replace the saved inventory"
    )
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
