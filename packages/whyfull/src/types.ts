/** Safety tier — how confidently we can suggest deletion. */
export type Tier = "AUTO" | "REBUILD" | "JUDGEMENT" | "APP" | "DATA"

export interface TierMeta {
  rank: number
  label: string
  note: string
}

/** A known cache / model / data location. */
export interface Target {
  id: string
  label: string
  group: string
  tier: Tier
  hint: string
  paths: {
    darwin: Array<string | null>
    linux: Array<string | null>
    win32: Array<string | null>
  }
  /** Max walk depth for huge trees. */
  depth?: number
  /** File-count budget before estimating. */
  budget?: number
  /** Subdirectory to drill into for child scan. */
  childrenDir?: string
}

/** A target resolved for a specific platform. */
export interface ResolvedTarget extends Target {
  candidates: Array<string | null>
}

/** A scanned target with measurements. */
export interface ScannedTarget extends Omit<ResolvedTarget, "childrenDir"> {
  path: string | null
  bytes: number | null
  files?: number
  present: boolean
  denied?: boolean
  partial?: boolean
  childrenDir?: string
  children: ChildEntry[]
}

/** A child directory within a target. */
export interface ChildEntry {
  name: string
  path: string
  bytes: number
  atime: Date | null
}

/** Volume capacity. */
export interface VolumeInfo {
  total: number
  free: number
  used: number
}

/** The full scan report. */
export interface Report {
  platform: NodeJS.Platform
  volume: VolumeInfo | null
  targets: ScannedTarget[]
  denied: number
  partial: number
  exact: boolean
  total: number
  generatedAt: string
}

/** A tier group in the ranked output. */
export interface TierGroup extends TierMeta {
  tier: Tier
  items: ScannedTarget[]
  bytes: number
}

/** Measurement result. */
export interface MeasureResult {
  bytes: number
  files: number
  denied: boolean
  partial: boolean
  pending: number
}

/** Options for measure(). */
export interface MeasureOptions {
  maxDepth?: number
  seen?: Set<string>
  budget?: number
}

/** Options for scan(). */
export interface ScanOptions {
  platform?: NodeJS.Platform
  top?: number
  onProgress?: ((label: string) => void) | null
  exact?: boolean
}

/** Options for render(). */
export interface RenderOptions {
  showAll?: boolean
}
