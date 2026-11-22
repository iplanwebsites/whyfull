import { createFileRoute } from "@tanstack/react-router"
import {
  parseSettingsSection,
  type SettingsSection,
} from "@/lib/settings-navigation"
import {
  parseViewerPanel,
  parseReportSection,
  type ViewerPanel,
  type ReportSection,
} from "@/lib/panel-navigation"
import { Explorer } from "@/components/explorer"
export interface ExplorerSearch {
  id?: number
  path?: string
  document?: string
  view?: "treemap" | "sunburst"
  sort?: "size" | "name"
  q?: string
  files?: boolean
  page?: "report" | "locations"
  panel?: ViewerPanel
  reportSection?: ReportSection
  settings?: SettingsSection
}
export const Route = createFileRoute("/")({
  validateSearch: (raw: Record<string, unknown>): ExplorerSearch => ({
    id:
      Number.isSafeInteger(Number(raw.id)) && Number(raw.id) >= 0
        ? Number(raw.id)
        : undefined,
    path: typeof raw.path === "string" ? raw.path : undefined,
    document: typeof raw.document === "string" ? raw.document : undefined,
    view:
      raw.view === "sunburst" || raw.view === "treemap" ? raw.view : undefined,
    sort: raw.sort === "name" || raw.sort === "size" ? raw.sort : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
    files: raw.files === true || raw.files === "true" ? true : undefined,
    page:
      raw.page === "report" || raw.page === "locations" ? raw.page : undefined,
    settings: parseSettingsSection(raw.settings),
    panel: parseViewerPanel(raw.panel),
    reportSection: parseReportSection(raw.reportSection),
  }),
  component: Explorer,
})
