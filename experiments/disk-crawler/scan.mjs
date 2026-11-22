/** Experimental Node -> Rust -> SQLite pipeline, isolated from the shipped API.
 * Node >=22.18 is required for node:sqlite. No whole-inventory JS array. */
import { spawn } from "node:child_process"
import {
  lstatSync,
  opendirSync,
  realpathSync,
  openSync,
  closeSync,
} from "node:fs"
import { isAbsolute, relative, resolve, basename, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { setImmediate } from "node:timers/promises"
import { DatabaseSync } from "node:sqlite"

export const binaryPath = fileURLToPath(
  new URL("./target/release/whyfull-crawler-spike", import.meta.url)
)

function within(path, parent) {
  const r = relative(parent, path)
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r))
}

function retain(files, file, limit) {
  if (!limit) return
  const at = files.findIndex(
    (f) =>
      f.bytes < file.bytes || (f.bytes === file.bytes && f.name > file.name)
  )
  if (at < 0) {
    if (files.length < limit) files.push(file)
  } else {
    files.splice(at, 0, file)
    if (files.length > limit) files.pop()
  }
}

/** Control: same disk-backed inventory, implemented in Node with streaming
 * opendir rather than readdir. Separates inventory design from Rust's effect. */
async function* nodeRecords({ root, topFiles, excludes }) {
  const device = lstatSync(root, { bigint: true }).dev
  let nextId = 1
  let nextProgress = performance.now() + 500
  const totals = {
    files: 0,
    directories: 0,
    bytes: 0,
    apparentBytes: 0,
    skippedLinks: 0,
    issues: 0,
  }
  function open(path, id, parent) {
    const result = {
      kind: "directory",
      id,
      parent,
      name: basename(path) || path,
      ownBytes: 0,
      ownApparentBytes: 0,
      ownFiles: 0,
      topFiles: [],
      skippedLinks: 0,
      issues: 0,
      state: "scanned",
      reason: null,
    }
    let entries
    try {
      if (
        (parent !== null && basename(path) === ".whyfull") ||
        excludes.some((p) => within(path, p))
      ) {
        result.state = "excluded"
        result.reason = "Excluded directory or Whyfull scan cache"
      } else {
        const info = lstatSync(path, { bigint: true })
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("Directory changed during scan")
        if (info.dev !== device) {
          result.state = "excluded"
          result.reason = "Different filesystem; scan separately"
        } else entries = opendirSync(path)
      }
    } catch (error) {
      result.state = "unreadable"
      result.reason = error.message
      result.issues++
      totals.issues++
    }
    return { path, entries, result }
  }
  yield { kind: "start", protocol: 1, root, workers: 1, topFiles }
  const stack = [open(root, 0, null)]
  try {
    while (stack.length) {
      const frame = stack.at(-1)
      let entry
      try {
        entry = frame.entries?.readSync()
      } catch (error) {
        frame.result.issues++
        totals.issues++
        frame.result.state = "unreadable"
        frame.result.reason = error.message
      }
      if (!entry) {
        frame.entries?.closeSync()
        stack.pop()
        totals.directories++
        yield frame.result
      } else {
        const path = resolve(frame.path, entry.name)
        let info
        try {
          info = lstatSync(path, { bigint: true })
        } catch {
          frame.result.issues++
          totals.issues++
        }
        if (info?.isSymbolicLink()) {
          frame.result.skippedLinks++
          totals.skippedLinks++
        } else if (info?.isDirectory())
          stack.push(open(path, nextId++, frame.result.id))
        else if (info?.isFile()) {
          frame.result.ownFiles++
          totals.files++
          const file = {
            name: entry.name,
            bytes: Number(info.blocks) * 512,
            apparentBytes: Number(info.size),
          }
          if (info.nlink > 1n) {
            yield {
              kind: "linked",
              directory: frame.result.id,
              inode: `${info.dev}:${info.ino}`,
              ...file,
            }
          } else {
            frame.result.ownBytes += file.bytes
            frame.result.ownApparentBytes += file.apparentBytes
            totals.bytes += file.bytes
            totals.apparentBytes += file.apparentBytes
            retain(frame.result.topFiles, file, topFiles)
          }
        }
      }
      if (performance.now() >= nextProgress) {
        nextProgress = performance.now() + 500
        yield { kind: "progress", ...totals, discoveredDirectories: nextId }
        await setImmediate()
      }
    }
    yield { kind: "summary", ...totals }
  } finally {
    for (const frame of stack) frame.entries?.closeSync()
  }
}

async function* parseRecords(input) {
  input.setEncoding("utf8")
  let pending = ""
  for await (const chunk of input) {
    pending += chunk
    let newline
    while ((newline = pending.indexOf("\n")) !== -1) {
      if (newline > 8 * 1024 ** 2) throw new Error("Oversized crawler record")
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (line) yield JSON.parse(line)
    }
    if (pending.length > 8 * 1024 ** 2)
      throw new Error("Oversized crawler record")
  }
  if (pending.trim()) throw new Error("Truncated crawler record")
}

export async function scanToDatabase({
  root,
  output,
  engine = "rust",
  workers = 4,
  topFiles = 32,
  queueLimit = 256,
  excludes = [],
  signal,
  onProgress,
  binary = binaryPath,
}) {
  const started = performance.now()
  root = resolve(root)
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
    throw new Error("Scan root must be a directory, not a symlink")
  root = realpathSync(root)
  if (!["rust", "node-stream"].includes(engine))
    throw new Error("Unknown spike engine")
  for (const [name, value, min, max] of [
    ["workers", workers, 1, 32],
    ["topFiles", topFiles, 0, 1000],
    ["queueLimit", queueLimit, 1, 65536],
  ])
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${name}`)
  if (engine === "node-stream" && workers !== 1)
    throw new Error("node-stream uses one worker")
  excludes = excludes.map((p) => resolve(p))
  // Resolve the parent too: a symlinked output parent must not bypass this rule.
  output = resolve(realpathSync(resolve(output, "..")), basename(output))
  if (
    within(output, root) &&
    !relative(root, output).split(sep).slice(0, -1).includes(".whyfull")
  )
    throw new Error(
      "Place the database outside the scanned tree, or inside an excluded .whyfull directory"
    )
  closeSync(openSync(output, "wx", 0o600))
  const db = new DatabaseSync(output)
  let child, childExit, abort
  let metadata = {
    format: "whyfull-crawler-spike",
    protocol: 1,
    root,
    engine,
    workers,
    topFiles,
    queueLimit,
    excludes,
    status: "scanning",
    startedAt: new Date().toISOString(),
  }
  let inTransaction = false
  const totals = {
    files: 0,
    directories: 0,
    bytes: 0,
    apparentBytes: 0,
    skippedLinks: 0,
    issues: 0,
    excluded: 0,
  }
  try {
    // Bounded SQLite page cache; large indexes and sorts spill to disk.
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
      CREATE TABLE scan (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL);
      CREATE TABLE directories (
        id INTEGER PRIMARY KEY, parent INTEGER, name TEXT NOT NULL,
        ownBytes INTEGER NOT NULL, ownApparentBytes INTEGER NOT NULL, ownFiles INTEGER NOT NULL,
        skippedLinks INTEGER NOT NULL, issues INTEGER NOT NULL, state TEXT NOT NULL,
        reason TEXT, topFiles TEXT NOT NULL);
      CREATE INDEX directory_parent ON directories(parent);
      CREATE TABLE hardlinks (
        inode TEXT PRIMARY KEY, directory INTEGER NOT NULL, name TEXT NOT NULL,
        bytes INTEGER NOT NULL, apparentBytes INTEGER NOT NULL) WITHOUT ROWID;
      CREATE INDEX hardlink_directory ON hardlinks(directory, bytes DESC);`)
    const save = db.prepare("INSERT OR REPLACE INTO scan VALUES (1, ?)")
    const insert = db.prepare(
      "INSERT INTO directories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    const link = db.prepare(
      "INSERT OR IGNORE INTO hardlinks VALUES (?, ?, ?, ?, ?)"
    )
    const linkTotals = db.prepare(
      "SELECT COALESCE(SUM(bytes),0) AS bytes, COALESCE(SUM(apparentBytes),0) AS apparentBytes FROM hardlinks WHERE directory = ?"
    )
    const linkTop = db.prepare(
      "SELECT name, bytes, apparentBytes FROM hardlinks WHERE directory = ? ORDER BY bytes DESC, name LIMIT ?"
    )
    let lastCommit = performance.now(),
      batch = 0,
      records = 0,
      summary,
      startRecord
    save.run(JSON.stringify(metadata))
    db.exec("BEGIN")
    inTransaction = true
    function checkpoint(force = false) {
      if (!force && batch < 256 && performance.now() - lastCommit < 1000) return
      metadata = {
        ...metadata,
        ...totals,
        durationMs: Math.round(performance.now() - started),
      }
      save.run(JSON.stringify(metadata))
      db.exec("COMMIT; BEGIN")
      batch = 0
      lastCommit = performance.now()
    }
    let input
    if (signal?.aborted) throw new Error("Scan cancelled")
    if (engine === "rust") {
      child = spawn(
        binary,
        [
          root,
          String(workers),
          String(topFiles),
          String(queueLimit),
          ...excludes,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
        }
      )
      let stderr = ""
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-8192)
      })
      // Attach immediately; spawn errors and early exits cannot be missed.
      childExit = new Promise((resolveExit) => {
        child.on("error", (error) => resolveExit({ error }))
        child.on("close", (code, signal) =>
          resolveExit({ code, signal, stderr })
        )
      })
      abort = () => {
        child.kill("SIGTERM")
      }
      signal?.addEventListener("abort", abort, { once: true })
      input = parseRecords(child.stdout)
    } else input = nodeRecords({ root, topFiles, excludes })
    for await (const record of input) {
      if (signal?.aborted) throw new Error("Scan cancelled")
      if (summary) throw new Error("Record received after summary")
      if (record.kind === "start") {
        if (startRecord || record.protocol !== 1 || record.root !== root)
          throw new Error("Invalid crawler handshake")
        startRecord = record
      } else {
        if (!startRecord) throw new Error("Missing crawler handshake")
        if (record.kind === "linked") {
          link.run(
            record.inode,
            record.directory,
            record.name,
            record.bytes,
            record.apparentBytes
          )
          batch++
        } else if (record.kind === "directory") {
          const linked = linkTotals.get(record.id)
          for (const file of linkTop.all(record.id, topFiles))
            retain(record.topFiles, file, topFiles)
          record.ownBytes += linked.bytes
          record.ownApparentBytes += linked.apparentBytes
          insert.run(
            record.id,
            record.parent,
            record.name,
            record.ownBytes,
            record.ownApparentBytes,
            record.ownFiles,
            record.skippedLinks,
            record.issues,
            record.state,
            record.reason,
            JSON.stringify(record.topFiles)
          )
          totals.directories++
          totals.files += record.ownFiles
          totals.bytes += record.ownBytes
          totals.apparentBytes += record.ownApparentBytes
          totals.skippedLinks += record.skippedLinks
          totals.issues += record.issues
          totals.excluded += Number(record.state === "excluded")
          batch++
        } else if (record.kind === "progress") {
          onProgress?.({ ...record, committedDirectories: totals.directories })
        } else if (record.kind === "summary") summary = record
        else throw new Error("Unknown crawler record")
      }
      checkpoint()
      if (++records % 256 === 0) await setImmediate()
    }
    const exit = await childExit
    if (signal?.aborted) throw new Error("Scan cancelled")
    if (exit && (exit.error || exit.code !== 0))
      throw new Error(
        exit.error?.message ??
          `Crawler exited (${exit.code ?? exit.signal}): ${exit.stderr}`
      )
    if (!summary)
      throw new Error(
        "Crawler ended without a summary; partial inventory preserved"
      )
    const linked = db
      .prepare(
        "SELECT COALESCE(SUM(bytes),0) AS bytes, COALESCE(SUM(apparentBytes),0) AS apparentBytes FROM hardlinks"
      )
      .get()
    if (
      summary.files !== totals.files ||
      summary.directories !== totals.directories ||
      summary.bytes + linked.bytes !== totals.bytes ||
      summary.apparentBytes + linked.apparentBytes !== totals.apparentBytes ||
      summary.skippedLinks !== totals.skippedLinks ||
      summary.issues !== totals.issues
    )
      throw new Error(
        "Crawler summary disagrees with persisted directory totals"
      )
    checkpoint(true)
    const usage = process.resourceUsage()
    metadata = {
      ...metadata,
      status: "complete",
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      nodePeakRssKiB: usage.maxRSS,
      crawlerPeakRssKiB: summary.peakRssKiB ?? 0,
      interruptedRetries: summary.interruptedRetries ?? 0,
      // Sum of separate high-water marks is a conservative bound, not a
      // simultaneous process-tree measurement. Baseline has only one process.
      peakRssUpperBoundKiB: usage.maxRSS + (summary.peakRssKiB ?? 0),
      nodeCpuMs: (usage.userCPUTime + usage.systemCPUTime) / 1000,
      crawlerCpuMs: summary.cpuMs ?? 0,
    }
    save.run(JSON.stringify(metadata))
    db.exec("COMMIT")
    inTransaction = false
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    return metadata
  } catch (error) {
    // Keep all received records, and retain already committed batches even on
    // abrupt process death. A failed scan can never masquerade as complete.
    if (child) child.kill("SIGTERM")
    await childExit
    metadata = {
      ...metadata,
      ...totals,
      durationMs: Math.round(performance.now() - started),
      status: signal?.aborted ? "cancelled" : "failed",
      error: error.message,
    }
    try {
      if (inTransaction) db.exec("COMMIT")
      inTransaction = false
      db.prepare("INSERT OR REPLACE INTO scan VALUES (1, ?)").run(
        JSON.stringify(metadata)
      )
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } catch {
      /* Previously committed WAL remains readable after a hard failure. */
    }
    throw error
  } finally {
    signal?.removeEventListener("abort", abort)
    db.close()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      engine: { type: "string", default: "rust" },
      workers: { type: "string", default: "4" },
      "top-files": { type: "string", default: "32" },
      "queue-limit": { type: "string", default: "256" },
      exclude: { type: "string", multiple: true, default: [] },
    },
  })
  if (positionals.length !== 2)
    throw new Error(
      "Usage: node experiments/disk-crawler/scan.mjs ROOT NEW_DATABASE [--engine rust|node-stream] [--workers N] [--exclude PATH]"
    )
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  try {
    console.log(
      JSON.stringify(
        await scanToDatabase({
          root: positionals[0],
          output: positionals[1],
          engine: values.engine,
          workers: Number(values.workers),
          topFiles: Number(values["top-files"]),
          queueLimit: Number(values["queue-limit"]),
          excludes: values.exclude,
          signal: controller.signal,
          onProgress: (progress) => console.error(JSON.stringify(progress)),
        })
      )
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = controller.signal.aborted ? 130 : 1
  } finally {
    process.removeListener("SIGINT", abort)
    process.removeListener("SIGTERM", abort)
  }
}
