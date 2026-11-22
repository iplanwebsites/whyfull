export const viewerPanels = ["rules", "scan", "shortlist", "files"] as const
export type ViewerPanel = (typeof viewerPanels)[number]
export const reportSections = [
  "targets",
  "caches",
  "discovered",
  "worktrees",
] as const
export type ReportSection = (typeof reportSections)[number]
export const parseViewerPanel = (value: unknown): ViewerPanel | undefined =>
  viewerPanels.find((panel) => panel === value)
export const parseReportSection = (value: unknown): ReportSection | undefined =>
  reportSections.find((section) => section === value)
