import { Fragment, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Copy,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Ellipsis,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { api, formatSize } from "@/lib/api"
import type { ViewerStatus } from "@/lib/api"
import type { AnalysisData } from "./analysis-results"
import {
  reportContext,
  reportFindings,
  suggestionGroup,
  suggestionGroups,
} from "@/lib/report-actions"
import { tierLabel } from "@/lib/tiers"
import { isSafeTier } from "@/lib/chart-colors"
import { CoverageChecks } from "./analysis-results"
import { SystemChecks } from "./diagnostics-dialog"
import { copyPath } from "@/lib/clipboard"
import { toast } from "@/lib/notifications"

/** Suggestions derive from the completed inventory (or an opened report). */
export function useSuggestions(status: ViewerStatus | undefined, poll = false) {
  return useQuery({
    queryKey: [
      "analysis",
      status?.documentId,
      status?.revision,
      status?.status,
      status?.cache?.refreshing,
    ],
    queryFn: ({ signal }) => api<AnalysisData>("analysis", undefined, signal),
    enabled:
      !!status &&
      (status.source.kind === "report" || status.status === "complete"),
    refetchInterval: poll ? 5000 : false,
  })
}

export function ReportDialog({
  open,
  onOpenChange,
  status,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ViewerStatus
  onChanged: (status: ViewerStatus) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85dvh] max-h-[900px] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogDescription className="sr-only">
          Suggested cleanup actions from your scan. Explore folders or copy them
          for your agent to review.
        </DialogDescription>
        <ReportPage
          status={status}
          onChanged={onChanged}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ReportPage({
  status,
  onChanged,
  onClose,
}: {
  status: ViewerStatus
  onChanged: (status: ViewerStatus) => Promise<void>
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [sort, setSort] = useState<"tier" | "size-desc" | "size-asc">("tier")
  const [limit, setLimit] = useState(100)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const result = useSuggestions(status, true)
  const waiting =
    status.source.kind !== "report" && status.status !== "complete"
  const report = result.data?.report
  const findings = report ? reportFindings(report) : []
  const filtered = findings.filter(
    (item) =>
      (!category || item.category === category) &&
      `${item.name} ${item.path ?? ""} ${item.category} ${item.tier ?? ""} ${item.recommendation}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
  )
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Could not copy. Check clipboard permissions and try again.")
    }
  }
  async function location(path: string, action: "finder" | "scan") {
    setBusy(true)
    try {
      const next = await api<ViewerStatus>("analysis/location", {
        path,
        action,
        generatedAt: report?.generatedAt,
      })
      if (action === "scan") await onChanged(next)
      else toast.success("Sent to Finder")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  function locationButtons(name: string, path: string) {
    return (
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void location(path, "scan")}
          aria-label={`Explore ${name} on disk`}
        >
          <HardDrive />
          Explore on disk
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !status.finderAvailable}
          title={
            status.finderAvailable
              ? "Reveal on this computer"
              : "Finder is available on macOS only"
          }
          onClick={() => void location(path, "finder")}
          aria-label={`Show ${name} in Finder`}
        >
          <FolderOpen />
          Finder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copyPath(path)}
          aria-label={`Copy path for ${name}`}
        >
          <Copy />
          Path
        </Button>
      </div>
    )
  }
  const keyFor = (item: (typeof findings)[number]) =>
    JSON.stringify([item.category, item.path, item.name])
  const grouped = suggestionGroups(filtered)
  const visible = (
    sort === "tier"
      ? grouped.flatMap((group) => group.items)
      : [...filtered].sort((a, b) => {
          if (a.bytes === null) return b.bytes === null ? 0 : 1
          if (b.bytes === null) return -1
          return sort === "size-desc" ? b.bytes - a.bytes : a.bytes - b.bytes
        })
  ).slice(0, limit)
  function rowMenu(item: (typeof findings)[number]) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for ${item.name}`}
              title="Folder actions"
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={busy || !item.path}
            onClick={() => item.path && void location(item.path, "scan")}
          >
            <HardDrive />
            Explore on disk
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy || !item.path || !status.finderAvailable}
            onClick={() => item.path && void location(item.path, "finder")}
          >
            <FolderOpen />
            Show in Finder
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!item.path}
            onClick={() => item.path && void copyPath(item.path)}
          >
            <Copy />
            Copy path
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              report && void copy(reportContext(report, [item]), "Suggestion")
            }
          >
            <Copy />
            Copy for agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
        <FileText className="size-4 text-muted-foreground" />
        <DialogTitle className="mr-auto">Suggestions</DialogTitle>
        {!!findings.length && (
          <Button
            variant="outline"
            size="sm"
            title="Copy all suggestions as context for your coding agent"
            onClick={() =>
              report &&
              void copy(reportContext(report, findings), "Suggestions")
            }
          >
            <Copy />
            Copy for agent
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close report"
        >
          <X />
        </Button>
      </header>
      {waiting || (!report && result.data?.pending) ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="font-medium">
            {status.awaitingScan
              ? "No scan yet"
              : "Suggestions appear when the scan finishes"}
          </p>
          <p className="text-sm text-muted-foreground">
            {status.awaitingScan
              ? "Start a scan to see suggestions for this location."
              : "They’re built from the folders this scan measures."}
          </p>
        </div>
      ) : result.isPending ? (
        <p className="p-8 text-sm text-muted-foreground" role="status">
          Loading suggestions…
        </p>
      ) : result.error ? (
        <div className="p-8" role="alert">
          <p>{result.error.message}</p>
          <Button variant="outline" onClick={() => void result.refetch()}>
            Try again
          </Button>
        </div>
      ) : !report ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="font-medium">No suggestions yet</p>
          <p className="text-sm text-muted-foreground">
            Run a scan to see suggestions for this location.
          </p>
        </div>
      ) : (
        <>
          {(report.localContext?.userInstructions ||
            report.localContext?.computerInstructions) && (
            <details className="max-h-44 shrink-0 overflow-auto border-b bg-muted/30 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Your saved instructions
              </summary>
              <div className="mt-3 space-y-3 whitespace-pre-wrap text-xs text-muted-foreground">
                {report.localContext.userInstructions && (
                  <p>
                    <span className="font-medium text-foreground">
                      User preferences
                    </span>
                    {"\n"}
                    {report.localContext.userInstructions}
                  </p>
                )}
                {report.localContext.computerInstructions && (
                  <p>
                    <span className="font-medium text-foreground">
                      This computer
                    </span>
                    {"\n"}
                    {report.localContext.computerInstructions}
                  </p>
                )}
              </div>
            </details>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7 text-xs"
                type="search"
                aria-label="Search suggestions"
                placeholder="Filter suggestions…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setLimit(100)
                }}
              />
            </div>
            <select
              aria-label="Filter report category"
              className="h-8 max-w-48 rounded-md border bg-background px-2 text-xs"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value)
                setLimit(100)
              }}
            >
              <option value="">All categories</option>
              {[...new Set(findings.map((item) => item.category))]
                .sort()
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
            </select>
            <select
              aria-label="Sort recommendations"
              className="h-8 max-w-48 rounded-md border bg-background px-2 text-xs"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort)
                setLimit(100)
              }}
            >
              <option value="tier">Grouped</option>
              <option value="size-desc">Largest first</option>
              <option value="size-asc">Smallest first</option>
            </select>
            <span className="text-xs tabular-nums text-muted-foreground">
              {filtered.length}{" "}
              {filtered.length === 1 ? "suggestion" : "suggestions"}
            </span>
            {(query || category) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!filtered.length}
                onClick={() =>
                  void copy(
                    reportContext(report, filtered),
                    "Filtered suggestions"
                  )
                }
              >
                <Copy />
                Copy filtered for agent
              </Button>
            )}
          </div>
          <main className="min-h-0 flex-1 overflow-auto">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 border-b bg-background text-muted-foreground">
                <tr>
                  <th className="w-[32%] px-4 py-2 font-normal">Location</th>
                  <th
                    className="w-28 px-3 py-2 text-right font-normal"
                    aria-sort={
                      sort === "tier"
                        ? "none"
                        : sort === "size-desc"
                          ? "descending"
                          : "ascending"
                    }
                  >
                    <button
                      className="ml-auto flex items-center gap-1 hover:text-foreground"
                      onClick={() => {
                        setSort(sort === "size-desc" ? "size-asc" : "size-desc")
                        setLimit(100)
                      }}
                      aria-label={
                        sort === "size-desc"
                          ? "Sort recommendations smallest first"
                          : "Sort recommendations largest first"
                      }
                    >
                      Size{" "}
                      {sort === "tier" ? (
                        <ArrowUpDown className="size-3" />
                      ) : sort === "size-desc" ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUp className="size-3" />
                      )}
                    </button>
                  </th>
                  <th className="px-3 py-2 font-normal">Suggested action</th>
                  <th className="w-12 px-2 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(sort === "tier"
                  ? grouped
                  : [
                      {
                        key: "size",
                        label: "",
                        notes: [],
                        shared: null,
                        items: visible,
                      },
                    ]
                ).map((group) => {
                  const items =
                    sort === "tier"
                      ? visible.filter(
                          (item) => suggestionGroup(item) === group.key
                        )
                      : visible
                  if (!items.length) return null
                  return (
                    <Fragment key={group.key}>
                      {sort === "tier" && (
                        <tr className="border-y bg-muted/40">
                          <th
                            colSpan={4}
                            scope="rowgroup"
                            className="px-4 py-2 text-left font-medium"
                          >
                            {isSafeTier(group.key) && (
                              <span
                                aria-hidden
                                className="mr-2 inline-block size-2 rounded-full bg-highlight align-middle ring-1 ring-primary"
                              />
                            )}
                            <span>{group.label}</span>
                            <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                              {group.items.length}
                            </span>
                            {group.notes.map((note) => (
                              <span
                                key={note}
                                className="mt-0.5 block font-normal leading-relaxed text-muted-foreground"
                              >
                                {note}
                              </span>
                            ))}
                          </th>
                        </tr>
                      )}
                      {items.map((item) => {
                        const key = keyFor(item),
                          isExpanded = expanded === key,
                          specific =
                            item.recommendation !== group.shared
                              ? item.recommendation
                              : null
                        return (
                          <Fragment key={key}>
                            <tr
                              className={
                                isExpanded
                                  ? "border-b bg-muted/40"
                                  : "border-b hover:bg-muted/30"
                              }
                            >
                              <td className="px-4 py-2.5 align-top">
                                <button
                                  className="flex w-full items-start gap-2 text-left"
                                  aria-expanded={isExpanded}
                                  aria-label={`Details for ${item.name}`}
                                  onClick={() =>
                                    setExpanded(isExpanded ? null : key)
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="min-w-0">
                                    <span className="block break-words font-medium">
                                      {item.name}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                      {item.category}
                                      {sort !== "tier" && item.tier
                                        ? ` · ${tierLabel(item.tier)}`
                                        : ""}
                                      {item.state ? ` · ${item.state}` : ""}
                                      {item.denied ? " · Access denied" : ""}
                                    </span>
                                  </span>
                                </button>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-mono tabular-nums">
                                {item.bytes === null
                                  ? "Unknown"
                                  : `${item.partial ? "≥ " : ""}${formatSize(item.bytes)}`}
                              </td>
                              <td className="px-3 py-2.5 align-top leading-relaxed">
                                {specific && (
                                  <p
                                    className="line-clamp-2 break-words"
                                    title={specific}
                                  >
                                    {specific}
                                  </p>
                                )}
                                {item.reviewRequired && (
                                  <span className="text-[11px] text-muted-foreground">
                                    Needs review
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                {rowMenu(item)}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="border-b">
                                <td
                                  colSpan={4}
                                  className="bg-muted/15 px-4 py-4 sm:px-10"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                                      {item.path ?? "Path unavailable"}
                                    </p>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        void copy(
                                          reportContext(report, [item]),
                                          "Suggestion"
                                        )
                                      }
                                    >
                                      <Copy />
                                      Copy for agent
                                    </Button>
                                  </div>
                                  {specific && (
                                    <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
                                      {specific}
                                    </p>
                                  )}
                                  {item.path && (
                                    <div className="mt-3">
                                      {locationButtons(item.name, item.path)}
                                    </div>
                                  )}
                                  {!!item.commands.length && (
                                    <div className="mt-4 divide-y border-y">
                                      {item.commands.map(
                                        ({ label, command }) => (
                                          <div
                                            key={command}
                                            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <p className="mb-1 text-[11px] text-muted-foreground">
                                                {label}
                                              </p>
                                              <code className="break-all">
                                                {command}
                                              </code>
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() =>
                                                void copy(command, "Command")
                                              }
                                              aria-label={`Copy command for ${item.name}: ${label}`}
                                            >
                                              <Copy />
                                              Copy command
                                            </Button>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  )}
                                  {!!item.children?.length && (
                                    <div className="mt-4">
                                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                                        Measured subfolders
                                      </p>
                                      <table className="w-full text-xs">
                                        <tbody>
                                          {item.children.map((child) => (
                                            <tr
                                              key={child.path}
                                              className="border-b last:border-0"
                                            >
                                              <td
                                                className="max-w-0 truncate py-2 pr-3"
                                                title={child.path}
                                              >
                                                {child.name}
                                              </td>
                                              <td className="whitespace-nowrap px-2 py-2 text-right font-mono">
                                                {child.partial || item.partial
                                                  ? "≥ "
                                                  : ""}
                                                {formatSize(child.bytes)}
                                              </td>
                                              <td className="w-24 py-2 text-right">
                                                <div className="flex justify-end">
                                                  <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    disabled={busy}
                                                    title="Explore on disk"
                                                    aria-label={`Explore ${child.name} on disk`}
                                                    onClick={() =>
                                                      void location(
                                                        child.path,
                                                        "scan"
                                                      )
                                                    }
                                                  >
                                                    <HardDrive />
                                                  </Button>
                                                  <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    disabled={
                                                      busy ||
                                                      !status.finderAvailable
                                                    }
                                                    title="Show in Finder"
                                                    aria-label={`Show ${child.name} in Finder`}
                                                    onClick={() =>
                                                      void location(
                                                        child.path,
                                                        "finder"
                                                      )
                                                    }
                                                  >
                                                    <FolderOpen />
                                                  </Button>
                                                  <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    title="Copy path"
                                                    aria-label={`Copy path for ${child.name}`}
                                                    onClick={() =>
                                                      void copyPath(child.path)
                                                    }
                                                  >
                                                    <Copy />
                                                  </Button>
                                                </div>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
                {!filtered.length && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-12 text-center text-muted-foreground"
                    >
                      No matching suggestions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div className="p-3 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit(limit + 100)}
                >
                  Show more suggestions
                </Button>
              </div>
            )}
            <details
              className="border-t px-4 py-3 text-xs"
              onToggle={(event) => setAdvanced(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-muted-foreground">
                Advanced: coverage and system checks
              </summary>
              {advanced && (
                <div className="mt-3 space-y-5">
                  <section className="space-y-2">
                    <h3 className="font-medium">Coverage</h3>
                    <CoverageChecks />
                  </section>
                  <section className="space-y-2">
                    <h3 className="font-medium">System checks</h3>
                    <p className="text-muted-foreground">
                      Optional read-only commands for this computer’s home
                      volume.
                    </p>
                    <SystemChecks enabled={advanced} />
                  </section>
                </div>
              )}
            </details>
          </main>
          <footer className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <details>
              <summary className="cursor-pointer">
                Sizes may overlap · ≥ partial measurement · Report details
              </summary>
              <div className="mt-2 space-y-1 pb-1">
                <p>
                  {result.data?.source} ·{" "}
                  {new Date(report.generatedAt).toLocaleString()} ·{" "}
                  {report.platform}
                </p>
                <p>
                  Sizes are not guaranteed reclaimable space. Commands are
                  copied for review and never executed here.
                </p>
                {report.inventory ? (
                  <>
                    <p>Inventory: {report.inventory.root}</p>
                    {report.inventory.limitations.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </>
                ) : (
                  <p>
                    Imported CLI report. Recommendations use the measurements
                    recorded in that report.
                  </p>
                )}
              </div>
            </details>
          </footer>
        </>
      )}
    </div>
  )
}
