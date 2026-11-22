import { Worker } from "node:worker_threads"
import { availableParallelism } from "node:os"
import { statSync } from "node:fs"
import { basename, join } from "node:path"
import { pathWithin, policyPath } from "./disk-policy"
import { PRIVACY_REASON } from "./privacy"
import { SqliteScanner } from "./sqlite-scanner"
import type {
  DiskScanOptions,
  DiskSnapshot,
  DirectoryBatch,
  DirectoryTask,
} from "./filesystem-types"

export function defaultScanWorkers(): number {
  return Math.min(8, Math.max(1, availableParallelism() - 1))
}

/** Workers stream bounded batches. SQLite owns the frontier and hard-link set. */
export class DiskScanner extends SqliteScanner {
  private pool: Worker[] = []
  private active = new Map<
    Worker,
    DirectoryTask & { parent: number | null; name: string }
  >()
  private inFlight = new Map<Worker, DirectoryBatch>()
  private stopped?: () => void
  constructor(options: DiskScanOptions) {
    super({
      ...options,
      scanner: "node",
      workers: options.workers ?? defaultScanWorkers(),
    })
  }
  protected stop() {
    for (const worker of this.pool) void worker.terminate()
    this.stopped?.()
  }
  private refreshCounts() {
    this.files = this.snapshot.files = this.inventory.committedFiles
    this.bytes = this.inventory.committedBytes
    this.snapshot.issues = this.inventory.committedIssues
    this.snapshot.skippedLinks = this.inventory.committedLinks
    for (const value of this.inFlight.values()) {
      this.files += value.files
      this.bytes += value.bytes
      this.snapshot.issues += value.issues
      this.snapshot.skippedLinks += value.skippedLinks
    }
  }
  private discover(
    id: number,
    parent: number | null,
    name: string,
    path: string,
    mount = false
  ) {
    const reason = mount
      ? "Different filesystem; scan separately"
      : parent !== null && name === ".whyfull"
        ? "Whyfull scan cache"
        : this.snapshot.policy.exclude.some((p) =>
              pathWithin(policyPath(path), policyPath(p))
            )
          ? "Excluded by your preferences"
          : this.privacy.some((p) => pathWithin(policyPath(path), p))
            ? PRIVACY_REASON
            : null
    if (reason) {
      this.inventory.acceptDirectory(
        {
          id,
          parent,
          name,
          ownBytes: 0,
          ownApparentBytes: 0,
          ownFiles: 0,
          skippedLinks: 0,
          issues: 0,
          state: "excluded",
          reason,
          topFiles: [],
        },
        this.options.topFiles ?? 32
      )
      this.completed++
    } else this.inventory.enqueue(id, parent, name)
  }
  protected async crawl() {
    this.discover(
      0,
      null,
      basename(this.snapshot.root) || this.snapshot.root,
      this.snapshot.root
    )
    const device = statSync(this.snapshot.root).dev
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: unknown) => {
          if (settled) return
          settled = true
          if (error) reject(error)
          else resolve()
        }
        this.stopped = () => finish()
        const dispatch = () => {
          if (this.controller.signal.aborted) {
            finish()
            return
          }
          for (const worker of this.pool) {
            if (this.active.has(worker)) continue
            const next = this.inventory.takePending()
            if (!next) break
            const task = {
              ...next,
              device,
              topFiles: this.options.topFiles ?? 32,
              engine: this.snapshot.engine,
            }
            this.active.set(worker, task)
            worker.postMessage(task)
          }
          if (!this.active.size) finish()
        }
        for (let i = 0; i < this.snapshot.workers; i++) {
          const worker = new Worker(new URL("./fs-worker.mjs", import.meta.url))
          this.pool.push(worker)
          worker.on("error", finish)
          worker.on("exit", (code) => {
            if (!settled && !this.controller.signal.aborted)
              finish(new Error(`Node scanner worker exited (${code})`))
          })
          worker.on("message", (batch: DirectoryBatch) => {
            if (settled) return
            try {
              const task = this.active.get(worker)
              if (!task || task.id !== batch.id)
                throw new Error("Unexpected Node worker result")
              for (const linked of batch.linked)
                this.inventory.acceptLinked({ ...linked, directory: task.id })
              for (const child of batch.directories) {
                const id = this.discovered++
                this.discover(
                  id,
                  task.id,
                  child.name,
                  join(task.path, child.name),
                  child.mount
                )
              }
              this.inFlight.set(worker, batch)
              if (batch.done) {
                this.inventory.acceptDirectory(
                  {
                    id: task.id,
                    parent: task.parent,
                    name: task.name,
                    ownBytes: batch.bytes,
                    ownApparentBytes: batch.apparentBytes,
                    ownFiles: batch.files,
                    skippedLinks: batch.skippedLinks,
                    issues: batch.issues,
                    state: batch.error ? "unreadable" : "scanned",
                    reason: batch.error ?? null,
                    topFiles: batch.topFiles,
                  },
                  this.options.topFiles ?? 32
                )
                this.completed++
                this.inFlight.delete(worker)
                this.active.delete(worker)
              }
              this.lastActivity = Date.now() - this.started
              this.refreshCounts()
              this.checkpoint(
                1 + batch.directories.length + batch.linked.length
              )
              dispatch()
              if (!batch.done) worker.postMessage({ ack: true })
            } catch (error) {
              finish(error)
            }
          })
        }
        dispatch()
      })
    } finally {
      this.stopped = undefined
      await Promise.all(this.pool.map((worker) => worker.terminate()))
      this.pool = []
      this.active.clear()
      this.inFlight.clear()
    }
  }
}
export async function scanFilesystem(
  options: DiskScanOptions
): Promise<DiskSnapshot> {
  const scanner =
    options.scanner === "rust"
      ? new (await import("./rust-scanner")).RustScanner(options)
      : new DiskScanner(options)
  try {
    return await scanner.run()
  } catch (error) {
    scanner.inventory.dispose()
    throw error
  }
}
