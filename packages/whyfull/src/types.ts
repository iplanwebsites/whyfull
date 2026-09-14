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
  /** Strongest lower bound obtained from drill-down details, before top-N. */
  detailBytesLowerBound?: number
  /** True when one or more detail measurements stopped at their file budget. */
  detailMeasurementsPartial?: boolean
  /** pnpm store only: the per-format `v*` folders inside it. */
  storeVersions?: StoreVersion[]
}

/** A child file or directory within a target. */
export interface ChildEntry {
  name: string
  path: string
  bytes: number
  /** Last-access time as epoch ms; -1 when unavailable. */
  atimeMs: number
  /**
   * Of `bytes`, how many are clones/hard links of a pnpm store on the same
   * device. Present only when the heuristic in pnpm.ts fires. Upper bound.
   */
  sharedBytes?: number
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
  discovered?: DiscoverResult | null
  cacheHogs?: DiscoverResult | null
  worktrees?: WorktreeResult | null
}

// ------------------------------------------------------------ discovery ----

/** A child file or directory within a discovered entry. */
export interface DiscoveredChild {
  name: string
  path: string
  bytes: number
}

/** A discovered large file or directory outside the known target set. */
export interface DiscoveredDir {
  name: string
  path: string
  bytes: number
  root: string
  children: DiscoveredChild[]
}

/** Discovery scan result. */
export interface DiscoverResult {
  dirs: DiscoveredDir[]
  threshold: number
}

/** One shallow root used by discovery. Public for deterministic callers/tests. */
export interface DiscoverRoot {
  path: string
  label: string
}

/** Options for discover(). */
export interface DiscoverOptions {
  platform?: NodeJS.Platform
  /** Override the platform defaults with explicit shallow roots. */
  roots?: DiscoverRoot[]
  /** Override common source roots searched shallowly for project .cache dirs. */
  projectRoots?: DiscoverRoot[]
  /** Minimum bytes to report (default 5 GB). */
  threshold?: number
  /** Maximum results to return (default 20). */
  maxResults?: number
  /** Number of top children to report per discovered dir (default 3). */
  drill?: number
  onProgress?: ((name: string) => void) | null
}

// ----------------------------------------------------------------- pnpm ----

/** One `v<N>` folder inside a pnpm content-addressable store. */
export interface StoreVersion {
  name: string
  path: string
  /** The N in `v<N>`, for "newest" comparisons. */
  version: number
  bytes: number
  files: number
  partial: boolean
  mtimeMs: number
  birthtimeMs: number
  /** Written by an older pnpm store format that no current store uses. */
  stale: boolean
}

/** Result of the "is this node_modules cloned from a store" heuristic. */
export interface SharedStoreInfo {
  storeDir: string
  sameDevice: boolean
}

// ------------------------------------------------------------ worktrees ----

/** Which tool created a worktree, guessed from its path. */
export type WorktreeTool =
  | "claude"
  | "codex"
  | "gemini"
  | "windsurf"
  | "cursor"
  | "conductor"
  | "vibe-kanban"
  | "copilot"
  | "junie"
  | "zed"
  | "opencode"
  | "manual"

/**
 * `linked`  — registered and present, the normal case.
 * `locked`  — registered, present, and has a `locked` file (session may be live).
 * `orphan`  — the directory exists but its admin dir is gone or points elsewhere.
 * `stale`   — registered in the admin dir but the directory is missing (~0 bytes).
 */
export type WorktreeState = "linked" | "orphan" | "stale" | "locked"

/** One linked worktree (or one stale registration). */
export interface WorktreeEntry {
  path: string
  name: string
  mainRepo: string
  tool: WorktreeTool
  state: WorktreeState
  branch: string | null
  detached: boolean
  /** max(mtime of admin HEAD, admin index); -1 when neither is readable. */
  lastActivityMs: number
  /** ISO-8601 form of lastActivityMs; null when Git metadata has no date. */
  lastActivityAt: string | null
  /** Which Git admin file supplied lastActivityMs. */
  lastActivitySource: "head" | "index" | null
  headMtimeMs: number
  indexMtimeMs: number
  gitdirMtimeMs: number
  /** index mtime > HEAD mtime: staged or checked out after the last commit. */
  dirtyHint: boolean
  bytes: number
  files: number
  partial: boolean
  /** Bytes of `node_modules` cloned/linked from a pnpm store. Upper bound. */
  sharedBytes: number
  /** Observed bytes not attributed to a shared pnpm store. */
  nonSharedBytes: number
  ageDays: number
  hint: string
  recommendation: WorktreeRecommendation
}

export type WorktreeRecommendationAction =
  "trash-worktree" | "prune-registration" | "review-locked" | "trash-orphan"

/** Structured counterpart to the terminal worktree hint. */
export interface WorktreeRecommendation {
  action: WorktreeRecommendationAction
  summary: string
  /** Null when review is required before any command should be suggested. */
  command: string | null
  requiresReview: boolean
  /** True when the proposed command is protected by Git's refusal checks. */
  gitGuarded: boolean
}

/** Every worktree belonging to one main repo. */
export interface WorktreeCluster {
  mainRepo: string
  /** The admin directory: `<main>/.git/worktrees` or `<main>/.bare/worktrees`. */
  adminDir: string
  worktrees: WorktreeEntry[]
  /** Sum of apparent bytes. */
  bytes: number
  /** Sum of bytes − sharedBytes: what deleting everything would really free. */
  realBytes: number
}

/** findWorktrees() result. */
export interface WorktreeResult {
  clusters: WorktreeCluster[]
  seeds: string[]
  truncated: boolean
  /** Explains what "last activity" means to non-terminal renderers. */
  activityBasis: string
  scannedAt: string
}

/** Options for findWorktrees(). */
export interface WorktreeOptions {
  /** Extra seed directories to look under. */
  roots?: string[]
  /** Include the built-in home/code-root seeds (default true; false in tests). */
  includeDefaults?: boolean
  /** Only report worktrees at least this many days idle (default 0 = all). */
  minAgeDays?: number
  /**
   * File budget per worktree measure (default 20000). Low on purpose: every
   * worktree saturates any budget (node_modules alone is >100k files), so cost
   * is linear in the budget and 68 worktrees at 40k files takes 71s against 33s
   * at 20k. Sizes are honest lower bounds either way, marked "≥".
   */
  budget?: number
  /** Count every file, ignoring the budget. */
  exact?: boolean
  /** Stop after this many worktrees and set `truncated` (default 500). */
  maxWorktrees?: number
  onProgress?: ((label: string) => void) | null
}

// ----------------------------------------------------------- JSON report ----

export interface JsonReportOptions {
  top: number
  showAll: boolean
  exact: boolean
  discover: boolean
  cacheScan: boolean
  worktrees: boolean
  worktreeRoots: string[]
  worktreeAge: number
}

export interface JsonReportSummary {
  knownBytesLowerBound: number
  /** Total in tiers 1–3; these are candidates, not blanket-delete advice. */
  reclaimCandidateBytesLowerBound: number
  knownMeasurementsPartial: boolean
  presentTargetCount: number
  deniedTargetCount: number
  untrackedCacheBytesLowerBound: number
  discoveredBytesLowerBound: number
  worktreeCount: number
  worktreeApparentBytesLowerBound: number
  worktreeNonSharedBytesLowerBound: number
  worktreeMeasurementsPartial: boolean
  worktreeCountsByTool: Partial<Record<WorktreeTool, number>>
  /** Sections overlap; these values must not be added into a grand total. */
  totalsMayOverlap: true
}

/** Versioned, renderer-independent report used by --json and --json-file. */
export interface WhyfullJsonReport extends Report {
  format: "whyfull-report"
  schemaVersion: 1
  completedAt: string
  durationMs: number
  runtime: {
    nodeVersion: string
    arch: string
  }
  options: JsonReportOptions
  tierDefinitions: Record<Tier, TierMeta>
  summary: JsonReportSummary
  discovered?: DiscoverResult
  cacheHogs?: DiscoverResult
  worktrees?: WorktreeResult
}

export interface BuildJsonReportOptions {
  report: Report
  options: JsonReportOptions
  durationMs: number
  discovered?: DiscoverResult | null
  cacheHogs?: DiscoverResult | null
  worktrees?: WorktreeResult | null
}
