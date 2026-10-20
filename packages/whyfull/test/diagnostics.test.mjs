import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DiagnosticRunner,
  diagnosticCommands,
  reportArguments,
  buildJsonReport,
} from "../dist/index.mjs"
const command = (id, script, timeoutMs = 5000) => ({
  id,
  label: id,
  executable: process.execPath,
  args: ["-e", script],
  timeoutMs,
})
async function finished(runner) {
  for (let i = 0; i < 300; i++) {
    if (!runner.status().running) return runner.status()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Diagnostic did not finish")
}
test("diagnostics run fixed IDs, retain stdout/stderr and exit codes, and bound output", async () => {
  const runner = new DiagnosticRunner([
    command(
      "success",
      'process.stdout.write("out\\n"); process.stderr.write("err\\n")'
    ),
    command(
      "failure",
      'process.stderr.write("failure\\n"); process.exitCode = 7'
    ),
    command("large", 'process.stdout.write("x".repeat(500000))'),
    {
      id: "missing",
      label: "missing",
      executable: "/nonexistent/whyfull-command",
      args: [],
      timeoutMs: 5000,
    },
  ])
  assert.throws(() => runner.run("df; rm -rf /"), /available/)
  runner.run("success")
  assert.throws(() => runner.run("failure"), /current/)
  let result = await finished(runner)
  assert.equal(result.runs[0].status, "complete")
  assert.equal(result.runs[0].exitCode, 0)
  assert.match(result.runs[0].trace, /out/)
  assert.match(result.runs[0].trace, /err/)
  runner.run("failure")
  result = await finished(runner)
  assert.equal(result.runs[1].status, "failed")
  assert.equal(result.runs[1].exitCode, 7)
  runner.run("large")
  result = await finished(runner)
  assert.equal(result.runs[2].trace.length, 256 * 1024)
  assert.equal(result.runs[2].truncated, true)
  runner.run("missing")
  result = await finished(runner)
  assert.equal(result.runs[3].status, "failed")
  assert.match(result.runs[3].trace, /ENOENT/)
  assert.equal(
    result.runs.length,
    4,
    "switching commands retains earlier traces"
  )
  assert.ok(diagnosticCommands().some((item) => item.id === "whyfull"))
})
test("diagnostics support cancellation and timeouts", async () => {
  const runner = new DiagnosticRunner([
    command("wait", "setTimeout(() => {}, 10000)"),
    command("timeout", "setTimeout(() => {}, 10000)", 40),
  ])
  try {
    runner.run("wait")
    runner.cancel()
    assert.equal((await finished(runner)).runs[0].status, "cancelled")
    runner.run("timeout")
    const result = await finished(runner)
    assert.equal(result.runs[1].status, "failed")
    assert.match(result.runs[1].trace, /timed out/)
  } finally {
    runner.cancel()
  }
})

test("CLI opens home by default and exposes only fixed diagnostic commands over authenticated HTTP", async () => {
  const { spawn } = await import("node:child_process")
  const { mkdtempSync, realpathSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const { once } = await import("node:events")
  const root = realpathSync(mkdtempSync(join(tmpdir(), "whyfull-home-")))
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../dist/cli.mjs", import.meta.url)),
      "--view",
      "--no-open",
      "--config",
      join(root, "config.json"),
    ],
    {
      env: { ...process.env, HOME: root, USERPROFILE: root },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  const closed = once(child, "close")
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Viewer did not start")),
        10000
      )
      let output = ""
      child.stdout.on("data", (chunk) => {
        output += chunk
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})/)
        if (match) {
          clearTimeout(timer)
          resolve(new URL(match[0]))
        }
      })
      child.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    const headers = {
      Authorization: `Bearer ${url.hash.slice(1)}`,
      "Content-Type": "application/json",
    }
    const status = await (
      await fetch(`${url.origin}/api/status`, { headers })
    ).json()
    assert.equal(status.root, root)
    assert.equal(status.homeDirectory, root)
    assert.equal(status.cleanup.mode, "demo")
    const commands = await (
      await fetch(`${url.origin}/api/diagnostics`, { headers })
    ).json()
    assert.ok(commands.commands.some((item) => item.id === "whyfull"))
    assert.equal((await fetch(`${url.origin}/api/diagnostics`)).status, 401)
    const runReport = await fetch(`${url.origin}/api/diagnostics`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "run",
        id: "whyfull",
        options: { top: 3, exact: false, caches: false, worktrees: false },
      }),
    })
    assert.equal(runReport.status, 200)
    let generated
    for (let i = 0; i < 1200; i++) {
      const state = await (
        await fetch(`${url.origin}/api/diagnostics`, { headers })
      ).json()
      generated = state.runs.find((run) => run.id === "whyfull")
      if (!state.running) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(generated.status, "complete", generated.trace)
    assert.equal(generated.reportAvailable, true)
    const opened = await fetch(`${url.origin}/api/diagnostics/report`, {
      method: "POST",
      headers,
      body: JSON.stringify({ startedAt: generated.startedAt }),
    })
    assert.equal(opened.status, 200)
    assert.equal((await opened.json()).source.kind, "report")
    const report = await (
      await fetch(`${url.origin}/api/report`, { headers })
    ).json()
    assert.equal(report.options.top, 3)
    assert.equal(report.options.cacheScan, false)
    assert.equal(report.options.worktrees, false)

    const invalid = await fetch(`${url.origin}/api/diagnostics`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "run",
        id: "echo bad",
        executable: "/bin/sh",
      }),
    })
    assert.equal(invalid.status, 400)
    const home = await fetch(`${url.origin}/api/scan-root`, {
      method: "POST",
      headers,
      body: JSON.stringify({ root }),
    })
    assert.equal(
      home.status,
      200,
      "Home is available independently of mounted drives"
    )
  } finally {
    child.kill("SIGTERM")
    await closed
    rmSync(root, { recursive: true, force: true })
  }
})

test("report options produce fixed CLI arguments and completed JSON becomes a report, not raw trace", async () => {
  assert.deepEqual(
    reportArguments({ top: 12, exact: true, caches: false, worktrees: false }),
    ["--json", "--top", "12", "--exact", "--no-cache-scan", "--no-worktrees"]
  )
  for (const top of [-1, 101, 1.5, "5; echo bad"])
    assert.throws(
      () =>
        reportArguments({ top, exact: false, caches: true, worktrees: false }),
      /options/
    )
  assert.throws(
    () =>
      reportArguments({ top: 5, exact: "yes", caches: true, worktrees: false }),
    /options/
  )
  const report = buildJsonReport({
    report: {
      platform: process.platform,
      volume: null,
      targets: [],
      denied: 0,
      partial: 0,
      exact: false,
      total: 0,
      generatedAt: new Date().toISOString(),
    },
    options: {},
    durationMs: 1,
  })
  const runner = new DiagnosticRunner([
    {
      ...command(
        "report",
        `process.stdout.write(${JSON.stringify(JSON.stringify(report))})`
      ),
      report: true,
    },
    {
      ...command("invalid", 'process.stdout.write("not a report")'),
      report: true,
    },
  ])
  runner.run("report")
  assert.throws(() => runner.report("old run"), /complete/)
  const run = (await finished(runner)).runs[0]
  assert.equal(run.reportAvailable, true)
  assert.deepEqual(runner.report(run.startedAt), report)
  assert.match(run.trace, /Report ready/)
  assert.doesNotMatch(run.trace, /schemaVersion/)
  runner.run("invalid")
  const failed = (await finished(runner)).runs[1]
  assert.equal(failed.status, "failed")
  assert.equal(failed.reportAvailable, false)
  assert.throws(() => runner.report(run.startedAt), /complete/)
})
