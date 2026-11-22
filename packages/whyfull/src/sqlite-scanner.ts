import { EventEmitter } from "node:events"
import { lstatSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import {
  SqliteInventory,
  inventoryIdentity,
  inventoryWorkingDirectory,
} from "./sqlite-inventory"
import { normalizePolicyPath } from "./disk-policy"
import { ScanProgressTracker } from "./scan-progress"
import { privacyExclusions } from "./privacy"
import type { ScanProgress } from "./scan-progress"
import type { DiskScanOptions, DiskSnapshot } from "./filesystem-types"

/** Both crawlers share the writer, commit policy, rollup, indexes and lifecycle. */
export abstract class SqliteScanner extends EventEmitter {
  readonly snapshot: DiskSnapshot
  readonly inventory: SqliteInventory
  scanProgress!: ScanProgress
  protected controller = new AbortController()
  private tracker = new ScanProgressTracker()
  protected started = Date.now()
  private running = false
  private finalizing = false
  protected discovered = 1
  protected completed = 0
  protected files = 0
  protected bytes = 0
  protected lastActivity = 0
  private batch = 0
  private lastCommit = Date.now()
  /** Folders macOS guards with a permission dialog; never read during scans. */
  protected privacy: string[] = []

  constructor(protected options: DiskScanOptions) {
    super()
    const [major, minor] = process.versions.node.split(".").map(Number)
    if (major < 22 || (major === 22 && minor < 18))
      throw new Error("SQLite scans require Node 22.18 or newer")
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
    if (!lstatSync(root).isDirectory())
      throw new Error("Scan root must be a directory")
    this.privacy = options.includePrivate ? [] : privacyExclusions(root)
    const workers = options.workers ?? 4,
      topFiles = options.topFiles ?? 32
    if (!Number.isInteger(workers) || workers < 1 || workers > 32)
      throw new Error("workers must be between 1 and 32")
    if (!Number.isInteger(topFiles) || topFiles < 1 || topFiles > 1000)
      throw new Error("topFiles must be between 1 and 1000")
    if (options.engine && !["sync", "async"].includes(options.engine))
      throw new Error("engine must be sync or async")
    const metadata: Omit<DiskSnapshot, "directories"> = {
      format: "whyfull-disk",
      schemaVersion: 1,
      root,
      startedAt: new Date(this.started).toISOString(),
      completedAt: null,
      durationMs: 0,
      status: "scanning",
      workers,
      engine: options.engine ?? "sync",
      scanner: options.scanner ?? "node",
      storage: "sqlite",
      files: 0,
      skippedLinks: 0,
      issues: 0,
      policy: {
        keep: (options.policy?.keep ?? []).map(normalizePolicyPath),
        exclude: (options.policy?.exclude ?? []).map(normalizePolicyPath),
      },
    }
    this.inventory = new SqliteInventory(
      join(
        options.inventoryDirectory ??
          options.rustDirectory ??
          inventoryWorkingDirectory(),
        randomUUID() + ".sqlite"
      ),
      metadata,
      inventoryIdentity(root, options)
    )
    this.snapshot = this.inventory.snapshot
    this.progress()
  }
  protected abstract crawl(): Promise<void>
  protected abstract stop(): void
  protected checkpoint(records = 1) {
    this.batch += records
    if (this.batch >= 256 || Date.now() - this.lastCommit >= 1000) {
      this.inventory.checkpoint()
      this.batch = 0
      this.lastCommit = Date.now()
    }
  }
  protected progress() {
    if (this.snapshot.status === "scanning")
      this.snapshot.durationMs = Date.now() - this.started
    this.inventory.directoryCount = this.discovered
    this.scanProgress = this.tracker.update({
      status: this.snapshot.status,
      elapsedMs: this.snapshot.durationMs,
      discoveredDirectories: this.discovered,
      completedDirectories: this.completed,
      files: this.files,
      bytes: this.bytes,
      activeWorkers:
        this.snapshot.status === "scanning"
          ? this.finalizing
            ? 1
            : this.snapshot.workers
          : 0,
      currentPath:
        this.snapshot.status === "scanning" ? this.snapshot.root : null,
      lastWorkerActivityMs: this.lastActivity,
    })
    if (this.finalizing && this.snapshot.status === "scanning")
      this.scanProgress = {
        ...this.scanProgress,
        phase: "finalizing",
        percent: null,
        remainingMs: null,
      }
    this.options.onProgress?.(this.snapshot)
    this.emit("progress", this.snapshot)
  }
  cancel() {
    this.controller.abort()
    this.stop()
    if (!this.running) this.finish("cancelled")
  }
  private finish(status: DiskSnapshot["status"]) {
    this.snapshot.status = status
    if (status !== "complete" || !this.snapshot.completedAt)
      this.snapshot.completedAt = new Date().toISOString()
    if (status !== "complete")
      this.snapshot.durationMs = Date.now() - this.started
    this.progress()
    this.emit("done", this.snapshot)
    return this.snapshot
  }
  async run() {
    if (this.running) throw new Error("Scanner can only run once")
    this.running = true
    const abort = () => this.cancel()
    this.options.signal?.addEventListener("abort", abort, { once: true })
    let initialized = false,
      timer: ReturnType<typeof setInterval> | undefined
    try {
      if (this.options.signal?.aborted || this.controller.signal.aborted)
        return this.finish("cancelled")
      this.inventory.initialize()
      initialized = true
      timer = setInterval(() => this.progress(), 500)
      await this.crawl()
      if (this.controller.signal.aborted) return this.finish("cancelled")
      const crawlMs = Date.now() - this.started
      this.files = this.snapshot.files = this.inventory.committedFiles
      this.bytes = this.inventory.committedBytes
      this.snapshot.issues = this.inventory.committedIssues
      this.snapshot.skippedLinks = this.inventory.committedLinks
      this.finalizing = true
      this.progress()
      let lastProgress = Date.now()
      const stages = await this.inventory.aggregate(
        this.controller.signal,
        () => {
          if (Date.now() - lastProgress >= 500) {
            this.lastActivity = Date.now() - this.started
            this.progress()
            lastProgress = Date.now()
          }
        }
      )
      if (this.controller.signal.aborted) return this.finish("cancelled")
      this.discovered = this.completed = this.inventory.count
      this.snapshot.status = "complete"
      this.snapshot.completedAt = new Date().toISOString()
      const finalizeStart = Date.now()
      this.snapshot.timings = {
        crawlMs,
        ...stages,
        finalizeMs: 0,
        totalMs: Date.now() - this.started,
      }
      this.snapshot.durationMs = this.snapshot.timings.totalMs
      this.inventory.finish(() => {
        this.snapshot.timings!.finalizeMs = Date.now() - finalizeStart
        this.snapshot.timings!.totalMs = this.snapshot.durationMs =
          Date.now() - this.started
      })
      initialized = false
      return this.finish("complete")
    } catch (error) {
      this.stop()
      if (this.controller.signal.aborted) return this.finish("cancelled")
      this.inventory.complete = false
      this.inventory.error =
        error instanceof Error ? error.message : String(error)
      this.finish("failed")
      throw error
    } finally {
      clearInterval(timer)
      this.options.signal?.removeEventListener("abort", abort)
      if (initialized) {
        try {
          this.inventory.finish()
        } catch {
          this.inventory.suspend()
        }
      }
    }
  }
}
