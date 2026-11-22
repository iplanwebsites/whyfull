export type { ScanDrive } from "./drives"
export type { WhyfullJsonReport } from "./types"
import type { DiskSnapshot, DiskPolicy } from "./filesystem-types"
import type { ViewerPreferences } from "./disk-policy"
import type { ScanProgress } from "./scan-progress"
import type { ScanDrive } from "./drives"
export type { ScanProgress } from "./scan-progress"
export type { ViewerPreferences } from "./disk-policy"
export type { TrashPlan } from "./trash"

export interface ViewEntry {
  id: string
  name: string
  path?: string
  value: number
  colorPath?: number[]
  apparentBytes?: number
  kind: "directory" | "file" | "remainder" | "group"
  state?: string
  files?: number
  issues?: number
  excluded?: number
  reason?: string
  mark?: "trash" | "useless" | null
  kept?: boolean
  directKeep?: boolean
  trashed?: boolean
  tier?: string
  tool?: string
  advice?: string
  children?: ViewEntry[]
}

export interface DirectoryView {
  node: ViewEntry
  chart: ViewEntry
  crumbs: Array<{ id: number; name: string; path: string }>
  entries: ViewEntry[]
  total: number
  offset: number
  ownFiles: number
  retainedFiles: number
  ownBytes: number
  largestFileBytes: number
  fileScope: "largest" | "all"
}

export interface ViewerStatus extends Omit<
  DiskSnapshot,
  "directories" | "policy"
> {
  /** No scan has started yet (--ui --no-scan). */
  awaitingScan?: boolean
  directories: number
  bytes: number
  pending: number
  progress: ScanProgress | null
  excluded: number
  volume: { total: number; free: number; used: number } | null
  policy: DiskPolicy
  policyFile: string
  saveError: string | null
  savedPath: string | null
  snapshotMode: boolean
  documentId: string
  revision: number
  cache: {
    restored: boolean
    completedAt: string | null
    refreshing: boolean
  } | null
  navigation?: { path: string }
  source: { kind: "live" | "snapshot" | "report"; name: string | null }
  viewer: ViewerPreferences
  cleanup: {
    mode: "demo" | "trash"
    enabled: boolean
    supported: boolean
    reason: string | null
  }
  homeDirectory: string
  homeDestination: ScanDrive
  directoryDestination?: ScanDrive | null
  finderAvailable: boolean
  needsRescan: boolean
  scanners: {
    selected: "node" | "rust"
    active: "node" | "rust"
    rust: { available: boolean; reason: string | null }
  }
}

export interface ShortlistEntry {
  path: string
  name: string
  mark: "trash" | "useless"
  id: string | null
  bytes: number | null
  partial: boolean
  kept: boolean
}

export type { DiagnosticsStatus } from "./diagnostics"

export type { FileDistribution } from "./file-distribution"

/** Desktop-only honor-system license state. `enabled` is false for npx/CLI viewers. */
export type LicenseView =
  | { enabled: false }
  | {
      enabled: true
      licensed: boolean
      holder: string | null
      licenseId: string | null
      trialDays: number
      usageDays: number
      trialRemaining: number
      /** Unlicensed, trial used up, and no reminder shown today. */
      reminderDue: boolean
      price: string
      checkoutUrl: string
    }
