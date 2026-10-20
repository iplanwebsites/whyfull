import { lstat, readdir } from "node:fs/promises"
import { join } from "node:path"

const MiB = 1024 ** 2,
  GiB = 1024 ** 3
export interface FileSizeBucket {
  label: string
  minBytes: number
  maxBytes: number | null
  files: number
  bytes: number
}
export interface FileDistribution {
  measuredAt: string
  files: number
  bytes: number
  logicalBytes: number
  averageBytes: number
  largestBytes: number
  unreadable: number
  buckets: FileSizeBucket[]
}
export function createFileDistribution(): FileDistribution {
  const ranges: Array<[string, number, number | null]> = [
    ["Under 1 MiB", 0, MiB],
    ["1–10 MiB", MiB, 10 * MiB],
    ["10–100 MiB", 10 * MiB, 100 * MiB],
    ["100 MiB–1 GiB", 100 * MiB, GiB],
    ["1–10 GiB", GiB, 10 * GiB],
    ["10 GiB or more", 10 * GiB, null],
  ]
  return {
    measuredAt: "",
    files: 0,
    bytes: 0,
    logicalBytes: 0,
    averageBytes: 0,
    largestBytes: 0,
    unreadable: 0,
    buckets: ranges.map(([label, minBytes, maxBytes]) => ({
      label,
      minBytes,
      maxBytes,
      files: 0,
      bytes: 0,
    })),
  }
}
export function addFileSize(
  result: FileDistribution,
  bytes: number,
  allocatedBytes = bytes
) {
  if (
    !Number.isFinite(bytes) ||
    bytes < 0 ||
    !Number.isFinite(allocatedBytes) ||
    allocatedBytes < 0
  )
    throw new Error("Invalid file size")
  const bucket = result.buckets.find(
    (item) => item.maxBytes === null || bytes < item.maxBytes
  )!
  bucket.files++
  bucket.bytes += allocatedBytes
  result.files++
  result.bytes += allocatedBytes
  result.logicalBytes += bytes
  result.largestBytes = Math.max(result.largestBytes, bytes)
  result.averageBytes = result.logicalBytes / result.files
}
/** Read direct-file metadata only, with bounded concurrency; never follow symlinks. */
export async function measureFileDistribution(
  path: string,
  signal?: AbortSignal
): Promise<FileDistribution> {
  if (signal?.aborted) throw new Error("Measurement cancelled")
  const root = await lstat(path)
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("Select an accessible directory")
  const entries = await readdir(path, { withFileTypes: true })
  const result = createFileDistribution()
  let cursor = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < entries.length) {
        if (signal?.aborted) throw new Error("Measurement cancelled")
        const entry = entries[cursor++]!
        if (!entry.isFile()) continue
        try {
          const info = await lstat(join(path, entry.name))
          if (info.isFile()) addFileSize(result, info.size, info.blocks * 512)
        } catch {
          result.unreadable++
        }
      }
    })
  )
  result.measuredAt = new Date().toISOString()
  return result
}
