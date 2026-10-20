import { EventEmitter } from "node:events"
import { lstatSync, realpathSync } from "node:fs"
import { availableParallelism, homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { Worker } from "node:worker_threads"
import { normalizePolicyPath, pathWithin, policyPath } from "./disk-policy"
import type {
  DirectoryResult,
  DiskDirectory,
  DiskScanOptions,
  DiskSnapshot,
} from "./filesystem-types"

export function defaultScanWorkers(): number {
  return Math.min(8, Math.max(1, availableParallelism() - 1))
}

/** One visit per directory; synchronous metadata calls run in isolated workers.
 * Only directory nodes + top direct files are retained, never file contents. */
export class DiskScanner extends EventEmitter {
  readonly snapshot: DiskSnapshot
  private device: number
  private queue: number[] = [0]
  private cursor = 0
  private active = new Map<Worker, number>()
  private pool: Worker[] = []
  private linked = new Set<string>()
  private timer?: ReturnType<typeof setInterval>
  private start = Date.now()
  private topFiles: number
  private running = false
  private cleanupSignal?: () => void
  private resolveRun?: (snapshot: DiskSnapshot) => void

  constructor(private options: DiskScanOptions) {
    super()
    const input = resolve(
      options.root === "~"
        ? homedir()
        : options.root.startsWith("~/")
          ? join(homedir(), options.root.slice(2))
          : options.root
    )
    if (lstatSync(input).isSymbolicLink())
      throw new Error("Choose a directory, not a symlink")
    const root = realpathSync(input)
    const st = lstatSync(root)
    if (!st.isDirectory()) throw new Error("Scan root must be a directory")
    this.device = st.dev
    this.topFiles = options.topFiles ?? 32
    if (
      !Number.isInteger(this.topFiles) ||
      this.topFiles < 1 ||
      this.topFiles > 1000
    )
      throw new Error("topFiles must be between 1 and 1000")
    const workers = options.workers ?? defaultScanWorkers()
    if (!Number.isInteger(workers) || workers < 1 || workers > 32)
      throw new Error("workers must be between 1 and 32")
    if (options.engine && !["sync", "async"].includes(options.engine))
      throw new Error("engine must be sync or async")
    this.snapshot = {
      format: "whyfull-disk",
      schemaVersion: 1,
      root,
      startedAt: new Date(this.start).toISOString(),
      completedAt: null,
      durationMs: 0,
      status: "scanning",
      workers,
      engine: options.engine ?? "sync",
      files: 0,
      skippedLinks: 0,
      issues: 0,
      policy: {
        keep: (options.policy?.keep ?? []).map(normalizePolicyPath),
        exclude: (options.policy?.exclude ?? []).map(normalizePolicyPath),
      },
      directories: [],
    }
    this.addDirectory(root, null)
  }

  private addDirectory(
    path: string,
    parent: number | null,
    reason?: string
  ): number {
    const id = this.snapshot.directories.length
    const excluded =
      reason ||
      this.snapshot.policy.exclude.some((p) =>
        pathWithin(policyPath(path), policyPath(p))
      )
    this.snapshot.directories.push({
      id,
      parent,
      path,
      name: basename(path) || path,
      children: [],
      topFiles: [],
      ownBytes: 0,
      ownApparentBytes: 0,
      ownFiles: 0,
      bytes: 0,
      apparentBytes: 0,
      files: 0,
      directories: 0,
      issues: 0,
      excluded: excluded ? 1 : 0,
      state: excluded ? "excluded" : "pending",
      ...(excluded ? { reason: reason || "Excluded by your preferences" } : {}),
    })
    return id
  }

  run(): Promise<DiskSnapshot> {
    if (this.running) throw new Error("Scanner can only run once")
    this.running = true
    return new Promise((resolve) => {
      this.resolveRun = resolve
      if (this.options.signal?.aborted) {
        this.finish("cancelled")
        return
      }
      const abort = () => this.cancel()
      this.options.signal?.addEventListener("abort", abort, { once: true })
      this.cleanupSignal = () =>
        this.options.signal?.removeEventListener("abort", abort)
      this.timer = setInterval(() => this.progress(), 500)
      for (let i = 0; i < this.snapshot.workers; i++) {
        const worker = new Worker(new URL("./fs-worker.mjs", import.meta.url))
        this.pool.push(worker)
        worker.on("message", (result: DirectoryResult) => {
          if (this.snapshot.status !== "scanning") return
          this.accept(result)
          this.active.delete(worker)
          this.dispatch()
        })
        worker.on("error", (error) => {
          if (this.snapshot.status !== "scanning") return
          const id = this.active.get(worker)
          if (id !== undefined) {
            const node = this.snapshot.directories[id]
            node.state = "unreadable"
            node.reason = error.message
            node.issues++
            this.snapshot.issues++
          }
          this.finish("failed")
        })
        worker.on("exit", (code) => {
          if (this.snapshot.status === "scanning" && code !== 0)
            this.finish("failed")
        })
      }
      this.dispatch()
    })
  }

  cancel(): void {
    if (this.snapshot.status === "scanning") this.finish("cancelled")
  }

  private dispatch() {
    for (const worker of this.pool) {
      if (this.active.has(worker)) continue
      while (
        this.cursor < this.queue.length &&
        this.snapshot.directories[this.queue[this.cursor]].state !== "pending"
      )
        this.cursor++
      if (this.cursor >= this.queue.length) break
      const id = this.queue[this.cursor++]
      this.active.set(worker, id)
      worker.postMessage({
        id,
        path: this.snapshot.directories[id].path,
        device: this.device,
        topFiles: this.topFiles,
        engine: this.snapshot.engine,
      })
    }
    if (!this.active.size && this.cursor >= this.queue.length)
      this.finish("complete")
    // Release consumed queue storage periodically on very large filesystems.
    if (this.cursor > 10000) {
      this.queue = this.queue.slice(this.cursor)
      this.cursor = 0
    }
  }

  private accept(result: DirectoryResult) {
    const node = this.snapshot.directories[result.id]
    for (const file of result.linked) {
      result.files++
      if (this.linked.has(file.inode)) continue
      this.linked.add(file.inode)
      result.bytes += file.bytes
      result.apparentBytes += file.apparentBytes
      result.topFiles.push({
        name: file.name,
        bytes: file.bytes,
        apparentBytes: file.apparentBytes,
      })
    }
    node.topFiles = result.topFiles
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, this.topFiles)
    node.ownBytes = result.bytes
    node.ownApparentBytes = result.apparentBytes
    node.ownFiles = result.files
    node.issues = result.issues
    node.state = result.error ? "unreadable" : "scanned"
    if (result.error) node.reason = result.error
    this.snapshot.files += result.files
    this.snapshot.skippedLinks += result.skippedLinks
    this.snapshot.issues += result.issues
    for (const child of result.directories) {
      const id = this.addDirectory(
        join(node.path, child.name),
        node.id,
        child.mount ? "Different filesystem; scan separately" : undefined
      )
      node.children.push(id)
      if (this.snapshot.directories[id].state === "pending") this.queue.push(id)
    }
  }

  /** Parent IDs precede their children, so aggregation needs one reverse pass. */
  aggregate(): void {
    const dirs = this.snapshot.directories
    for (const node of dirs) {
      node.bytes = node.ownBytes
      node.apparentBytes = node.ownApparentBytes
      node.files = node.ownFiles
      node.directories = 0
      node.excluded = node.state === "excluded" ? 1 : 0
    }
    for (let i = dirs.length - 1; i > 0; i--) {
      const node = dirs[i],
        parent = dirs[node.parent!]
      parent.bytes += node.bytes
      parent.apparentBytes += node.apparentBytes
      parent.files += node.files
      parent.directories += node.directories + 1
      parent.excluded += node.excluded
    }
    this.snapshot.durationMs = Date.now() - this.start
  }

  private progress() {
    this.aggregate()
    this.options.onProgress?.(this.snapshot)
    this.emit("progress", this.snapshot)
  }

  private finish(status: DiskSnapshot["status"]) {
    if (this.snapshot.status !== "scanning") return
    this.snapshot.status = status
    this.snapshot.completedAt = new Date().toISOString()
    clearInterval(this.timer)
    this.cleanupSignal?.()
    for (const worker of this.pool) void worker.terminate()
    this.progress()
    this.emit("done", this.snapshot)
    this.resolveRun?.(this.snapshot)
  }
}

export async function scanFilesystem(
  options: DiskScanOptions
): Promise<DiskSnapshot> {
  return new DiskScanner(options).run()
}
