import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, delimiter } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { pathToFileURL } from "node:url"
import { CLI_LICENSE_NOTICE, ScanCache, startViewer } from "../dist/index.mjs"

const cli = new URL("../dist/cli.mjs", import.meta.url)

test("headless full scan is preloaded by the viewer from the shared cache", async (t) => {
  const area = mkdtempSync(join(tmpdir(), "whyfull-shared-scan-"))
  const root = join(area, "root")
  mkdirSync(root)
  writeFileSync(join(root, "payload"), "hello")
  const policyFile = join(area, "config.json")
  t.after(() => rmSync(area, { recursive: true, force: true }))
  run(["--scan", "--root", root, "--config", policyFile])
  const cache = ScanCache.forConfig(policyFile)
  assert.equal(await cache.latestRoot(), realpathSync(root))
  const pointer = JSON.parse(
    readFileSync(join(area, "scans", "latest.json"), "utf8")
  )
  assert.equal(pointer.path, cache.path(realpathSync(root)))
  const viewer = await startViewer({
    root,
    policyFile,
    scanOnStart: false,
    open: false,
  })
  t.after(() => viewer.close())
  assert.equal(viewer.snapshot.status, "complete")
  assert.equal(viewer.snapshot.files, 1)
  const child = spawn(
    process.execPath,
    [cli.pathname, "--ui", "--no-open", "--config", policyFile],
    { stdio: ["ignore", "pipe", "pipe"] }
  )
  t.after(() => child.kill())
  let output = ""
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output)), 10000)
    child.stdout.on("data", (chunk) => {
      output += chunk.toString()
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#\w+/)
      if (match) {
        clearTimeout(timer)
        resolve(new URL(match[0]))
      }
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`viewer exited ${code}: ${output}`))
    })
  })
  const response = await fetch(`${url.origin}/api/status`, {
    headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
  })
  const status = await response.json()
  assert.equal(status.root, realpathSync(root))
  assert.ok(
    status.cache.refreshing || status.revision > 0,
    "normal UI startup refreshes the latest saved inventory in the background"
  )
  if (status.cache.refreshing) assert.equal(status.cache.restored, true)
})
function run(args, options = {}) {
  return execFileSync(process.execPath, [cli.pathname, ...args], {
    encoding: "utf8",
    timeout: 20000,
    ...options,
  })
}
// Exercise the real prompt library with keypresses; do not mock its selection.
function menu(t, env = process.env, cwd) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    process.stdin.isTTY = true;
    process.stdin.setRawMode = () => {};
    process.stdout.isTTY = true;
    process.stdout.columns = 120;
    process.stdout.rows = 40;
    await import(${JSON.stringify(cli.href)});
  `,
    ],
    { env, cwd }
  )
  const closed = new Promise((resolve) => child.once("close", resolve))
  let output = ""
  const listeners = new Set()
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output += stripVTControlCharacters(data.toString())
      for (const listener of listeners) listener()
    })
  child.on("exit", () => {
    for (const listener of listeners) listener()
  })
  t.after(() => {
    child.kill()
    child.stdin.destroy()
  })
  return {
    child,
    closed,
    send: (keys) => child.stdin.write(keys),
    output: () => output,
    waitFor: (pattern) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check)
          reject(
            new Error(
              `Timed out waiting for ${pattern}: ${output.slice(-2000)}`
            )
          )
        }, 10000)
        function check() {
          if (pattern.test(output)) {
            clearTimeout(timer)
            listeners.delete(check)
            resolve(output)
          } else if (child.exitCode !== null) {
            clearTimeout(timer)
            listeners.delete(check)
            reject(
              new Error(`CLI exited before ${pattern}: ${output.slice(-2000)}`)
            )
          }
        }
        listeners.add(check)
        check()
      }),
  }
}

test("bare noninteractive command prints actionable help without scanning", () => {
  const out = run([])
  assert.match(out, /interactive picker/)
  for (const flag of [
    "--ui",
    "--tui",
    "--json",
    "--json-file",
    "--scan",
    "--no-scan",
    "--no-cache",
  ])
    assert.ok(out.includes(flag), flag)
  assert.match(out, /Examples for scripts and agents/)
  assert.doesNotMatch(out, /Scanned |Choose \[/)
  assert.ok(out.includes(CLI_LICENSE_NOTICE), "help names the license terms")
})

test("keyboard selector updates command hints and runs help with Enter", async (t) => {
  const prompt = menu(t)
  await prompt.waitFor(/npx whyfull --ui/)
  assert.match(prompt.output(), /Disk (?:\d{1,3}% full|usage unavailable)/)
  assert.match(prompt.output(), /↑\/↓ to move · Enter to select/)
  assert.ok(prompt.output().includes(CLI_LICENSE_NOTICE), "picker notice")
  assert.doesNotMatch(prompt.output(), /1\. |Choose \[/)
  assert.doesNotMatch(prompt.output(), /npx whyfull --ui --no-scan/)
  prompt.send("\x1b[B")
  await prompt.waitFor(/npx whyfull --ui --directory/)
  prompt.send("\x1b[B")
  await prompt.waitFor(/npx whyfull --ui --no-scan/)
  prompt.send("\x1b[B")
  await prompt.waitFor(/npx whyfull --tui/)
  prompt.send("\x1b[B")
  await prompt.waitFor(/npx whyfull --tui --json-file <new-file.json>/)
  prompt.send("\x1b[B".repeat(3))
  await prompt.waitFor(/npx whyfull --help/)
  prompt.send("\r")
  await prompt.waitFor(/Examples for scripts and agents/)
})

test("keyboard selector supports Escape, Ctrl+C, and selecting Quit", async (t) => {
  for (const keys of ["\x1b", "\x03", "\x1b[A\r"]) {
    const prompt = menu(t)
    await prompt.waitFor(/Choose an action/)
    prompt.send(keys)
    await prompt.waitFor(/See you next time/)
    assert.doesNotMatch(prompt.output(), /Local disk explorer/)
  }
})

test("JSON selection validates the destination and saves the opportunity report", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-menu-save-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const preload = join(root, "slow-command.mjs")
  // Stall the selected command's event loop, while the parent must keep animating.
  writeFileSync(
    preload,
    `if (process.argv[1]?.endsWith('cli.mjs')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
`
  )
  const prompt = menu(t, {
    PATH: process.env.PATH,
    HOME: root,
    NO_COLOR: "1",
    NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(preload).href)}`,
  })
  await prompt.waitFor(/Choose an action/)
  prompt.send("\x1b[B".repeat(4) + "\r")
  await prompt.waitFor(/Save to a new JSON file/)
  prompt.send("\r")
  await prompt.waitFor(/Enter a file path/)
  const path = join(root, "opportunity report.json")
  prompt.send(path + "\r")
  await prompt.waitFor(/Running: npx whyfull --tui --json-file/)
  await prompt.waitFor(/Scanning for cleanup opportunities/)
  assert.doesNotMatch(prompt.output(), /Opportunity report ready/)
  await prompt.waitFor(/Saved JSON to/)
  assert.match(prompt.output(), /Opportunity report ready/)
  assert.ok(
    (prompt.output().match(/Scanning for cleanup opportunities/g) ?? [])
      .length >= 2,
    "the parent keeps refreshing progress while the selected command is blocked"
  )
  assert.equal(JSON.parse(readFileSync(path, "utf8")).format, "whyfull-report")
  assert.ok(prompt.output().includes(`npx whyfull --tui --json-file '${path}'`))
})

test("a selected command reports failures and preserves its exit status", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-menu-error-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, "existing.json")
  writeFileSync(path, "keep this file")
  const prompt = menu(t, { PATH: process.env.PATH, HOME: root, NO_COLOR: "1" })
  await prompt.waitFor(/Choose an action/)
  prompt.send("\x1b[B".repeat(4) + "\r")
  await prompt.waitFor(/Save to a new JSON file/)
  prompt.send(path + "\r")
  await prompt.waitFor(/refusing to overwrite/)
  assert.equal(await prompt.closed, 2)
  assert.equal(readFileSync(path, "utf8"), "keep this file")
  assert.match(prompt.output(), /The command could not finish/)
})

test(
  "Enter on the default action starts the server and opens its URL in the browser",
  {
    skip:
      process.platform === "win32" &&
      "browser opener fixture uses a POSIX executable",
  },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "whyfull-menu-ui-"))
    const bin = join(root, "bin")
    mkdirSync(bin)
    const log = join(root, "browser.json")
    writeFileSync(
      join(bin, process.platform === "darwin" ? "open" : "xdg-open"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)))\n`,
      { mode: 0o700 }
    )
    const prompt = menu(t, {
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      HOME: root,
      NO_COLOR: "1",
    })
    t.after(() => rmSync(root, { recursive: true, force: true }))
    await prompt.waitFor(/Choose an action/)
    prompt.send("\r")
    await prompt.waitFor(/Local disk explorer/)
    let opened
    for (let i = 0; i < 100; i++) {
      try {
        opened = JSON.parse(readFileSync(log, "utf8"))
        break
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.ok(opened, "the browser opener was invoked automatically")
    const url = new URL(opened[0])
    assert.equal(url.hostname, "127.0.0.1")
    const response = await fetch(`${url.origin}/api/status`, {
      headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
    })
    assert.equal(
      response.status,
      200,
      "the server is ready when the browser opens"
    )
    assert.equal((await response.json()).awaitingScan, false)
    assert.match(prompt.output(), /Running: npx whyfull --ui/)
    assert.match(prompt.output(), /Local web UI ready/)
    // Stopping the menu process must also stop the selected server process.
    const closed = new Promise((resolve) => prompt.child.once("close", resolve))
    prompt.child.kill("SIGTERM")
    await closed
    await assert.rejects(
      fetch(`${url.origin}/api/status`, {
        headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
      })
    )
  }
)

test("UI aliases accept help and reject incompatible formats before starting a server", () => {
  for (const args of [["--ui"], ["--view"], ["ui"], ["app"]]) {
    const help = run([...args, "--help"])
    assert.match(help, /--no-scan/)
    assert.ok(help.includes(CLI_LICENSE_NOTICE), "viewer help notice")
    for (const format of ["--tui", "--json"]) {
      assert.throws(
        () => run([...args, format]),
        (error) => {
          assert.equal(error.status, 2)
          assert.match(error.stderr, /choose --ui, --tui, or --json/)
          return true
        }
      )
    }
  }
  assert.throws(() => run(["--no-scan"]), /requires --ui/)
})

test("terminal summary and opportunity JSON saves work without prompting", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-cli-"))
  const options = {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: root, NO_COLOR: "1" },
  }
  const flags = ["--no-worktrees", "--no-cache-scan", "--no-drill"]
  try {
    const path = join(root, "opportunities.json")
    const text = run(["--tui", ...flags, "--json-file", path], options)
    assert.match(text, /Scanned /)
    assert.doesNotMatch(text, /Choose \[/)
    assert.ok(text.includes(CLI_LICENSE_NOTICE), "terminal report footer")
    const saved = readFileSync(path, "utf8")
    assert.equal(JSON.parse(saved).format, "whyfull-report")
    // Machine output never carries the human-facing license notice.
    const stdout = run(["--json", ...flags], options)
    assert.equal(JSON.parse(stdout).format, "whyfull-report")
    for (const machine of [saved, stdout]) {
      assert.ok(!machine.includes(CLI_LICENSE_NOTICE))
      assert.doesNotMatch(
        machine,
        /Free for command-line use|whyfull\.app\/legal/
      )
    }
    assert.ok(stdout.startsWith("{") && stdout.endsWith("}\n"))
    assert.throws(
      () => run(["--tui", ...flags, "--json-file", path], options),
      /refusing to overwrite/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("full filesystem scans still save machine-readable snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "whyfull-cli-disk-"))
  try {
    const path = join(root, "disk.json")
    const output = run([
      "--scan",
      "--root",
      root,
      "--workers",
      "1",
      "--no-cache",
      "--json",
      "--json-file",
      path,
    ])
    const snapshot = JSON.parse(output)
    assert.ok(!output.includes(CLI_LICENSE_NOTICE), "no notice in --json")
    assert.equal(snapshot.format, "whyfull-disk")
    assert.equal(snapshot.status, "complete")
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), snapshot)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("UI-only startup waits for an explicit scan and cached startup does not refresh", async () => {
  const { startViewer } = await import("../dist/index.mjs")
  const { realpathSync, writeFileSync } = await import("node:fs")
  const root = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-ui-idle-")))
  const options = {
    root,
    open: false,
    workers: 1,
    scanOnStart: false,
    policyFile: join(root, "config.json"),
    drives: () => [{ id: root, name: "Fixture", default: true, volume: null }],
  }
  let viewer
  try {
    writeFileSync(join(root, "sample"), "sample data")
    viewer = await startViewer(options)
    let url = new URL(viewer.url)
    const get = async () =>
      (
        await fetch(`${url.origin}/api/status`, {
          headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
        })
      ).json()
    let status = await get()
    assert.equal(status.awaitingScan, true)
    assert.equal(status.files, 0)
    const response = await fetch(`${url.origin}/api/rescan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${url.hash.slice(1)}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    assert.equal(response.status, 200)
    for (let i = 0; i < 100; i++) {
      status = await get()
      if (status.status === "complete") break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(status.awaitingScan, false)
    assert.equal(status.status, "complete")
    assert.ok(status.files >= 1)
    await viewer.close()
    viewer = await startViewer(options)
    url = new URL(viewer.url)
    status = await get()
    assert.equal(status.status, "complete")
    assert.equal(status.cache.restored, true)
    assert.equal(status.cache.refreshing, false)
    assert.equal(status.awaitingScan, false)
  } finally {
    await viewer?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test("starter includes scoped directory actions and exports the current directory without another root prompt", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "whyfull-starter-folder-"))
  const root = join(base, "project")
  mkdirSync(root)
  writeFileSync(join(root, "data"), "project data")
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const prompt = menu(
    t,
    { PATH: process.env.PATH, HOME: base, NO_COLOR: "1" },
    root
  )
  await prompt.waitFor(/Choose an action/)
  assert.match(prompt.output(), /Open current directory/)
  prompt.send("\x1b[B".repeat(5))
  await prompt.waitFor(/npx whyfull --scan --directory --json-file/)
  prompt.send("\r")
  await prompt.waitFor(/Save to a new JSON file/)
  const file = join(base, "folder.json")
  prompt.send(file + "\r")
  await prompt.waitFor(/Scan results ready/)
  assert.equal(await prompt.closed, 0)
  const report = JSON.parse(readFileSync(file, "utf8"))
  const { realpathSync, existsSync } = await import("node:fs")
  assert.equal(report.root, realpathSync(root))
  assert.equal(report.files, 1)
  assert.equal(existsSync(join(root, ".whyfull", "inventories")), true)
  assert.doesNotMatch(prompt.output(), /Folder or disk to scan/)
})
