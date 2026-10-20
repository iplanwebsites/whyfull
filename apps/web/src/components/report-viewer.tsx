import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@workspace/ui/components/context-menu"
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Download,
  Search,
  ChevronRight,
  ChevronDown,
  FileJson,
  FolderOpen,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { RunnerControls } from "./runner-controls"
import { api, formatSize, exportSnapshot } from "@/lib/api"
import type { ViewerStatus, WhyfullJsonReport } from "@/lib/api"
type ReportSection = "targets" | "caches" | "discovered" | "worktrees"
interface Row {
  id: string
  name: string
  path: string | null
  bytes: number | null
  tier?: string
  partial?: boolean
  hint: string
  children: Array<{ name: string; path: string; bytes: number }>
}
export function ReportViewer({
  status,
  onChanged,
  onPendingChange,
}: {
  status: ViewerStatus
  onChanged: (status: ViewerStatus) => Promise<void>
  onPendingChange: (value: boolean) => void
}) {
  const [section, setSection] = useState<ReportSection>("targets"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [expanded, setExpanded] = useState<string | null>(null)
  const result = useQuery({
    queryKey: ["report", status.documentId],
    queryFn: ({ signal }) =>
      api<WhyfullJsonReport>("report", undefined, signal),
  })
  const report = result.data
  const rows = useMemo<Row[]>(() => {
    if (!report) return []
    if (section === "targets")
      return report.targets
        .filter((t) => t.present || t.denied)
        .map((t) => ({
          id: t.id,
          name: t.label,
          path: t.path,
          bytes: t.bytes,
          tier: t.tier,
          partial: !!t.partial || !!t.detailMeasurementsPartial || !!t.denied,
          hint: t.hint,
          children: t.children,
        }))
    if (section === "worktrees")
      return (report.worktrees?.clusters ?? []).flatMap((cluster) =>
        cluster.worktrees.map((w, i) => ({
          id: `${cluster.mainRepo}-${i}`,
          name: w.name,
          path: w.path,
          bytes: w.bytes,
          tier: w.state,
          partial: w.partial,
          hint: w.hint,
          children: [],
        }))
      )
    const source = section === "caches" ? report.cacheHogs : report.discovered
    return (source?.dirs ?? []).map((item, i) => ({
      id: String(i),
      name: item.name,
      path: item.path,
      bytes: item.bytes,
      hint: "",
      children: item.children,
    }))
  }, [report, section])
  const filtered = useMemo(
    () =>
      rows
        .filter((row) =>
          `${row.name} ${row.path ?? ""}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase())
        )
        .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)),
    [rows, query]
  )
  return (
    <div className="disk-workspace">
      <header className="flex shrink-0 items-center gap-2 border-b p-2">
        <RunnerControls
          status={status}
          onChanged={onChanged}
          onPendingChange={onPendingChange}
        />
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={status.source.name ?? "CLI report"}
        >
          {status.source.name ?? "CLI report"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Export report"
          onClick={() =>
            void exportSnapshot("whyfull-report.json").catch((e) =>
              toast.error(e.message)
            )
          }
        >
          <Download />
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Report section"
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={section}
            onChange={(e) => {
              setSection(e.target.value as ReportSection)
              setPage(0)
              setExpanded(null)
            }}
          >
            <option value="targets">Known locations</option>
            <option value="caches">Untracked caches</option>
            <option value="discovered">Discovered locations</option>
            <option value="worktrees">Worktrees</option>
          </select>
          <div className="relative min-w-40 max-w-sm flex-1">
            <Search className="absolute left-2 top-2 size-4 text-muted-foreground" />
            <Input
              aria-label="Search report"
              placeholder="Search…"
              className="h-8 pl-8"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
            />
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {report ? new Date(report.generatedAt).toLocaleString() : ""}
          </span>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Measured locations may overlap. Section totals are not whole-disk
          usage or guaranteed reclaimable space.
        </p>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr>
                <th className="w-8 p-2" aria-label="Details" />
                <th className="p-2 font-normal">Location</th>
                <th className="p-2 font-normal">Tier</th>
                <th className="p-2 text-right font-normal">Size</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(page * 100, (page + 1) * 100).map((row) => (
                <ReportRows
                  key={row.id}
                  row={row}
                  expanded={expanded === row.id}
                  finderAvailable={status.finderAvailable}
                  onToggle={() =>
                    setExpanded(expanded === row.id ? null : row.id)
                  }
                />
              ))}
              {!result.isPending && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-5 text-center text-xs text-muted-foreground"
                  >
                    No matching locations.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {result.isPending && (
            <div className="p-5 text-xs text-muted-foreground">
              Opening report…
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} locations</span>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={(page + 1) * 100 >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
function ReportRows({
  row,
  expanded,
  onToggle,
  finderAvailable,
}: {
  row: Row
  expanded: boolean
  finderAvailable: boolean
  onToggle: () => void
}) {
  const finder = () =>
    void api("report/finder", { path: row.path }).catch((error) =>
      toast.error(error.message)
    )
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<tr className="border-t hover:bg-muted/40" />}
      >
        <td className="p-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Details for ${row.name}`}
            onClick={onToggle}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        </td>
        <td className="max-w-md p-2">
          <button
            onClick={onToggle}
            className="block max-w-full truncate text-left font-medium"
          >
            {row.name}
          </button>
          <div
            className="truncate text-xs text-muted-foreground"
            title={row.path ?? ""}
          >
            {row.path ?? "Unavailable"}
          </div>
        </td>
        <td className="p-2 text-xs">{row.tier ?? "—"}</td>
        <td className="whitespace-nowrap p-2 text-right text-xs tabular-nums">
          {row.partial && row.bytes !== null ? "≥ " : ""}
          {row.bytes === null ? "Unknown" : formatSize(row.bytes)}
        </td>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!finderAvailable || !row.path}
          onClick={finder}
        >
          <FolderOpen />
          Open in Finder
        </ContextMenuItem>
      </ContextMenuContent>
      {expanded && (
        <tr className="border-t bg-muted/20">
          <td />
          <td colSpan={3} className="space-y-3 p-3">
            {row.path && (
              <Button
                size="sm"
                variant="outline"
                disabled={!finderAvailable}
                onClick={finder}
              >
                <FolderOpen />
                Finder
              </Button>
            )}
            {row.hint && (
              <p className="whitespace-pre-wrap break-words text-xs">
                {row.hint}
              </p>
            )}
            {row.children.slice(0, 100).map((child, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="truncate" title={child.path}>
                  <FileJson className="mr-2 inline size-3 text-muted-foreground" />
                  {child.name}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatSize(child.bytes)}
                </span>
              </div>
            ))}
            {row.children.length > 100 && (
              <p className="text-xs text-muted-foreground">
                {row.children.length - 100} more entries in the JSON report.
              </p>
            )}
            {!row.hint && !row.children.length && (
              <p className="text-xs text-muted-foreground">
                No additional detail recorded.
              </p>
            )}
          </td>
        </tr>
      )}
    </ContextMenu>
  )
}
