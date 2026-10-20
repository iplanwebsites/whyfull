import { createReadStream, createWriteStream } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { open } from "node:fs/promises"
import { createInterface } from "node:readline"
import { JSONParser } from "@streamparser/json"
import type { DiskSnapshot } from "./filesystem-types"

/** Avoid V8's single-string limit and a second full inventory in RAM. The output
 * remains ordinary JSON, compatible with existing JSON readers. */
export function* diskSnapshotChunks(snapshot: DiskSnapshot): Generator<string> {
  const { directories, ...meta } = snapshot
  yield JSON.stringify(meta).slice(0, -1) + ',"directories":[\n'
  let batch = ""
  for (let i = 0; i < directories.length; i++) {
    batch += (i ? ",\n" : "") + JSON.stringify(directories[i])
    if (batch.length > 65536) {
      yield batch
      batch = ""
    }
  }
  if (batch) yield batch
  yield "\n]}\n"
}

export async function saveDiskSnapshot(
  snapshot: DiskSnapshot,
  path: string
): Promise<void> {
  if (snapshot.status === "scanning")
    throw new Error("Complete or cancel the scan before saving a snapshot")
  await pipeline(
    Readable.from(diskSnapshotChunks(snapshot)),
    createWriteStream(path, { flags: "wx", mode: 0o600 })
  )
}

/** The writer puts one directory on each JSON line. Parse those records using
 * V8's native JSON parser, with a general streaming-parser fallback. Probe only
 * a bounded prefix so minified input cannot become one giant readline string. */
async function readDirectoryLines(path: string): Promise<DiskSnapshot | null> {
  const handle = await open(path, "r")
  const prefix = Buffer.alloc(65536)
  let header: string
  try {
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0)
    const newline = prefix.subarray(0, bytesRead).indexOf(10)
    if (newline < 0) return null
    header = prefix.subarray(0, newline).toString("utf8")
  } finally {
    await handle.close()
  }
  const suffix = ',"directories":['
  if (!header.endsWith(suffix)) return null
  const input = createReadStream(path, { highWaterMark: 1024 * 1024 })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    const meta = JSON.parse(header.slice(0, -suffix.length) + "}")
    if (meta?.format !== "whyfull-disk") return null
    const directories: DiskSnapshot["directories"] = []
    let first = true,
      closed = false,
      comma: boolean | undefined
    for await (const raw of lines) {
      if (first) {
        first = false
        continue
      }
      const line = raw.trim()
      if (!line) continue
      if (closed) throw new SyntaxError("Unexpected content after snapshot")
      if (line === "]}") {
        if (comma) throw new SyntaxError("Trailing comma in snapshot")
        closed = true
        continue
      }
      if (comma === false)
        throw new SyntaxError("Missing comma between directories")
      comma = line.endsWith(",")
      directories.push(JSON.parse(comma ? line.slice(0, -1) : line))
    }
    if (!closed) throw new SyntaxError("Incomplete snapshot")
    return { ...meta, directories }
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  } finally {
    lines.close()
    input.destroy()
  }
}

async function readGenericSnapshot(path: string): Promise<DiskSnapshot> {
  const directories: DiskSnapshot["directories"] = []
  const meta: Record<string, unknown> = {}
  const keys = [
    "format",
    "schemaVersion",
    "root",
    "startedAt",
    "completedAt",
    "durationMs",
    "status",
    "workers",
    "engine",
    "files",
    "skippedLinks",
    "issues",
    "policy",
  ]
  const parser = new JSONParser({
    paths: ["$.directories.*", ...keys.map((key) => `$.${key}`)],
    keepStack: false,
  })
  parser.onValue = ({ value, key }) => {
    if (typeof key === "number")
      directories.push(value as unknown as DiskSnapshot["directories"][number])
    else if (typeof key === "string") meta[key] = value
  }
  for await (const chunk of createReadStream(path)) parser.write(chunk)
  if (!parser.isEnded) parser.end()
  return { ...meta, directories } as unknown as DiskSnapshot
}

export async function loadDiskSnapshot(path: string): Promise<DiskSnapshot> {
  const snapshot =
    (await readDirectoryLines(path)) ?? (await readGenericSnapshot(path))
  const { directories } = snapshot
  if (
    snapshot.format !== "whyfull-disk" ||
    snapshot.schemaVersion !== 1 ||
    !directories.length ||
    typeof snapshot.root !== "string" ||
    !["scanning", "complete", "cancelled", "failed"].includes(snapshot.status)
  )
    throw new Error("Not a supported whyfull disk snapshot")
  for (const [i, node] of directories.entries()) {
    if (
      !node ||
      node.id !== i ||
      typeof node.path !== "string" ||
      typeof node.name !== "string" ||
      !Number.isFinite(node.bytes) ||
      node.bytes < 0 ||
      !Array.isArray(node.children) ||
      node.children.some(
        (id) =>
          !Number.isInteger(id) ||
          id <= i ||
          id >= directories.length ||
          directories[id]?.parent !== i
      ) ||
      !Array.isArray(node.topFiles) ||
      node.topFiles.some(
        (f) =>
          !f ||
          typeof f.name !== "string" ||
          !Number.isFinite(f.bytes) ||
          f.bytes < 0
      ) ||
      (i === 0
        ? node.parent !== null
        : !Number.isInteger(node.parent) ||
          node.parent! < 0 ||
          node.parent! >= i)
    )
      throw new Error("Invalid snapshot directory tree")
  }
  // An imported in-progress scan cannot continue in this process.
  if (snapshot.status === "scanning") snapshot.status = "cancelled"
  return snapshot
}
