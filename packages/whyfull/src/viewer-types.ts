import type { DiskSnapshot, DiskPolicy } from "./filesystem-types"
import type { ViewerPreferences } from "./disk-policy"
export type { ViewerPreferences } from "./disk-policy"
export type { TrashPlan } from "./trash"

export interface ViewEntry {
  id: string
  name: string
  path?: string
  value: number
  apparentBytes?: number
  kind: "directory" | "file" | "remainder" | "group"
  state?: string
  files?: number
  issues?: number
  excluded?: number
  reason?: string
  mark?: "delete" | "useless" | null
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
}

export interface ViewerStatus extends Omit<
  DiskSnapshot,
  "directories" | "policy"
> {
  directories: number
  bytes: number
  pending: number
  excluded: number
  volume: { total: number; free: number; used: number } | null
  policy: DiskPolicy
  policyFile: string
  saveError: string | null
  savedPath: string | null
  snapshotMode: boolean
  viewer: ViewerPreferences
  cleanup: {
    mode: "demo" | "trash"
    enabled: boolean
    supported: boolean
    reason: string | null
  }
  finderAvailable: boolean
  needsRescan: boolean
}
