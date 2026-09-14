/** Programmatic API. The CLI is a thin wrapper over these. */

export { scan, byTier, measureSimulatorRuntimes } from "./scan"
export { render } from "./report"
export { measure, volume, human } from "./size"
export { TARGETS, TIERS, forPlatform, REPO_URL } from "./targets"
export { TARGETS_RAW } from "./targets-data"
export { discover, discoverCaches } from "./discover"
export { findWorktrees } from "./worktrees"
export { buildJsonReport, saveJsonReport, JSON_SCHEMA_VERSION } from "./json"
export { storeVersions, sharedStore, readModulesStoreDir } from "./pnpm"
export type {
  Tier,
  TierMeta,
  Target,
  ResolvedTarget,
  ScannedTarget,
  ChildEntry,
  VolumeInfo,
  Report,
  TierGroup,
  MeasureResult,
  MeasureOptions,
  ScanOptions,
  RenderOptions,
  DiscoveredChild,
  DiscoveredDir,
  DiscoverResult,
  DiscoverRoot,
  DiscoverOptions,
  StoreVersion,
  SharedStoreInfo,
  WorktreeTool,
  WorktreeState,
  WorktreeRecommendationAction,
  WorktreeRecommendation,
  WorktreeEntry,
  WorktreeCluster,
  WorktreeResult,
  WorktreeOptions,
  JsonReportOptions,
  JsonReportSummary,
  WhyfullJsonReport,
  BuildJsonReportOptions,
} from "./types"
