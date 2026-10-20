import test from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { once } from "node:events"
import { createInterface } from "node:readline"
const runtime = fileURLToPath(new URL("../src-tauri/runtime/", import.meta.url))
const node = join(runtime, process.platform === "win32" ? "node.exe" : "node")
const cli = join(runtime, "engine/cli.mjs")

test("bundled runtime supports help and forwards CLI errors", () => {
  const help = spawnSync(node, [cli, "--help"], { encoding: "utf8" })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /where did my disk go/)
  const error = spawnSync(node, [cli, "--invalid-flag"], { encoding: "utf8" })
  assert.equal(error.status, 2)
})

test("packaged workers scan paths with spaces and produce a valid snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whyfull desktop "))
  try {
    await writeFile(join(directory, "file.txt"), "disk usage")
    await mkdir(join(directory, "nested"))
    await writeFile(join(directory, "nested", "second.txt"), "more data")
    const result = spawnSync(
      node,
      [cli, "--scan", "--root", directory, "--json", "--workers", "2"],
      { encoding: "utf8", timeout: 20000 }
    )
    assert.equal(result.status, 0, result.stderr)
    const snapshot = JSON.parse(result.stdout)
    assert.equal(snapshot.status, "complete")
    assert.equal(snapshot.files, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test(
  "desktop readiness, authenticated viewer and cleanup on parent disconnect",
  { timeout: 30000 },
  async () => {
    const child = spawn(node, [join(runtime, "desktop.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (data) => {
      stderr += data
    })
    try {
      const reader = createInterface({ input: child.stdout })
      const [line] = await once(reader, "line")
      const { url } = JSON.parse(line)
      const location = new URL(url)
      assert.equal(location.hostname, "127.0.0.1")
      assert.match(location.hash, /^#[a-f0-9]{64}$/)
      assert.equal((await fetch(location.origin)).status, 200)
      assert.equal((await fetch(`${location.origin}/api/status`)).status, 401)
      const response = await fetch(`${location.origin}/api/status`, {
        headers: { Authorization: `Bearer ${location.hash.slice(1)}` },
      })
      assert.equal(response.status, 200)
      assert.ok((await response.json()).root)
      const closed = once(child, "exit")
      child.stdin.end()
      const [code] = await closed
      assert.equal(code, 0, stderr)
      await assert.rejects(fetch(location.origin))
    } finally {
      child.kill()
    }
  }
)
