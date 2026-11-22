import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { policyPath } from "./disk-policy"
import { rustScannerAvailability } from "./sqlite-inventory"
import type {
  InventoryDirectoryRecord,
  InventoryLinkedRecord,
} from "./sqlite-inventory"
import type { DiskScanOptions } from "./filesystem-types"
import { SqliteScanner } from "./sqlite-scanner"

interface StatsRecord {
  kind: "progress" | "summary"
  files: number
  bytes: number
  apparentBytes: number
  directories: number
  discoveredDirectories: number
  skippedLinks: number
  issues: number
  durationMs: number
}
type Record =
  | StatsRecord
  | ({ kind: "directory" } & InventoryDirectoryRecord)
  | ({ kind: "linked" } & InventoryLinkedRecord)
  | { kind: "start"; protocol: number; root: string }

export class RustScanner extends SqliteScanner {
  private child?: ChildProcess
  private binary: string
  constructor(options: DiskScanOptions) {
    super({ ...options, scanner: "rust", workers: options.workers ?? 4 })
    const availability = rustScannerAvailability(options.rustBinary)
    if (!availability.available) throw new Error(availability.reason!)
    this.binary = availability.binary!
  }
  protected stop() {
    this.child?.kill("SIGTERM")
  }
  protected async crawl() {
    try {
      const root = this.snapshot.root
      const excludes = [...this.snapshot.policy.exclude, ...this.privacy].map(
        (p) =>
          root === "/System/Volumes/Data" ||
          root.startsWith("/System/Volumes/Data/")
            ? "/System/Volumes/Data" +
              (policyPath(p) === "/" ? "" : policyPath(p))
            : policyPath(p)
      )
      this.child = spawn(
        this.binary,
        [
          root,
          String(this.snapshot.workers),
          String(this.options.topFiles ?? 32),
          "256",
          ...excludes,
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      )
      let stderr = ""
      this.child.stderr!.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-8192)
      })
      const exit = new Promise<{
        code?: number | null
        signal?: string | null
        error?: Error
      }>((resolveExit) => {
        this.child!.once("error", (error) => resolveExit({ error }))
        this.child!.once("close", (code, signal) =>
          resolveExit({ code, signal })
        )
      })
      let pending = "",
        handshake = false,
        summary: StatsRecord | undefined
      this.child.stdout!.setEncoding("utf8")
      for await (const chunk of this.child.stdout!) {
        if (this.controller.signal.aborted) break
        pending += chunk
        let newline
        while ((newline = pending.indexOf("\n")) >= 0) {
          if (newline > 8 * 1024 ** 2)
            throw new Error("Oversized Rust scanner record")
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          if (!line) continue
          const record = JSON.parse(line) as Record
          if (summary)
            throw new Error("Rust scanner sent data after its summary")
          if (record.kind === "start") {
            if (handshake || record.protocol !== 1 || record.root !== root)
              throw new Error("Invalid Rust scanner handshake")
            handshake = true
          } else {
            if (!handshake) throw new Error("Missing Rust scanner handshake")
            if (record.kind === "directory") {
              this.inventory.acceptDirectory(
                record,
                this.options.topFiles ?? 32
              )
              this.completed++
            } else if (record.kind === "linked")
              this.inventory.acceptLinked(record)
            else if (record.kind === "progress" || record.kind === "summary") {
              this.discovered = record.discoveredDirectories
              this.files = this.snapshot.files = record.files
              this.bytes = record.bytes + this.inventory.linkedBytes
              this.snapshot.issues = record.issues
              this.snapshot.skippedLinks = record.skippedLinks
              if (record.kind === "summary") summary = record
            } else throw new Error("Unknown Rust scanner record")
          }
          this.lastActivity = Date.now() - this.started
          this.checkpoint()
        }
        if (pending.length > 8 * 1024 ** 2)
          throw new Error("Oversized Rust scanner record")
      }
      const result = await exit
      if (this.controller.signal.aborted) return
      if (result.error || result.code !== 0)
        throw (
          result.error ??
          new Error(
            `Rust scanner exited (${result.code ?? result.signal}): ${stderr}`
          )
        )
      if (pending.trim() || !summary)
        throw new Error("Rust scanner ended without a complete summary")
      if (
        summary.files !== this.inventory.committedFiles ||
        summary.directories !== this.completed ||
        summary.bytes + this.inventory.linkedBytes !==
          this.inventory.committedBytes ||
        summary.apparentBytes + this.inventory.linkedApparentBytes !==
          this.inventory.committedApparentBytes ||
        summary.issues !== this.inventory.committedIssues ||
        summary.skippedLinks !== this.inventory.committedLinks
      )
        throw new Error(
          "Rust scanner summary disagrees with the persisted inventory"
        )
    } finally {
      if (
        this.child &&
        this.child.exitCode === null &&
        this.child.signalCode === null
      ) {
        this.stop()
        await new Promise<void>((resolve) =>
          this.child!.once("close", () => resolve())
        )
      }
    }
  }
}
