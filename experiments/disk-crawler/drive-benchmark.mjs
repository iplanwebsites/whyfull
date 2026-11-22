/** Balanced full-drive comparison. Run explicitly; never launched by app code.
 * Persisted inventories live under .whyfull so neither crawler counts them. */
import { spawn, execFileSync } from "node:child_process"
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  readFileSync,
} from "node:fs"
import { resolve, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { cpus, totalmem } from "node:os"

const root = resolve(process.argv[2] ?? "/System/Volumes/Data")
const output = resolve(process.argv[3] ?? "")
if (!process.argv[3] || !output.split(sep).includes(".whyfull"))
  throw new Error(
    "Usage: node experiments/disk-crawler/drive-benchmark.mjs ROOT NEW_DIRECTORY_UNDER_.whyfull [--app-comparison]"
  )
if (process.argv[4] && process.argv[4] !== "--app-comparison")
  throw new Error("Unknown comparison mode")
mkdirSync(output, { mode: 0o700 })
const runner = fileURLToPath(new URL("./run-case.mjs", import.meta.url))
const binary = fileURLToPath(
  new URL("./target/release/whyfull-crawler-spike", import.meta.url)
)
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex")
function system() {
  const command = (bin, args) => {
    try {
      return execFileSync(bin, args, { encoding: "utf8" }).trim()
    } catch (error) {
      return String(error.message)
    }
  }
  const fs = statfsSync(output)
  return {
    at: new Date().toISOString(),
    availableGiB: (fs.bavail * fs.bsize) / 1024 ** 3,
    swap: command("/usr/sbin/sysctl", ["vm.swapusage"]),
    vm: command("/usr/bin/vm_stat", []),
    load: command("/usr/sbin/sysctl", ["vm.loadavg"]),
  }
}
const sequence =
  process.argv[4] === "--app-comparison"
    ? [
        { engine: "rust", workers: 4 },
        { engine: "node-inventory", workers: 8 },
        { engine: "node-inventory", workers: 8 },
        { engine: "rust", workers: 4 },
      ]
    : [
        { engine: "rust", workers: 4 },
        { engine: "node-inventory", workers: 4 },
        { engine: "node-inventory", workers: 8 },
        { engine: "node-inventory", workers: 8 },
        { engine: "node-inventory", workers: 4 },
        { engine: "rust", workers: 4 },
      ]
const report = {
  format: "whyfull-drive-benchmark",
  root,
  startedAt: new Date().toISOString(),
  status: "running",
  node: process.version,
  cpu: cpus()[0]?.model,
  ramGiB: totalmem() / 1024 ** 3,
  configuration: {
    topFiles: 32,
    excludes: [],
    metadataEngine: "sync",
    heapMiB: 12288,
    queueLimit: 256,
  },
  methodology: `${sequence.map((c) => (c.engine === "rust" ? "R" : "N") + c.workers).join(" ")}, fresh processes, no simultaneous scans, no cache purge or artificial warmup. Live drive; counts may change. Node timing includes streamed JSON export; Rust includes SQLite checkpoint. RSS sampled every second for the complete scanner process tree, plus per-process OS high-water marks. OS file cache is separate from process RSS.`,
  sourceHashes: {
    rustBinary: hash(binary),
    nodeIndex: hash(
      fileURLToPath(
        new URL("../../packages/whyfull/dist/index.mjs", import.meta.url)
      )
    ),
    nodeWorker: hash(
      fileURLToPath(
        new URL("../../packages/whyfull/dist/fs-worker.mjs", import.meta.url)
      )
    ),
  },
  sequence,
  before: system(),
  results: [],
}
const reportPath = join(output, "report.json")
function save() {
  const tmp = reportPath + ".tmp"
  writeFileSync(tmp, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 })
  renameSync(tmp, reportPath)
}
let current,
  cancelled = false
const abort = () => {
  cancelled = true
  current?.kill("SIGTERM")
}
process.once("SIGINT", abort)
process.once("SIGTERM", abort)
save()

function treeRss(pid) {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
  const tree = new Set([pid])
  let size
  do {
    size = tree.size
    for (const [p, parent] of rows) if (tree.has(parent)) tree.add(p)
  } while (size !== tree.size)
  return rows
    .filter(([p]) => tree.has(p))
    .map(([pid, ppid, rssKiB]) => ({ pid, ppid, rssKiB }))
}

const inventories = new Map()
try {
  for (const [index, config] of sequence.entries()) {
    if (cancelled) break
    const free = statfsSync(output)
    if (free.bavail * free.bsize < 4 * 1024 ** 3)
      throw new Error(
        "Less than 4 GiB available before next run; retained previous results"
      )
    const file = join(
      output,
      `run-${index + 1}-${config.engine}-${config.workers}.${config.engine === "rust" ? "sqlite" : "json"}`
    )
    const stderrPath = join(output, `run-${index + 1}.stderr.jsonl`)
    const samplesPath = join(output, `run-${index + 1}.samples.jsonl`)
    writeFileSync(stderrPath, "", { flag: "wx", mode: 0o600 })
    writeFileSync(samplesPath, "", { flag: "wx", mode: 0o600 })
    const started = performance.now()
    const before = system()
    console.log(
      JSON.stringify({
        event: "start",
        run: index + 1,
        ...config,
        output: file,
        before,
      })
    )
    current = spawn(
      process.execPath,
      [
        "--max-old-space-size=12288",
        runner,
        JSON.stringify({
          root,
          output: file,
          ...config,
          topFiles: 32,
          queueLimit: 256,
          excludes: [],
          persistSnapshot: true,
          progress: true,
        }),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_OPTIONS: "" },
      }
    )
    let stdout = "",
      pending = "",
      lastProgress = null,
      peakTreeRssKiB = 0,
      samples = 0,
      lastLog = 0
    current.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-65536)
    })
    current.stderr.on("data", (chunk) => {
      appendFileSync(stderrPath, chunk)
      pending += chunk.toString()
      let newline
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        try {
          const value = JSON.parse(line)
          if (value.kind === "progress" || value.kind === "phase")
            lastProgress = value
        } catch {
          /* Runtime warnings and native error text stay in the log. */
        }
      }
      pending = pending.slice(-65536)
    })
    function sample() {
      try {
        const processes = treeRss(current.pid)
        const rssKiB = processes.reduce((sum, row) => sum + row.rssKiB, 0)
        peakTreeRssKiB = Math.max(peakTreeRssKiB, rssKiB)
        const sample = {
          elapsedMs: Math.round(performance.now() - started),
          rssKiB,
          processes,
          progress: lastProgress,
        }
        appendFileSync(samplesPath, JSON.stringify(sample) + "\n")
        samples++
        if (sample.elapsedMs - lastLog >= 15000) {
          lastLog = sample.elapsedMs
          console.log(
            JSON.stringify({
              event: "progress",
              run: index + 1,
              ...config,
              ...sample,
              peakTreeRssKiB,
            })
          )
        }
      } catch (error) {
        console.error(`Memory sampling: ${error.message}`)
      }
    }
    sample()
    const timer = setInterval(sample, 1000)
    const exit = await new Promise((resolveExit) => {
      current.on("error", (error) => resolveExit({ error: error.message }))
      current.on("close", (code, signal) => resolveExit({ code, signal }))
    })
    clearInterval(timer)
    const endToEndMs = Math.round(performance.now() - started)
    const after = system()
    let result
    try {
      result = JSON.parse(stdout.trim())
    } catch {
      result = { status: "failed", stdout }
    }
    result = {
      ...config,
      ...result,
      run: index + 1,
      exit,
      endToEndMs,
      sampledPeakTreeRssKiB: peakTreeRssKiB,
      memorySamples: samples,
      before,
      after,
    }
    try {
      result.inventoryBytes = statSync(file).size
    } catch {}
    if (result.status === "complete") {
      const reference = report.results.find((r) => r.status === "complete")
      result.differenceFromFirst = reference
        ? Object.fromEntries(
            [
              "files",
              "directories",
              "bytes",
              "apparentBytes",
              "skippedLinks",
              "issues",
              "excluded",
            ].map((k) => [k, result[k] - reference[k]])
          )
        : null
    }
    report.results.push(result)
    save()
    console.log(JSON.stringify({ event: "done", ...result }))
    if (result.status !== "complete" || exit.code !== 0)
      throw new Error(
        `Run ${index + 1} failed; logs and incomplete inventory retained`
      )
    // Keep one completed inventory per engine for post-run coverage checks.
    // A failed or cancelled replacement leaves the previous good file intact.
    const previousInventory = inventories.get(config.engine)
    if (previousInventory) rmSync(previousInventory)
    inventories.set(config.engine, file)
  }
  report.status = cancelled ? "cancelled" : "complete"
} catch (error) {
  report.status = cancelled ? "cancelled" : "failed"
  report.error = error.message
  process.exitCode = cancelled ? 130 : 1
  console.error(error.message)
} finally {
  report.completedAt = new Date().toISOString()
  report.after = system()
  save()
  process.removeListener("SIGINT", abort)
  process.removeListener("SIGTERM", abort)
}
