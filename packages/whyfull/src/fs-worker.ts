import { parentPort } from "node:worker_threads"
import { lstatSync, readdirSync } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { Stats } from "node:fs"
import type {
  DirectoryTask,
  DirectoryResult,
  DiskFile,
} from "./filesystem-types"

function addFile(
  result: DirectoryResult,
  name: string,
  st: Stats,
  limit: number
) {
  if (st.isSymbolicLink()) {
    result.skippedLinks++
    return
  }
  if (!st.isFile()) return
  const file = { name, bytes: st.blocks * 512, apparentBytes: st.size }
  if (st.nlink > 1) {
    result.linked.push({ ...file, inode: `${st.dev}:${st.ino}` })
    return
  }
  result.bytes += file.bytes
  result.apparentBytes += file.apparentBytes
  result.files++
  retainFile(result.topFiles, file, limit)
}

function retainFile(files: DiskFile[], file: DiskFile, limit: number) {
  if (files.length >= limit && file.bytes <= files[files.length - 1].bytes)
    return
  files.push(file)
  files.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  if (files.length > limit) files.length = limit
}

async function read(task: DirectoryTask): Promise<DirectoryResult> {
  const result: DirectoryResult = {
    id: task.id,
    directories: [],
    topFiles: [],
    linked: [],
    bytes: 0,
    apparentBytes: 0,
    files: 0,
    skippedLinks: 0,
    issues: 0,
  }
  try {
    // Recheck each queued directory without following a replaced symlink.
    const root =
      task.engine === "sync" ? lstatSync(task.path) : await lstat(task.path)
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      root.dev !== task.device
    ) {
      result.error = "Directory changed or crosses a filesystem boundary"
      result.issues++
      return result
    }
    const entries =
      task.engine === "sync"
        ? readdirSync(task.path, { withFileTypes: true })
        : await readdir(task.path, { withFileTypes: true })
    // Bounded async metadata fan-out is a separate benchmark configuration.
    let cursor = 0
    async function consume() {
      while (cursor < entries.length) {
        const entry = entries[cursor++]
        if (entry.isSymbolicLink()) {
          result.skippedLinks++
          continue
        }
        const path = join(task.path, entry.name)
        try {
          const st =
            task.engine === "sync" ? lstatSync(path) : await lstat(path)
          if (st.isDirectory())
            result.directories.push({
              name: entry.name,
              mount: st.dev !== task.device,
            })
          else addFile(result, entry.name, st, task.topFiles)
        } catch {
          result.issues++
        }
      }
    }
    await Promise.all(
      Array.from({ length: task.engine === "sync" ? 1 : 8 }, consume)
    )
  } catch (error) {
    result.issues++
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

parentPort?.on("message", (task: DirectoryTask) => {
  void read(task).then((result) => parentPort?.postMessage(result))
})
