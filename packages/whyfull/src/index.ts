/** Programmatic API. The CLI is a thin wrapper over these. */

export { scan, byTier } from "./scan"
export { render } from "./report"
export { measure, volume, human } from "./size"
export { TARGETS, TIERS, forPlatform } from "./targets"
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
} from "./types"
