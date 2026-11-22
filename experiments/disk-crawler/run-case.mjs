// One configuration per process: independent RSS high-water marks, GC, and
// worker lifetimes. Invoked by benchmark.mjs, also useful for heap-cap trials.
import { performance } from "node:perf_hooks"
const options = JSON.parse(process.argv[2])
const start = performance.now()
let result
const progress = options.progress
  ? (value) => console.error(JSON.stringify({ kind: "progress", ...value }))
  : undefined
if (options.engine === "node-inventory") {
  const { scanFilesystem, saveDiskSnapshot } =
    await import("../../packages/whyfull/dist/index.mjs")
  const snapshot = await scanFilesystem({
    root: options.root,
    workers: options.workers,
    engine: options.metadataEngine ?? "sync",
    topFiles: options.topFiles ?? 32,
    policy: { keep: [], exclude: options.excludes ?? [] },
    onProgress:
      progress &&
      ((snapshot) =>
        progress({
          files: snapshot.files,
          directories: snapshot.directories.length,
          bytes: snapshot.directories[0].bytes,
          elapsedMs: snapshot.durationMs,
        })),
  })
  const root = snapshot.directories[0]
  result = {
    status: snapshot.status,
    files: snapshot.files,
    directories: snapshot.directories.length,
    bytes: root.bytes,
    apparentBytes: root.apparentBytes,
    skippedLinks: snapshot.skippedLinks,
    issues: snapshot.issues,
    excluded: root.excluded,
    scanMs: snapshot.durationMs,
  }
  if (options.persistSnapshot && snapshot.status === "complete") {
    console.error(JSON.stringify({ kind: "phase", phase: "persisting" }))
    const persistStart = performance.now()
    await saveDiskSnapshot(snapshot, options.output)
    result.persistMs = Math.round(performance.now() - persistStart)
  }
} else {
  const { scanToDatabase } = await import("./scan.mjs")
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  let scan
  try {
    scan = await scanToDatabase({
      ...options,
      signal: controller.signal,
      onProgress: progress,
    })
  } finally {
    process.removeListener("SIGINT", abort)
    process.removeListener("SIGTERM", abort)
  }
  result = { ...scan, scanMs: scan.durationMs }
}
const usage = process.resourceUsage()
console.log(
  JSON.stringify({
    ...result,
    engine: options.engine,
    workers: options.workers,
    metadataEngine: options.metadataEngine ?? "sync",
    durationMs: Math.round(performance.now() - start),
    nodePeakRssKiB: usage.maxRSS,
    peakRssUpperBoundKiB: usage.maxRSS + (result.crawlerPeakRssKiB ?? 0),
    cpuMs:
      (usage.userCPUTime + usage.systemCPUTime) / 1000 +
      (result.crawlerCpuMs ?? 0),
  })
)
