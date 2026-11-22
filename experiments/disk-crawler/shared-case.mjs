/** Actual application scanners, identical SQLite aggregation/index/cache path. */
import {
  scanFilesystem,
  ScanCache,
  releaseDiskSnapshot,
} from "../../packages/whyfull/dist/index.mjs"
import { DatabaseSync } from "node:sqlite"
import { dirname, join } from "node:path"
import { linkSync, statSync } from "node:fs"
const config = JSON.parse(process.argv[2])
const started = performance.now()
let last = 0,
  snapshot
try {
  snapshot = await scanFilesystem({
    root: config.root,
    scanner: config.scanner,
    workers: config.workers,
    engine: "sync",
    topFiles: 32,
    inventoryDirectory: join(dirname(config.output), ".whyfull", "working"),
    policy: { keep: [], exclude: [] },
    onProgress: (s) => {
      if (Date.now() - last < 5000) return
      last = Date.now()
      process.stderr.write(
        JSON.stringify({
          kind: "progress",
          scanner: config.scanner,
          status: s.status,
          files: s.files,
          elapsedMs: Math.round(performance.now() - started),
        }) + "\n"
      )
    },
  })
  if (snapshot.status !== "complete") throw new Error(`Scan ${snapshot.status}`)
  const scanEnd = performance.now()
  const root = snapshot.directories[0]
  const cache = new ScanCache(join(dirname(config.output), ".whyfull", "cache"))
  const cacheStarted = performance.now()
  const saved = await cache.save(snapshot, {
    root: config.root,
    scanner: config.scanner,
  })
  linkSync(saved, config.output)
  const endToEndMs = performance.now() - started
  const cacheMs = performance.now() - cacheStarted
  const db = new DatabaseSync(config.output, { readOnly: true })
  db.exec("PRAGMA cache_size=-8192; PRAGMA temp_store=FILE")
  const validationStarted = performance.now()
  const check = db.prepare("PRAGMA quick_check").get()
  const sums = db
    .prepare(
      "SELECT COUNT(*) AS directories,SUM(ownBytes) AS bytes,SUM(ownApparentBytes) AS apparentBytes,SUM(ownFiles) AS files,SUM(issues) AS issues,SUM(skippedLinks) AS skippedLinks,SUM(state='excluded') AS excluded,SUM(state IN ('pending','working')) AS unfinished FROM directories"
    )
    .get()
  if (
    Object.values(check)[0] !== "ok" ||
    sums.unfinished !== 0 ||
    sums.bytes !== root.bytes ||
    sums.apparentBytes !== root.apparentBytes ||
    sums.files !== snapshot.files ||
    sums.directories !== root.directories + 1
  )
    throw new Error("SQLite integrity or aggregate validation failed")
  const indexes = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='index'")
    .all()
    .map((x) => x.name)
  if (
    !indexes.includes("directory_children_size") ||
    !indexes.includes("directory_size")
  )
    throw new Error("Missing final indexes")
  const pageStarted = performance.now()
  const page = db
    .prepare(
      "SELECT id,name,bytes FROM directories WHERE parent=0 ORDER BY bytes DESC,name LIMIT 100"
    )
    .all()
  const pageMs = performance.now() - pageStarted
  const validationMs = performance.now() - validationStarted
  db.close()
  const usage = process.resourceUsage()
  console.log(
    JSON.stringify({
      status: "complete",
      scanner: config.scanner,
      workers: config.workers,
      files: snapshot.files,
      directories: sums.directories,
      bytes: root.bytes,
      apparentBytes: root.apparentBytes,
      issues: sums.issues,
      skippedLinks: sums.skippedLinks,
      excluded: sums.excluded,
      timings: {
        ...snapshot.timings,
        scanApiMs: scanEnd - started,
        cacheMs,
        endToEndMs,
        validationMs,
        firstPageMs: pageMs,
      },
      firstPageEntries: page.length,
      nodePeakRssKiB: usage.maxRSS,
      nodeUserCpuMs: usage.userCPUTime / 1000,
      nodeSystemCpuMs: usage.systemCPUTime / 1000,
      inventoryBytes: statSync(config.output).size,
      indexes,
      integrity: "ok",
    })
  )
} finally {
  if (snapshot) releaseDiskSnapshot(snapshot)
}
