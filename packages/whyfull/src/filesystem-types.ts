/** Compact directory inventory. Every regular file is measured, only the largest
 * direct files are retained. This bounds memory on multi-million-file disks. */
export interface DiskFile {
  name: string
  bytes: number
  apparentBytes: number
}

export interface DiskDirectory {
  id: number
  parent: number | null
  path: string
  name: string
  children: number[]
  topFiles: DiskFile[]
  ownBytes: number
  ownApparentBytes: number
  ownFiles: number
  bytes: number
  apparentBytes: number
  files: number
  directories: number
  issues: number
  excluded: number
  state: "pending" | "scanned" | "excluded" | "unreadable"
  reason?: string
}

export interface DiskPolicy {
  keep: string[]
  exclude: string[]
}

export interface DiskSnapshot {
  format: "whyfull-disk"
  schemaVersion: 1
  root: string
  startedAt: string
  completedAt: string | null
  durationMs: number
  status: "scanning" | "complete" | "cancelled" | "failed"
  workers: number
  engine: "sync" | "async"
  /** Missing on older snapshots, which were scanned with Node. */
  scanner?: "node" | "rust"
  storage?: "sqlite"
  timings?: {
    crawlMs: number
    aggregationMs: number
    indexingMs: number
    finalizeMs: number
    totalMs: number
  }
  files: number
  skippedLinks: number
  issues: number
  policy: DiskPolicy
  directories: DiskDirectory[]
}

export interface DiskScanOptions {
  root: string
  workers?: number
  engine?: "sync" | "async"
  scanner?: "node" | "rust"
  /** Server-owned override; never accepted from viewer requests. */
  rustBinary?: string
  /** Private working storage for either scanner. */
  inventoryDirectory?: string
  /** @deprecated Use inventoryDirectory. */
  rustDirectory?: string
  policy?: DiskPolicy
  topFiles?: number
  /** macOS: read Photos, Music and other folders that trigger permission dialogs. */
  includePrivate?: boolean
  signal?: AbortSignal
  onProgress?: (snapshot: DiskSnapshot) => void
}

export interface DirectoryTask {
  id: number
  path: string
  device: number
  topFiles: number
  engine: "sync" | "async"
}

/** One bounded worker batch; counters are cumulative for this directory. */
export interface DirectoryBatch {
  id: number
  directories: Array<{ name: string; mount: boolean }>
  topFiles: DiskFile[]
  linked: Array<DiskFile & { inode: string }>
  bytes: number
  apparentBytes: number
  files: number
  skippedLinks: number
  issues: number
  done: boolean
  error?: string
}
