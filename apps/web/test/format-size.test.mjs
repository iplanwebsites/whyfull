import { test } from "node:test"
import assert from "node:assert/strict"
import { formatSize } from "../src/lib/format-size.ts"
const GiB = 1024 ** 3,
  TiB = 1024 ** 4

test("size precision follows the visible scale and drops small-unit decimals", () => {
  assert.equal(formatSize(17.79 * 1024 ** 2), "18 MiB")
  assert.equal(formatSize(3.24 * GiB, 40 * GiB), "3.2 GiB")
  assert.equal(formatSize(3.24 * GiB, TiB), "3 GiB")
  assert.equal(formatSize(137.24 * GiB), "137 GiB")
  assert.equal(formatSize(1.26 * TiB), "1.3 TiB")
  assert.equal(formatSize(127), "127 B")
  assert.equal(formatSize(undefined), "0 B")
  assert.equal(formatSize(0.12 * GiB, 2 * TiB), "123 MiB")
})
