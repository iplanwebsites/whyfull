import { spawn } from "node:child_process"
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  statSync,
  realpathSync,
  renameSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir, platform, release, arch, cpus, totalmem } from "node:os"
import { join, resolve, relative, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    rounds: { type: "string", default: "3" },
    "heap-mib": { type: "string", default: "512" },
    exclude: { type: "string", multiple: true, default: [] },
  },
})
if (positionals.length !== 2)
  throw new Error(
    "Usage: node experiments/disk-crawler/benchmark.mjs ROOT NEW_RESULTS_JSON [--rounds 3] [--heap-mib 512] [--exclude PATH]"
  )
const root = realpathSync(positionals[0])
const output = resolve(
  realpathSync(resolve(positionals[1], "..")),
  positionals[1].split("/").at(-1)
)
const fromRoot = relative(root, output)
if (
  !fromRoot ||
  (fromRoot !== ".." && !fromRoot.startsWith("../") && !isAbsolute(fromRoot))
)
  throw new Error("Benchmark results must be outside the scanned tree")
const rounds = Number(values.rounds),
  heapMiB = Number(values["heap-mib"])
if (
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 20 ||
  !Number.isInteger(heapMiB) ||
  heapMiB < 32
)
  throw new Error("Invalid rounds or heap cap")
const excludes = values.exclude.map((p) => resolve(p))
const runner = fileURLToPath(new URL("./run-case.mjs", import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), "whyfull-crawler-benchmark-"))
const scratchRelative = relative(root, realpathSync(scratch))
if (
  !scratchRelative ||
  (scratchRelative !== ".." &&
    !scratchRelative.startsWith("../") &&
    !isAbsolute(scratchRelative))
) {
  rmSync(scratch, { recursive: true, force: true })
  throw new Error("TMPDIR must be outside the benchmark root")
}
const configurations = [
  { engine: "node-inventory", workers: 1 },
  { engine: "node-inventory", workers: 4 },
  { engine: "node-inventory", workers: 4, metadataEngine: "async" },
  { engine: "node-stream", workers: 1 },
  { engine: "rust", workers: 1 },
  { engine: "rust", workers: 4 },
  { engine: "rust", workers: 8 },
]
const report = {
  root,
  createdAt: new Date().toISOString(),
  node: process.version,
  host: {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramGiB: totalmem() / 1024 ** 3,
  },
  cache:
    "One untimed warmup, then sequential fresh processes with rotated order. No OS cache purge; warm-cache observations only.",
  memory:
    "OS process RSS high-water marks, including Node workers; Rust cases sum Node and crawler peaks (conservative upper bound, not simultaneous RSS). SQLite/OS file caches are not included in this process metric.",
  heapMiB,
  topFiles: 32,
  excludes,
  configurations,
  results: [],
}
let interrupted = false

function saveReport() {
  const temporary = `${output}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    })
    renameSync(temporary, output)
  } finally {
    rmSync(temporary, { force: true })
  }
}

async function run(config, output) {
  const started = performance.now()
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${heapMiB}`,
      runner,
      JSON.stringify({ root, output, excludes, topFiles: 32, ...config }),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "" },
    }
  )
  let stdout = "",
    stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(-65536)
  })
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8192)
  })
  const abort = () => {
    interrupted = true
    child.kill("SIGTERM")
  }
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  try {
    const exit = await new Promise((resolveExit) => {
      child.on("error", (error) => resolveExit({ error: error.message }))
      child.on("close", (code, signal) => resolveExit({ code, signal }))
    })
    if (exit.code !== 0) return { ...config, status: "failed", ...exit, stderr }
    const result = JSON.parse(stdout.trim())
    if (config.engine !== "node-inventory")
      result.databaseMiB = statSync(output).size / 1024 ** 2
    return { ...result, endToEndMs: Math.round(performance.now() - started) }
  } finally {
    process.removeListener("SIGINT", abort)
    process.removeListener("SIGTERM", abort)
  }
}

try {
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  })
  const warmupPath = join(scratch, "warmup.sqlite")
  console.error("Warming filesystem cache using the streaming Node control…")
  report.warmup = await run({ engine: "node-stream", workers: 1 }, warmupPath)
  if (report.warmup.status !== "complete") throw new Error("Warmup failed")
  rmSync(warmupPath)
  roundsLoop: for (let round = 0; round < rounds; round++) {
    // Rotate and alternate direction to reduce fixed order bias.
    const order = configurations.map(
      (_, i) => configurations[(i + round * 3) % configurations.length]
    )
    if (round % 2) order.reverse()
    for (const config of order) {
      const database = join(scratch, `${round}-${report.results.length}.sqlite`)
      const result = { round: round + 1, ...(await run(config, database)) }
      const keys = [
        "files",
        "directories",
        "bytes",
        "apparentBytes",
        "skippedLinks",
        "issues",
        "excluded",
      ]
      result.matchesWarmup =
        result.status === "complete" &&
        keys.every((key) => result[key] === report.warmup[key])
      if (!result.matchesWarmup) process.exitCode = 1
      report.results.push(result)
      console.log(JSON.stringify(result))
      // Own reserved output only; retain results if a later case OOMs.
      saveReport()
      if (config.engine !== "node-inventory") rmSync(database, { force: true })
      if (interrupted) {
        process.exitCode = 130
        break roundsLoop
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
