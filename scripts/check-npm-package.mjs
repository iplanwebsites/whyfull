#!/usr/bin/env node

// Exercise the published layout without access to workspace node_modules.
import assert from "node:assert/strict"
import { spawn, execFile } from "node:child_process"
import { once } from "node:events"
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const root = fileURLToPath(new URL("../", import.meta.url))
const run = promisify(execFile)
const temporary = await realpath(await mkdtemp(join(tmpdir(), "whyfull-npm-")))
// Execute npm's JS entry points on Windows; .cmd shims need a shell.
const windows = process.platform === "win32"
const npmBin = join(dirname(process.execPath), "node_modules/npm/bin")
const npm = windows ? process.execPath : "npm"
const npx = windows ? process.execPath : "npx"
const npmArgs = windows ? [join(npmBin, "npm-cli.js")] : []
const npxArgs = windows ? [join(npmBin, "npx-cli.js")] : []
const env = { ...process.env, npm_config_cache: join(temporary, "npm-cache") }
// An outer `npm exec --package=...` must not select this consumer's command.
delete env.npm_config_package
let child, closed

try {
  const meta = JSON.parse(
    await readFile(join(root, "packages/whyfull/package.json"), "utf8")
  )
  const artifacts = join(root, ".artifacts/npm")
  await mkdir(artifacts, { recursive: true })
  let tarball = process.argv[2] && resolve(process.argv[2])
  if (!tarball) {
    console.log("Building and packing the npm release…")
    await run(npm, [...npmArgs, "pack", "--pack-destination", artifacts], {
      cwd: join(root, "packages/whyfull"),
      env,
      timeout: 120000,
    })
    tarball = join(artifacts, `whyfull-${meta.version}.tgz`)
  }
  const consumer = join(temporary, "consumer")
  const fixture = join(temporary, "fixture")
  await mkdir(consumer)
  await mkdir(fixture)
  await writeFile(join(consumer, "package.json"), '{"private":true}')
  await writeFile(join(fixture, "sample.txt"), "npm viewer smoke test")
  console.log("Installing the tarball in an isolated consumer…")
  await run(
    npm,
    [
      ...npmArgs,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: consumer, env, timeout: 120000 }
  )
  const installed = join(consumer, "node_modules/whyfull")
  const assets = JSON.parse(
    await readFile(join(installed, "dist/viewer/assets.json"), "utf8")
  )
  assert.ok(assets["/"], "tarball includes the UI shell")
  assert.ok(Object.keys(assets).some((path) => path.endsWith(".js")))
  assert.ok(Object.keys(assets).some((path) => path.endsWith(".css")))
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "linux"
        ? "xdg-open"
        : null
  const browserLog = join(temporary, "browser.json")
  if (opener) {
    const bin = join(temporary, "bin")
    await mkdir(bin)
    // Observe the opener without launching a real browser during automated checks.
    await writeFile(
      join(bin, opener),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(browserLog)}, JSON.stringify(process.argv.slice(2)))\n`,
      { mode: 0o700 }
    )
    env.PATH = `${bin}${delimiter}${env.PATH}`
  }
  let output = ""
  child = spawn(
    npx,
    [
      ...npxArgs,
      "--offline",
      "--no-install",
      "whyfull",
      "--view",
      ...(opener ? [] : ["--no-open"]),
      "--root",
      fixture,
      "--workers",
      "1",
      "--config",
      join(temporary, "config.json"),
    ],
    {
      cwd: consumer,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  closed = once(child, "close")
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  const deadline = Date.now() + 20000
  let match
  while (
    !(match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/))
  ) {
    assert.equal(child.exitCode, null, `Viewer exited: ${output}`)
    assert.ok(Date.now() < deadline, `Viewer did not start: ${output}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const url = new URL(match[0])
  for (const [path, asset] of Object.entries(assets)) {
    const response = await fetch(new URL(path, url), {
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 200, `serves ${path}`)
    assert.equal(response.headers.get("content-type"), asset.type)
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      await readFile(join(installed, "dist/viewer", asset.file)),
      `serves the packaged bytes for ${path}`
    )
  }
  const headers = { Authorization: `Bearer ${url.hash.slice(1)}` }
  let status
  do {
    const response = await fetch(new URL("/api/status", url), {
      headers,
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 200)
    status = await response.json()
    assert.ok(Date.now() < deadline, "packaged filesystem worker completes")
    if (status.status === "scanning")
      await new Promise((resolve) => setTimeout(resolve, 50))
  } while (status.status === "scanning")
  assert.equal(status.root, fixture)
  assert.equal(status.status, "complete")
  assert.equal(status.files, 1)
  assert.equal(status.cleanup.mode, "demo")
  if (opener) {
    let opened
    while (!opened) {
      try {
        opened = JSON.parse(await readFile(browserLog, "utf8"))
      } catch (error) {
        if (error.code !== "ENOENT") throw error
        assert.ok(Date.now() < deadline, "default browser opener is invoked")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    assert.deepEqual(opened, [url.href])
  }
  console.log(
    `Verified npx whyfull --view: server, ${Object.keys(assets).length} UI assets, filesystem worker${opener ? ", and default browser opener" : ""}.`
  )
  console.log(`Release tarball: ${tarball}`)
} finally {
  if (child?.pid && child.exitCode === null) {
    if (process.platform === "win32")
      await run("taskkill", ["/pid", String(child.pid), "/t", "/f"])
    else process.kill(-child.pid, "SIGTERM")
    await closed
  }
  await rm(temporary, { recursive: true, force: true })
}
