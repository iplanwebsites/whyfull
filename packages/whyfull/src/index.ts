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
export { TrashController, moveToNativeTrash } from "./trash"
export { DiskScanner, scanFilesystem, defaultScanWorkers } from "./filesystem"
export {
  rustScannerAvailability,
  releaseDiskSnapshot,
} from "./sqlite-inventory"
export { ScanProgressTracker, ScanCompletionEstimate } from "./scan-progress"
export type { ScanProgress, ScanProgressSample } from "./scan-progress"
export {
  startViewer,
  loadDiskSnapshot,
  saveDiskSnapshot,
} from "./viewer-server"
export { loadDiskPolicy, saveDiskPolicy, pathWithin } from "./disk-policy"
export type {
  DiskFile,
  DiskDirectory,
  DiskPolicy,
  DiskSnapshot,
  DiskScanOptions,
} from "./filesystem-types"
export type { ViewerOptions } from "./viewer-server"
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

export { loadViewerFile, validateViewerReport } from "./viewer-document"
export { listScanDrives, defaultScanRoot } from "./drives"

export type { ScanDrive } from "./drives"

export {
  DiagnosticRunner,
  diagnosticCommands,
  reportArguments,
} from "./diagnostics"

export {
  measureFileDistribution,
  createFileDistribution,
  addFileSize,
} from "./file-distribution"

export { analyzeSnapshot } from "./snapshot-analysis"
export { ScanCache } from "./scan-cache"
export {
  loadKnowledge,
  updateKnowledge,
  knowledgePath,
  knowledgeContext,
  knowledgeTargets,
  locationProposal,
} from "./knowledge"
export type {
  KnowledgeScope,
  KnowledgeView,
  SavedLocation,
  LocalContext,
} from "./knowledge-types"

export {
  DesktopLicense,
  verifyLicenseKey,
  extractLicenseKey,
  encodeLicensePayload,
  licensePath,
  LICENSE_PUBLIC_KEY,
  LICENSE_PRODUCT,
  TRIAL_DAYS,
  LICENSE_PAGES,
  licensePageUrl,
  CLI_LICENSE_NOTICE,
} from "./license"
export type { LicensePayload, LicenseView } from "./license"
