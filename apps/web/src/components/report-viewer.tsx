import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@workspace/ui/components/context-menu"
import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Download,
  Terminal,
  Ellipsis,
  ListChecks,
  Search,
  ChevronRight,
  ChevronDown,
  FileJson,
  FolderOpen,
  Copy,
  Play,
  Trash2,
  Flag,
  ShieldCheck,
  X,
  ScanSearch,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@workspace/ui/components/dropdown-menu"
import { DiagnosticsDialog } from "./diagnostics-dialog"
import { CleanupShortlist } from "./cleanup-shortlist"
import { RunnerControls } from "./runner-controls"
import { copyPath } from "@/lib/clipboard"
import { api, formatSize, exportSnapshot, isTinyMetadata } from "@/lib/api"
import type { ViewerStatus, WhyfullJsonReport } from "@/lib/api"
type ReportSection = "targets" | "caches" | "discovered" | "worktrees"
interface LocationState {
  path: string
  mark: "trash" | "useless" | null
  kept: boolean
  directKeep: boolean
}
interface Row {
  id: string
  name: string
  path: string | null
  bytes: number | null
  tier?: string
  partial?: boolean
  hint: string
  children: Array<{
    name: string
    path: string
    bytes: number
    partial?: boolean
    stale?: boolean
  }>
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
  const client = useQueryClient()
  const [tier, setTier] = useState("all")
  const [markedOnly, setMarkedOnly] = useState(false)
  const [reportRun, setReportRun] = useState(false)
  const locations = useQuery({
    queryKey: ["report-locations", status.documentId],
    queryFn: ({ signal }) =>
      api<LocationState[]>("report/locations", undefined, signal),
  })
  const locationMap = new Map(
    (locations.data ?? []).map((item) => [item.path, item])
  )
  async function action(path: string, action: string) {
    if (action === "scan") onPendingChange(true)
    try {
      const next = await api<ViewerStatus>("report/action", { path, action })
      if (action === "scan") await onChanged(next)
      else {
        await client.invalidateQueries({ queryKey: ["report-locations"] })
        await client.invalidateQueries({ queryKey: ["shortlist"] })
        toast.success(
          action === "trash"
            ? "Added to Trash shortlist"
            : action === "useless"
              ? "Marked as useless"
              : action === "keep"
                ? "Location kept"
                : "Mark cleared"
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (action === "scan") onPendingChange(false)
    }
  }
  const [shortlist, setShortlist] = useState(false)
  const [diagnostics, setDiagnostics] = useState(false)
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
          children: t.storeVersions?.length ? t.storeVersions : t.children,
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
        .filter(
          (row) =>
            (`${row.name} ${row.path ?? ""}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()) ||
              row.children.some((child) =>
                `${child.name} ${child.path}`
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase())
              )) &&
            (query ||
              row.bytes === null ||
              !isTinyMetadata(
                row.path?.split("/").at(-1) ?? row.name,
                row.bytes ?? 0
              )) &&
            (tier === "all" || row.tier === tier) &&
            (!markedOnly ||
              !!locations.data?.find((item) => item.path === row.path)?.mark ||
              row.children.some(
                (child) =>
                  !!locations.data?.find((item) => item.path === child.path)
                    ?.mark
              ))
        )
        .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)),
    [rows, query, tier, markedOnly, locations.data]
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
          variant="outline"
          size="sm"
          onClick={() => {
            setReportRun(true)
            setDiagnostics(true)
          }}
        >
          <Play />
          Run report
        </Button>
        <DiagnosticsDialog
          open={diagnostics}
          onOpenChange={setDiagnostics}
          initialCommand={reportRun ? "whyfull" : "space"}
          initialOptions={
            report?.options
              ? {
                  top: Number.isInteger(report.options.top)
                    ? Math.max(0, Math.min(100, report.options.top))
                    : 5,
                  exact: report.options.exact === true,
                  caches: report.options.cacheScan === true,
                  worktrees: report.options.worktrees === true,
                }
              : undefined
          }
          onReport={onChanged}
        />
        <CleanupShortlist
          open={shortlist}
          onOpenChange={setShortlist}
          finderAvailable={status.finderAvailable}
          documentId={status.documentId}
          onBrowse={(entry) => void action(entry.path, "scan")}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More options"
                title="More options"
              />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setReportRun(false)
                setDiagnostics(true)
              }}
            >
              <Terminal />
              Diagnostics
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShortlist(true)}>
              <ListChecks />
              Cleanup shortlist
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void exportSnapshot("whyfull-report.json").catch((error) =>
                  toast.error(error.message)
                )
              }
            >
              <Download />
              Export report
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Report section"
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={section}
            onChange={(e) => {
              setSection(e.target.value as ReportSection)
              setTier("all")
              setPage(0)
              setExpanded(null)
            }}
          >
            <option value="targets">Known locations</option>
            <option value="caches">Untracked caches</option>
            <option value="discovered">Discovered locations</option>
            <option value="worktrees">Worktrees</option>
          </select>
          <select
            aria-label="Filter report tier"
            value={tier}
            onChange={(event) => {
              setTier(event.target.value)
              setPage(0)
            }}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="all">All tiers</option>
            {[...new Set(rows.map((row) => row.tier).filter(Boolean))].map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              )
            )}
          </select>
          <Button
            variant={markedOnly ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setMarkedOnly(!markedOnly)
              setPage(0)
            }}
          >
            <ListChecks />
            Shortlisted
          </Button>
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
                  row={{
                    ...row,
                    children: query
                      ? row.children
                      : row.children.filter(
                          (child) => !isTinyMetadata(child.name, child.bytes)
                        ),
                  }}
                  upperLimit={Math.max(...rows.map((item) => item.bytes ?? 0))}
                  expanded={expanded === row.id}
                  finderAvailable={status.finderAvailable}
                  locations={locationMap}
                  onAction={action}
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
  upperLimit,
  expanded,
  onToggle,
  finderAvailable,
  locations,
  onAction,
}: {
  row: Row
  upperLimit: number
  expanded: boolean
  finderAvailable: boolean
  locations: Map<string, LocationState>
  onAction: (path: string, action: string) => Promise<void>
  onToggle: () => void
}) {
  const location = row.path ? locations.get(row.path) : undefined
  const finder = () =>
    void api("report/finder", { path: row.path })
      .then(() => toast.success("Sent to Finder"))
      .catch((error) => toast.error(error.message))
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
            {location?.mark && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {location.mark === "trash" ? "Trash shortlist" : "Useless"}
              </span>
            )}
            {location?.kept && (
              <ShieldCheck className="ml-2 inline size-3 text-muted-foreground" />
            )}
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
          {row.bytes === null ? "Unknown" : formatSize(row.bytes, upperLimit)}
        </td>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!finderAvailable || !row.path}
          onClick={finder}
        >
          <FolderOpen />
          Show in Finder
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!row.path}
          onClick={() => void copyPath(row.path!)}
        >
          <Copy />
          Copy path
        </ContextMenuItem>
        {row.path && (
          <ReportMenu path={row.path} state={location} onAction={onAction} />
        )}
      </ContextMenuContent>
      {expanded && (
        <tr className="border-t bg-muted/20">
          <td />
          <td colSpan={3} className="space-y-3 p-3">
            {row.path && (
              <ReportAction
                path={row.path}
                state={location}
                onAction={onAction}
              />
            )}
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
              <div className="flex items-start gap-2">
                <p className="flex-1 whitespace-pre-wrap break-words text-xs">
                  {row.hint}
                </p>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Copy recommendation for ${row.name}`}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(row.hint)
                      .then(() => toast.success("Recommendation copied"))
                      .catch(() => toast.error("Could not copy recommendation"))
                  }
                >
                  <Copy />
                </Button>
              </div>
            )}
            {row.children.slice(0, 100).map((child) => (
              <ContextMenu key={child.path}>
                <ContextMenuTrigger
                  render={
                    <div className="flex items-center gap-3 border-t py-2 text-xs" />
                  }
                >
                  <span className="min-w-0 flex-1 truncate" title={child.path}>
                    <FileJson className="mr-2 inline size-3 text-muted-foreground" />
                    {child.name}
                    {child.stale && (
                      <span className="ml-2 text-muted-foreground">
                        Obsolete format
                      </span>
                    )}
                    {locations.get(child.path)?.mark && (
                      <span className="ml-2 text-muted-foreground">
                        Shortlisted
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {child.partial ? "≥ " : ""}
                    {formatSize(child.bytes, upperLimit)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Mark ${child.name} for Trash`}
                    disabled={locations.get(child.path)?.kept}
                    onClick={() => void onAction(child.path, "trash")}
                  >
                    <Trash2 />
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    disabled={!finderAvailable}
                    onClick={() =>
                      void api("report/finder", { path: child.path }).catch(
                        (error) => toast.error(error.message)
                      )
                    }
                  >
                    <FolderOpen />
                    Show in Finder
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void copyPath(child.path)}>
                    <Copy />
                    Copy path
                  </ContextMenuItem>
                  <ReportMenu
                    path={child.path}
                    state={locations.get(child.path)}
                    onAction={onAction}
                  />
                </ContextMenuContent>
              </ContextMenu>
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

function ReportMenu({
  path,
  state,
  onAction,
}: {
  path: string
  state?: LocationState
  onAction: (path: string, action: string) => Promise<void>
}) {
  return (
    <>
      <ContextMenuItem onClick={() => void onAction(path, "scan")}>
        <ScanSearch />
        Inspect folder
      </ContextMenuItem>
      <ContextMenuItem
        disabled={state?.kept}
        onClick={() => void onAction(path, "trash")}
      >
        <Trash2 />
        Mark for Trash
      </ContextMenuItem>
      <ContextMenuItem
        disabled={state?.kept}
        onClick={() => void onAction(path, "useless")}
      >
        <Flag />
        Mark as useless
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() =>
          void onAction(path, state?.directKeep ? "unkeep" : "keep")
        }
      >
        <ShieldCheck />
        {state?.directKeep ? "Remove keep rule" : "Keep"}
      </ContextMenuItem>
      {state?.mark && (
        <ContextMenuItem onClick={() => void onAction(path, "clear")}>
          <X />
          Clear mark
        </ContextMenuItem>
      )}
    </>
  )
}
function ReportAction({
  path,
  state,
  onAction,
}: {
  path: string
  state?: LocationState
  onAction: (path: string, action: string) => Promise<void>
}) {
  const [selected, setSelected] = useState("scan")
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`Action for ${path.split("/").at(-1)}`}
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className="h-8 max-w-full rounded-md border bg-background px-2 text-xs"
      >
        <option value="scan">Inspect folder · recommended</option>
        <option value="trash" disabled={state?.kept}>
          Shortlist for Trash
        </option>
        <option value="useless" disabled={state?.kept}>
          Mark as useless
        </option>
        <option value={state?.directKeep ? "unkeep" : "keep"}>
          {state?.directKeep ? "Remove keep rule" : "Keep"}
        </option>
        {state?.mark && <option value="clear">Clear mark</option>}
      </select>
      <Button
        size="sm"
        disabled={
          busy || (state?.kept && ["trash", "useless"].includes(selected))
        }
        onClick={() => {
          setBusy(true)
          void onAction(path, selected).finally(() => setBusy(false))
        }}
      >
        <Play />
        {selected === "scan" ? "Run" : "Apply"}
      </Button>
      <span className="text-xs text-muted-foreground">
        {state?.kept
          ? "Kept"
          : state?.mark === "trash"
            ? "In Trash shortlist"
            : state?.mark === "useless"
              ? "Marked as useless"
              : "No files moved"}
      </span>
    </div>
  )
}
