import { parentPort } from "node:worker_threads"
import { lstatSync, opendirSync } from "node:fs"
import { lstat, opendir } from "node:fs/promises"
import { join } from "node:path"
import type { Stats, Dirent, Dir } from "node:fs"
import type {
  DirectoryTask,
  DirectoryBatch,
  DiskFile,
} from "./filesystem-types"

function retainFile(files: DiskFile[], file: DiskFile, limit: number) {
  if (files.length >= limit && file.bytes <= files[files.length - 1].bytes)
    return
  files.push(file)
  files.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
  if (files.length > limit) files.length = limit
}
let acknowledge: (() => void) | undefined
async function read(task: DirectoryTask) {
  const result: DirectoryBatch = {
    id: task.id,
    directories: [],
    linked: [],
    topFiles: [],
    bytes: 0,
    apparentBytes: 0,
    files: 0,
    skippedLinks: 0,
    issues: 0,
    done: false,
  }
  const flush = async (done = false) => {
    result.done = done
    const resumed = done
      ? undefined
      : new Promise<void>((resolve) => {
          acknowledge = resolve
        })
    parentPort!.postMessage(result)
    // Structured clone has copied the arrays; never retain the entire listing.
    result.directories = []
    result.linked = []
    if (resumed) await resumed
  }
  const consume = (name: string, st: Stats) => {
    if (st.isSymbolicLink()) {
      result.skippedLinks++
      return
    }
    if (st.isDirectory()) {
      result.directories.push({ name, mount: st.dev !== task.device })
      return
    }
    if (!st.isFile()) return
    result.files++
    const file = { name, bytes: st.blocks * 512, apparentBytes: st.size }
    if (st.nlink > 1)
      result.linked.push({ ...file, inode: `${st.dev}:${st.ino}` })
    else {
      result.bytes += file.bytes
      result.apparentBytes += file.apparentBytes
      retainFile(result.topFiles, file, task.topFiles)
    }
  }
  let directory: Dir | undefined
  try {
    const root =
      task.engine === "sync" ? lstatSync(task.path) : await lstat(task.path)
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      root.dev !== task.device
    )
      throw new Error("Directory changed or crosses a filesystem boundary")
    directory =
      task.engine === "sync" ? opendirSync(task.path) : await opendir(task.path)
    let eof = false,
      nextProgress = Date.now() + 250
    while (!eof) {
      // Async fan-out is bounded too; a single wide directory cannot grow RAM.
      const entries: Dirent[] = []
      for (let i = 0; i < (task.engine === "sync" ? 128 : 8); i++) {
        const entry =
          task.engine === "sync" ? directory.readSync() : await directory.read()
        if (!entry) {
          eof = true
          break
        }
        entries.push(entry)
      }
      const visit = async (entry: Dirent) => {
        if (entry.isSymbolicLink()) {
          result.skippedLinks++
          return
        }
        try {
          consume(
            entry.name,
            task.engine === "sync"
              ? lstatSync(join(task.path, entry.name))
              : await lstat(join(task.path, entry.name))
          )
        } catch {
          result.issues++
        }
      }
      if (task.engine === "sync")
        for (const entry of entries) {
          if (entry.isSymbolicLink()) {
            result.skippedLinks++
            continue
          }
          try {
            consume(entry.name, lstatSync(join(task.path, entry.name)))
          } catch {
            result.issues++
          }
          if (Date.now() >= nextProgress) {
            await flush()
            nextProgress = Date.now() + 250
          }
        }
      else await Promise.all(entries.map(visit))
      if (
        result.directories.length + result.linked.length >= 128 ||
        Date.now() >= nextProgress
      ) {
        await flush()
        nextProgress = Date.now() + 250
      }
    }
  } catch (error) {
    result.issues++
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    if (directory) {
      try {
        if (task.engine === "sync") directory.closeSync()
        else await directory.close()
      } catch {
        /* Enumeration error is already recorded. */
      }
    }
  }
  await flush(true)
}
parentPort!.on("message", (task: DirectoryTask | { ack: true }) => {
  if ("ack" in task) {
    const resume = acknowledge
    acknowledge = undefined
    resume?.()
  } else void read(task)
})
