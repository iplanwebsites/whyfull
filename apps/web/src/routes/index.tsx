import { createFileRoute } from "@tanstack/react-router"
import { Explorer } from "@/components/explorer"
export interface ExplorerSearch {
  id?: number
  path?: string
  view?: "treemap" | "sunburst"
  sort?: "size" | "name"
  q?: string
  files?: boolean
  panel?: "rules" | "scan"
}
export const Route = createFileRoute("/")({
  validateSearch: (raw: Record<string, unknown>): ExplorerSearch => ({
    id:
      Number.isSafeInteger(Number(raw.id)) && Number(raw.id) >= 0
        ? Number(raw.id)
        : undefined,
    path: typeof raw.path === "string" ? raw.path : undefined,
    view:
      raw.view === "sunburst" || raw.view === "treemap" ? raw.view : undefined,
    sort: raw.sort === "name" || raw.sort === "size" ? raw.sort : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
    files: raw.files === true || raw.files === "true" ? true : undefined,
    panel:
      raw.panel === "rules" || raw.panel === "scan" ? raw.panel : undefined,
  }),
  component: Explorer,
})
