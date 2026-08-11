/** Programmatic API. The CLI is a thin wrapper over these. */

export { scan, byTier } from "./scan"
export { render } from "./report"
export { measure, volume, human } from "./size"
export { TARGETS, TIERS, forPlatform, REPO_URL } from "./targets"
export { TARGETS_RAW } from "./targets-data"
export { discover } from "./discover"
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
  DiscoverOptions,
} from "./types"
