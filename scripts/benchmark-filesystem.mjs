/** Run AFTER the full-drive scan, on the same unchanged subtree. Results are
 * warm-cache observations, not claims about cold filesystem performance. */
import { scanFilesystem } from "../packages/whyfull/dist/index.mjs"
import { writeFileSync } from "node:fs"
const root = process.argv[2]
if (!root)
  throw new Error(
    "Usage: node scripts/benchmark-filesystem.mjs <directory> [new-results.json]"
  )
const results = []
for (const [engine, workers] of [
  ["sync", 1],
  ["sync", 4],
  ["sync", 8],
  ["async", 4],
]) {
  let peakRss = process.memoryUsage().rss
  const timer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 100)
  const start = performance.now()
  try {
    const scan = await scanFilesystem({ root, workers, engine })
    const ms = performance.now() - start
    const result = {
      engine,
      workers,
      status: scan.status,
      durationMs: Math.round(ms),
      files: scan.files,
      directories: scan.directories.length,
      bytes: scan.directories[0].bytes,
      issues: scan.issues,
      filesPerSecond: Math.round(scan.files / (ms / 1000)),
      peakRssMiB: Math.round(peakRss / 1024 ** 2),
    }
    results.push(result)
    console.log(JSON.stringify(result))
  } finally {
    clearInterval(timer)
  }
}
if (
  results.some(
    (r) => r.bytes !== results[0].bytes || r.files !== results[0].files
  )
)
  console.warn(
    "Directory changed during benchmarking, or scanner results differ. Inspect before comparing timings."
  )
if (process.argv[3])
  writeFileSync(
    process.argv[3],
    JSON.stringify(
      {
        root,
        createdAt: new Date().toISOString(),
        cache:
          "warm; configurations run sequentially in one process, RSS can include retained memory",
        results,
      },
      null,
      2
    ),
    { flag: "wx", mode: 0o600 }
  )
