/** Sequential ABBA comparison. Both paths use the application SQLite store. */
import { spawn, execFileSync } from "node:child_process"
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  renameSync,
  readdirSync,
  statfsSync,
  rmSync,
} from "node:fs"
import { resolve, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { cpus, totalmem } from "node:os"
const root = resolve(process.argv[2] ?? "")
const output = resolve(process.argv[3] ?? "")
if (!process.argv[3] || !output.split(sep).includes(".whyfull"))
  throw new Error(
    "Usage: node shared-benchmark.mjs ROOT NEW_DIRECTORY_UNDER_.whyfull"
  )
mkdirSync(output, { mode: 0o700 })
const runner = fileURLToPath(new URL("./shared-case.mjs", import.meta.url))
const dist = fileURLToPath(
  new URL("../../packages/whyfull/dist/", import.meta.url)
)
const binary = fileURLToPath(
  new URL("./target/release/whyfull-crawler-spike", import.meta.url)
)
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex")
const system = () => {
  const command = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8" }).trim()
    } catch (e) {
      return e.message
    }
  }
  const fs = statfsSync(output)
  return {
    at: new Date().toISOString(),
    availableGiB: (fs.bavail * fs.bsize) / 1024 ** 3,
    swap: command("/usr/sbin/sysctl", ["vm.swapusage"]),
    load: command("/usr/sbin/sysctl", ["vm.loadavg"]),
  }
}
const sequence = ["rust", "node", "node", "rust"].map((scanner) => ({
  scanner,
  workers: 4,
}))
const report = {
  format: "whyfull-shared-sqlite-benchmark",
  root,
  status: "running",
  startedAt: new Date().toISOString(),
  node: process.version,
  cpu: cpus()[0]?.model,
  ramGiB: totalmem() / 1024 ** 3,
  configuration: {
    topFiles: 32,
    excludes: [],
    engine: "sync",
    heapMiB: 512,
    sqliteCacheMiB: 8,
    synchronous: "NORMAL",
    journalMode: "WAL",
  },
  methodology:
    "R4 N4 N4 R4. Fresh sequential processes; live drive; no purge or warmup. Same application SQLite writer, rollup, indexes and atomic cache publication. endToEndMs includes crawler startup, ingestion, aggregation, indexing and cache publication. Independent integrity checks/page probe reported separately. Whole process tree RSS sampled every second; Node OS high-water RSS also recorded. OS filesystem cache is outside process RSS. Node persists its pending frontier in SQLite; Rust uses its bounded traversal queue/local DFS.",
  sourceHashes: {
    ...Object.fromEntries(
      readdirSync(dist)
        .filter((f) => f.endsWith(".mjs"))
        .map((f) => [f, hash(join(dist, f))])
    ),
    rustBinary: hash(binary),
    runner: hash(runner),
  },
  before: system(),
  sequence,
  results: [],
}
const file = join(output, "report.json")
const save = () => {
  writeFileSync(file + ".tmp", JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  })
  renameSync(file + ".tmp", file)
}
function treeRss(pid) {
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
  const ids = new Set([pid])
  let n
  do {
    n = ids.size
    for (const [p, parent] of rows) if (ids.has(parent)) ids.add(p)
  } while (ids.size !== n)
  return rows
    .filter(([p]) => ids.has(p))
    .map(([pid, ppid, rssKiB]) => ({ pid, ppid, rssKiB }))
}
let child,
  cancelled = false
const abort = () => {
  cancelled = true
  if (child) {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {}
  }
}
process.once("SIGINT", abort)
process.once("SIGTERM", abort)
const retained = new Map()
save()
try {
  for (const [index, config] of sequence.entries()) {
    if (cancelled) break
    const before = system()
    if (before.availableGiB < 6)
      throw new Error("Less than 6 GiB free; stopping before next run")
    const inventory = join(
      output,
      `run-${index + 1}-${config.scanner}-4.sqlite`
    )
    const log = join(output, `run-${index + 1}.stderr.log`),
      samplesFile = join(output, `run-${index + 1}.samples.jsonl`)
    writeFileSync(log, "", { flag: "wx", mode: 0o600 })
    writeFileSync(samplesFile, "", { flag: "wx", mode: 0o600 })
    console.log(
      JSON.stringify({ event: "start", run: index + 1, ...config, before })
    )
    const started = performance.now()
    child = spawn(
      "/usr/bin/time",
      [
        "-lp",
        process.execPath,
        "--max-old-space-size=512",
        runner,
        JSON.stringify({ ...config, root, output: inventory }),
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_OPTIONS: "" },
      }
    )
    let stdout = "",
      stderr = "",
      peak = 0,
      samples = 0,
      lastLog = 0,
      progress = null,
      pending = ""
    child.stdout.on("data", (c) => {
      stdout = (stdout + c).slice(-131072)
    })
    child.stderr.on("data", (c) => {
      appendFileSync(log, c)
      stderr = (stderr + c).slice(-32768)
      pending += c.toString()
      let n
      while ((n = pending.indexOf("\n")) !== -1) {
        try {
          const x = JSON.parse(pending.slice(0, n))
          if (x.kind === "progress") progress = x
        } catch {}
        pending = pending.slice(n + 1)
      }
    })
    const sample = () => {
      try {
        const processes = treeRss(child.pid),
          rssKiB = processes.reduce((s, p) => s + p.rssKiB, 0)
        peak = Math.max(peak, rssKiB)
        const row = {
          elapsedMs: Math.round(performance.now() - started),
          rssKiB,
          processes,
          progress,
        }
        appendFileSync(samplesFile, JSON.stringify(row) + "\n")
        samples++
        if (row.elapsedMs - lastLog >= 15000) {
          console.log(
            JSON.stringify({
              event: "progress",
              run: index + 1,
              ...config,
              ...row,
              peakRssKiB: peak,
            })
          )
          lastLog = row.elapsedMs
        }
      } catch {}
    }
    sample()
    const timer = setInterval(sample, 1000)
    const exit = await new Promise((resolve) => {
      child.once("error", (e) => resolve({ error: e.message }))
      child.once("close", (code, signal) => resolve({ code, signal }))
    })
    clearInterval(timer)
    let result
    try {
      result = JSON.parse(stdout.trim())
    } catch {
      result = { status: "failed", stdout }
    }
    const cpu = {}
    for (const key of ["real", "user", "sys"]) {
      const m = stderr.match(new RegExp(`^${key}\\s+([\\d.]+)$`, "m"))
      if (m) cpu[key + "Seconds"] = Number(m[1])
    }
    result = {
      ...result,
      run: index + 1,
      exit,
      processWallMs: performance.now() - started,
      sampledPeakTreeRssMiB: peak / 1024,
      memorySamples: samples,
      cpu,
      before,
      after: system(),
    }
    const first = report.results[0]
    if (first)
      result.differenceFromFirst = Object.fromEntries(
        [
          "files",
          "directories",
          "bytes",
          "apparentBytes",
          "issues",
          "skippedLinks",
          "excluded",
        ].map((k) => [k, result[k] - first[k]])
      )
    report.results.push(result)
    save()
    console.log(JSON.stringify({ event: "done", ...result }))
    if (result.status !== "complete" || exit.code !== 0)
      throw new Error(`Run ${index + 1} failed; evidence retained`)
    const previous = retained.get(config.scanner)
    if (previous) rmSync(previous)
    retained.set(config.scanner, inventory)
  }
  report.status = cancelled ? "cancelled" : "complete"
} catch (error) {
  report.status = cancelled ? "cancelled" : "failed"
  report.error = error.message
  process.exitCode = cancelled ? 130 : 1
} finally {
  report.completedAt = new Date().toISOString()
  report.after = system()
  save()
}
