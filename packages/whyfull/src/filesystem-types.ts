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
  policy?: DiskPolicy
  topFiles?: number
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

export interface DirectoryResult {
  id: number
  directories: Array<{ name: string; mount: boolean }>
  topFiles: DiskFile[]
  linked: Array<DiskFile & { inode: string }>
  bytes: number
  apparentBytes: number
  files: number
  skippedLinks: number
  issues: number
  error?: string
}
