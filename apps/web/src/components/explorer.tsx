import { fileSummaryChart } from "@/lib/file-summary-chart"
import { isHoveredEntry } from "@/lib/chart-hover"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  useResizableLayout,
} from "@workspace/ui/components/resizable"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { MinimumFileSize } from "./minimum-file-size"
import { toast } from "@/lib/notifications"
import { RunnerControls } from "./runner-controls"
import { SettingsDialog } from "./settings-dialog"
import { CleanupShortlist, TrashShortlistButton } from "./cleanup-shortlist"
import { FileDistribution } from "./file-distribution"
import { ReportDialog, useSuggestions } from "./report-page"
import { reportFindings } from "@/lib/report-actions"
import { ReportViewer } from "./report-viewer"
import { ScanState } from "./scan-state"
import { ScanActivity } from "./scan-activity"
import {
  SupportReminder,
  trialLabel,
  useLicense,
  useLicenseLinks,
} from "./license"
import { listenForSettings } from "@/lib/settings-events"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FileText,
  HardDrive,
  Folder,
  File,
  ShieldCheck,
  Trash2,
  Search,
  Download,
  LayoutGrid,
  ChartPie,
  ChartColumn,
  RefreshCw,
  Info,
  ChevronRight,
  Settings,
  Ellipsis,
  FolderOpen,
  Copy,
  Flag,
  X,
  KeyRound,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Badge } from "@workspace/ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@workspace/ui/components/alert-dialog"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuGroup,
} from "@workspace/ui/components/context-menu"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@workspace/ui/components/dropdown-menu"
import { Route } from "@/routes/index"
import {
  api,
  formatSize,
  formatCount,
  exportSnapshot,
  hasToken,
} from "@/lib/api"
import type {
  ViewerStatus,
  DirectoryView,
  ViewEntry,
  ViewerPreferences,
  TrashPlan,
} from "@/lib/api"
import { copyPath } from "@/lib/clipboard"
import { chartColors, colorFor, isSafeTier } from "@/lib/chart-colors"
import { tierLabel } from "@/lib/tiers"
import { Treemap } from "./treemap"
import { directoryLocation, isWithinDirectory } from "@/lib/destinations"
import { setTheme, useTheme } from "@/lib/theme"
const loadSunburst = () => import("./sunburst")
type SunburstComponent = (typeof import("./sunburst"))["default"]

export function Explorer() {
  const isMobile = useIsMobile()
  const { defaultLayout, onLayoutChanged } = useResizableLayout({
    id: isMobile ? "whyfull-explorer-vertical" : "whyfull-explorer-horizontal",
    panelIds: ["chart", "files"],
    onlySaveAfterUserInteractions: true,
  })
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    client = useQueryClient()
  const [page, setPage] = useState(0),
    [selected, setSelected] = useState<ViewEntry | null>(null),
    [hover, setHover] = useState<ViewEntry | null>(null),
    [changing, setChanging] = useState(false),
    [working, setBusy] = useState(false),
    [context, setContext] = useState<ViewEntry | null>(null),
    [plan, setPlan] = useState<TrashPlan | null>(null),
    [exclude, setExclude] = useState<ViewEntry | null>(null)
  const shortlist = search.panel === "shortlist"
  const fileDetails = search.panel === "files"
  const setShortlist = (open: boolean) =>
    url({ panel: open ? "shortlist" : undefined })
  const openLicense = () => url({ settings: "license" })
  const setFileDetails = (open: boolean) =>
    url({ panel: open ? "files" : undefined })
  const [Sunburst, setSunburst] = useState<SunburstComponent | null>(null)
  const busy = working || changing
  const restored = useRef(false),
    input = useRef<HTMLInputElement>(null)
  const status = useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api<ViewerStatus>("status", undefined, signal),
    refetchInterval: (query) =>
      query.state.data?.status === "scanning" ||
      query.state.data?.cache?.refreshing
        ? 1500
        : 5000,
    enabled: hasToken(),
  })
  const license = useLicense().data
  useLicenseLinks({
    showing: search.settings === "license",
    onView: openLicense,
  })
  // The desktop menu's "License…" opens Settings without leaving this page.
  const openSettings = useRef(url)
  openSettings.current = url
  useEffect(
    () =>
      listenForSettings(window, (settings) =>
        openSettings.current({ settings })
      ),
    []
  )
  const s = status.data
  const analysis = useSuggestions(s)
  const suggestionCount = useMemo(
    () =>
      analysis.data?.report ? reportFindings(analysis.data.report).length : 0,
    [analysis.data]
  )
  const view = search.view ?? s?.viewer.view ?? "treemap",
    sort = search.sort ?? s?.viewer.sort ?? "size"
  useEffect(() => {
    if (view !== "sunburst" || Sunburst) return
    let current = true
    void loadSunburst()
      .then((module) => {
        if (current) setSunburst(() => module.default)
      })
      .catch((error) => {
        if (current) toast.error(error.message)
      })
    return () => {
      current = false
    }
  }, [view, Sunburst])
  const directory = useQuery({
    queryKey: [
      "directory",
      s?.documentId,
      s?.revision,
      directoryLocation(search.path, search.id),
      search.q ?? "",
      search.files ?? false,
      sort,
      page,
      s?.viewer.minFileBytes,
    ],
    queryFn: ({ signal }) =>
      api<DirectoryView>(
        `directory?${new URLSearchParams({ id: String(search.id ?? 0), ...(search.path ? { path: search.path } : {}), q: search.q ?? "", sort, offset: String(page * 100), ...(search.files ? { files: "all" } : {}) })}`,
        undefined,
        signal
      ),
    // Keep the chart, list and breadcrumbs together while navigating within one inventory.
    // IDs belong to a document, so never reuse a previous drive/report's result.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === s?.documentId ? previous : undefined,
    // Completed scan views stay valid until an explicit action invalidates them.
    // Keep the small folder summaries in memory for this browser session.
    staleTime: Infinity,
    gcTime: Infinity,
    // Partial totals cannot be compared meaningfully. Fetch the inventory once
    // the scan has finished instead of repeatedly redrawing growing folders.
    enabled:
      !!s &&
      s.source.kind !== "report" &&
      s.status === "complete" &&
      !changing &&
      (!search.document || search.document === s.documentId),
  })
  const d = directory.data
  const manyFiles = !!d && d.ownFiles > d.retainedFiles
  const limitedFiles = manyFiles && d?.fileScope === "largest"
  const fileHeavy =
    manyFiles && !!d && d.ownBytes > 0 && d.ownBytes >= d.node.value * 0.9
  const largestShare =
    d && d.ownBytes > 0 ? d.largestFileBytes / d.ownBytes : null
  const { dark } = useTheme()
  const displayChart = useMemo(() => (d ? fileSummaryChart(d) : undefined), [d])
  const colors = useMemo(
    () => chartColors(displayChart, dark),
    [displayChart, dark]
  )
  const directoryIndex = useMemo(() => {
    const index = new Map<string, ViewEntry>()
    d?.crumbs.forEach((crumb) =>
      index.set(`d${crumb.id}`, {
        ...crumb,
        id: `d${crumb.id}`,
        kind: "directory",
        value: 0,
      })
    )
    const visit = (node: ViewEntry) => {
      index.set(node.id, node)
      node.children?.forEach(visit)
    }
    if (d) {
      visit(d.chart)
      d.entries.forEach((node) => index.set(node.id, node))
      index.set(d.node.id, d.node)
    }
    return index
  }, [d])
  function contextTarget(event: React.SyntheticEvent) {
    const target = event.target as Element
    // Portal menus and dialogs are outside the workspace's DOM tree.
    if (!event.currentTarget.contains(target)) {
      event.stopPropagation()
      return
    }
    setContext(
      directoryIndex.get(
        target.closest?.("[data-entry-id]")?.getAttribute("data-entry-id") ?? ""
      ) ??
        d?.node ??
        null
    )
  }
  async function mark(node: ViewEntry, value: "trash" | "useless" | null) {
    await api("mark", { id: node.id, mark: value })
    setPage(0)
  }
  function directoryActions(node: ViewEntry | undefined, contextual = false) {
    const Item = contextual ? ContextMenuItem : DropdownMenuItem
    const enabled = node?.kind === "directory"
    return (
      <>
        <Item
          disabled={busy || !enabled || !s?.finderAvailable}
          onClick={() =>
            void run(async () => {
              await api("finder", { id: node!.id })
              toast.success("Sent to Finder")
            })
          }
        >
          <FolderOpen />
          Show in Finder
        </Item>
        <Item
          disabled={!enabled || !node?.path}
          onClick={() => void copyPath(node!.path!)}
        >
          <Copy />
          Copy path
        </Item>
        <Item
          disabled={busy || !enabled || node?.id === "d0" || node?.kept}
          onClick={() => void run(() => mark(node!, "trash"))}
        >
          <Trash2 />
          {node?.mark === "trash" ? "Marked for Trash" : "Mark for Trash"}
        </Item>
        <Item
          disabled={busy || !enabled || node?.id === "d0" || node?.kept}
          onClick={() => void run(() => mark(node!, "useless"))}
        >
          <Flag />
          {node?.mark === "useless" ? "Marked as useless" : "Mark as useless"}
        </Item>
        {node?.mark && (
          <Item
            disabled={busy}
            onClick={() => void run(() => mark(node, null))}
          >
            <X />
            Clear mark
          </Item>
        )}
      </>
    )
  }
  async function documentChanged(next: ViewerStatus) {
    await client.cancelQueries({ queryKey: ["status"] })
    restored.current = true
    setSelected(null)
    setHover(null)
    setContext(null)
    setPlan(null)
    setPage(0)
    await navigate({
      search: (prev) => ({
        ...prev,
        id: 0,
        path:
          next.source.kind === "report"
            ? undefined
            : (next.navigation?.path ?? next.root),
        document: next.source.kind !== "report" ? next.documentId : undefined,
        q: undefined,
        files: undefined,
        panel: undefined,
        page: undefined,
      }),
    })
    client.setQueryData(["status"], next)
  }
  function url(patch: Partial<typeof search>, replace = false) {
    void navigate({
      search: (prev) => ({
        ...prev,
        document: s && s.source.kind !== "report" ? s.documentId : undefined,
        ...patch,
      }),
      replace,
    })
    setPage(0)
    setSelected(null)
    setHover(null)
  }
  function showSuggestions(open = true) {
    void navigate({
      search: (previous) => ({
        ...previous,
        page: open ? "report" : undefined,
      }),
    })
  }
  function openDestination(path: string) {
    url({ id: 0, path, q: undefined, files: undefined, panel: undefined })
    setContext(null)
    setPlan(null)
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await client.invalidateQueries()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  async function restartScan() {
    if (!s) return
    setChanging(true)
    try {
      await run(async () => {
        const next = await api<ViewerStatus>(
          s.snapshotMode ? "scan-folder" : "rescan",
          s.snapshotMode ? { id: "d0" } : {}
        )
        if (next.documentId === s.documentId)
          client.setQueryData(["status"], next)
        else await documentChanged(next)
      })
    } finally {
      setChanging(false)
    }
  }
  async function prefs(patch: Partial<ViewerPreferences>) {
    await api("preferences", patch)
    void client.invalidateQueries({ queryKey: ["status"] })
  }
  function open(node: ViewEntry) {
    if (node.kind !== "directory") return setSelected(node)
    url({ id: Number(node.id.slice(1)), path: node.path, q: undefined })
    if (node.path)
      void prefs({ lastPath: node.path }).catch((error) =>
        toast.error(String(error))
      )
  }
  function up() {
    const p = d?.crumbs.at(-2)
    if (p)
      open({
        id: `d${p.id}`,
        name: p.name,
        path: p.path,
        kind: "directory",
        value: 0,
      })
  }
  async function policy(node: ViewEntry, action: string) {
    await api("policy", { id: Number(node.id.slice(1)), action })
    toast.success(
      action === "exclude"
        ? "Exclusion saved. Rescan to update the map."
        : "Keep rule saved. This folder is protected from Trash moves."
    )
    setExclude(null)
  }
  useEffect(() => {
    if (!s || restored.current) return
    restored.current = true
    const restorePath =
      s.source.kind !== "report" &&
      s.root !== s.homeDirectory &&
      search.id === undefined &&
      !search.path &&
      s.viewer.lastPath &&
      (s.viewer.lastPath === s.root ||
        s.viewer.lastPath.startsWith(
          s.root.endsWith("/") ? s.root : `${s.root}/`
        ))
        ? s.viewer.lastPath
        : undefined
    if (s.source.kind !== "report" && !search.document)
      url(
        { document: s.documentId, path: restorePath ?? search.path ?? s.root },
        true
      )
    else if (restorePath) url({ path: restorePath }, true)
  }, [s])
  useEffect(() => {
    if (!s || !search.document || search.document === s.documentId || changing)
      return
    setChanging(true)
    void client
      .cancelQueries({ queryKey: ["status"] })
      .then(() =>
        api<ViewerStatus>("open-scan", { documentId: search.document })
      )
      .then(async (next) => {
        await client.cancelQueries({ queryKey: ["status"] })
        client.setQueryData(["status"], next)
        setSelected(null)
        setHover(null)
        setPage(0)
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
        url({ document: s.documentId, id: 0, path: s.root }, true)
      })
      .finally(() => setChanging(false))
  }, [search.document, s?.documentId, changing])
  useEffect(() => {
    setSelected(null)
    setHover(null)
    setContext(null)
    setPlan(null)
    setPage(0)
    void client.invalidateQueries({ queryKey: ["shortlist"] })
    void client.invalidateQueries({ queryKey: ["file-distribution"] })
  }, [s?.revision, client])
  const scanStates = useRef(new Map<string, ViewerStatus["status"]>())
  useEffect(() => {
    if (!s) return
    const previous = scanStates.current.get(s.documentId)
    scanStates.current.set(s.documentId, s.status)
    if (previous === "scanning" && s.status === "complete")
      void client.invalidateQueries({ queryKey: ["directory", s.documentId] })
    void client.invalidateQueries({ queryKey: ["drives"] })
  }, [s?.status, s?.documentId, s?.source.kind, client])
  // Announce suggestions once per scan instead of opening a dialog over the map.
  const scanned = useRef(new Set<string>())
  useEffect(() => {
    if (!s || s.source.kind === "report") return
    if (s.status === "scanning" || s.cache?.refreshing) {
      scanned.current.add(s.documentId)
      return
    }
    if (
      s.status !== "complete" ||
      !suggestionCount ||
      !scanned.current.has(s.documentId)
    )
      return
    scanned.current.delete(s.documentId)
    toast(
      `${suggestionCount} ${suggestionCount === 1 ? "suggestion" : "suggestions"} ready`,
      {
        id: `suggestions-${s.documentId}`,
        action: { label: "View", onClick: () => showSuggestions() },
      }
    )
  }, [s?.status, s?.documentId, s?.cache?.refreshing, suggestionCount])
  useEffect(() => {
    if (s?.status === "failed")
      toast.error(s.saveError ?? "The scan couldn’t finish", {
        id: "scan-failed",
      })
  }, [s?.status, s?.saveError])
  useEffect(() => {
    if (s?.saveError) toast.error(s.saveError, { id: "scan-error" })
  }, [s?.saveError])
  useEffect(() => {
    if (s?.needsRescan)
      toast.info("Rescan to refresh sizes", { id: `rescan-${s.documentId}` })
  }, [s?.needsRescan, s?.documentId])
  useEffect(() => setPage(0), [s?.viewer.minFileBytes])
  useEffect(() => {
    if (s?.viewer.theme) setTheme(s.viewer.theme)
  }, [s?.viewer.theme])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.key !== "ArrowUp" ||
        !(event.metaKey || event.altKey) ||
        (event.target as Element | null)?.closest?.(
          "input, textarea, select, [contenteditable], [role=menu], [role=dialog]"
        )
      )
        return
      event.preventDefault()
      up()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  })
  if (!hasToken())
    return (
      <main className="m-auto max-w-lg p-12">
        <HardDrive className="mb-6" />
        <h1 className="text-2xl font-semibold">
          Open your private viewer link
        </h1>
        <p className="mt-3 text-muted-foreground">
          Run whyfull --view and open the complete URL printed in your terminal.
        </p>
      </main>
    )
  if (!s)
    return (
      <ScanState
        error={status.error?.message}
        onRestart={() => void status.refetch()}
      />
    )
  const settingsSection =
    search.settings ??
    (search.panel === "rules"
      ? "rules"
      : search.page === "locations"
        ? "places"
        : undefined)
  const suggestions = (
    <>
      <Dialog
        open={search.panel === "scan"}
        onOpenChange={(open) => {
          if (!open) url({ panel: undefined })
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[80vh] overflow-auto sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="size-4 text-muted-foreground" />
              Scan details
            </DialogTitle>
          </DialogHeader>
          <dl className="space-y-4 text-sm">
            {Object.entries({
              Root: s.root,
              Status: s.status,
              Files: s.files.toLocaleString(),
              Folders: s.directories.toLocaleString(),
              Snapshot: s.savedPath ?? "Not saved",
              Configuration: s.policyFile,
              Cleanup: s.cleanup.reason ?? "Native macOS Trash available",
            }).map(([key, value]) => (
              <div key={key}>
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      {settingsSection && (
        <SettingsDialog
          open
          section={settingsSection}
          onSectionChange={(settings) =>
            url({
              settings,
              panel: undefined,
              page: search.page === "locations" ? undefined : search.page,
            })
          }
          onOpenChange={(open) => {
            if (!open)
              url({
                settings: undefined,
                panel: search.panel === "rules" ? undefined : search.panel,
                page: search.page === "locations" ? undefined : search.page,
              })
          }}
          status={s}
          currentPath={search.path ?? s.root}
        />
      )}
      <ReportDialog
        open={search.page === "report"}
        onOpenChange={showSuggestions}
        status={s}
        onChanged={documentChanged}
      />
      {license?.enabled && (
        <SupportReminder
          status={s}
          analysis={analysis.data}
          onEnterKey={openLicense}
        />
      )}
    </>
  )
  if (s.source.kind === "report")
    return (
      <>
        {suggestions}
        <ReportViewer
          key={s.documentId}
          status={s}
          onChanged={documentChanged}
          onPendingChange={setChanging}
          onReport={() => showSuggestions()}
        />
      </>
    )
  if (changing || s.status !== "complete" || (!d && !directory.error))
    return (
      <>
        {suggestions}
        <ScanState
          status={s}
          lastUpdatedAt={status.dataUpdatedAt}
          changing={changing}
          busy={busy}
          controls={
            <RunnerControls
              path={search.path}
              status={s}
              disabled={busy}
              onChanged={documentChanged}
              onNavigate={openDestination}
              onPendingChange={setChanging}
            />
          }
          onStop={() =>
            void run(async () => {
              const next = await api<ViewerStatus>("cancel", {})
              client.setQueryData(["status"], next)
            })
          }
          onRestart={() => void restartScan()}
        />
      </>
    )
  const focus = selected ?? d?.node,
    canAct =
      focus &&
      !focus.trashed &&
      !focus.kept &&
      (focus.kind === "file" || focus.kind === "directory") &&
      focus.id !== "d0",
    demo = s.cleanup.mode === "demo"
  return (
    <ContextMenu>
      {suggestions}
      <ContextMenuTrigger
        render={<div className="disk-workspace" />}
        onContextMenuCapture={contextTarget}
        onKeyDownCapture={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          )
            contextTarget(event)
        }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <nav
            aria-label="Location"
            className="flex min-w-0 flex-1 items-center gap-0.5"
          >
            <RunnerControls
              path={search.path}
              status={s}
              disabled={busy}
              showSettings={false}
              onChanged={documentChanged}
              onNavigate={openDestination}
              onPendingChange={setChanging}
              trail={(anchorPath) => (
                <Breadcrumb className="min-w-0 overflow-x-auto [scrollbar-width:none]">
                  <BreadcrumbList className="flex-nowrap gap-1">
                    {d?.crumbs
                      .filter(
                        // The location menu names the anchor folder, so the
                        // trail starts below it.
                        (crumb) =>
                          isWithinDirectory(crumb.path, anchorPath) &&
                          !isWithinDirectory(anchorPath, crumb.path)
                      )
                      .map((crumb, i, crumbs) => (
                        <BreadcrumbItem
                          key={crumb.id}
                          // Narrow screens keep the current folder and its parent.
                          className={
                            i < crumbs.length - 2 ? "max-sm:hidden" : "min-w-0"
                          }
                        >
                          <BreadcrumbSeparator />
                          {i === crumbs.length - 1 ? (
                            <span
                              aria-current="page"
                              className="max-w-48 truncate text-xs font-medium text-foreground"
                              title={crumb.path}
                              data-entry-id={`d${crumb.id}`}
                            >
                              {crumb.name}
                            </span>
                          ) : (
                            <button
                              className="max-w-36 truncate rounded-sm text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                              title={crumb.path}
                              data-entry-id={`d${crumb.id}`}
                              onClick={() =>
                                open({
                                  id: `d${crumb.id}`,
                                  kind: "directory",
                                  name: crumb.name,
                                  path: crumb.path,
                                  value: 0,
                                })
                              }
                            >
                              {crumb.name}
                            </button>
                          )}
                        </BreadcrumbItem>
                      ))}
                  </BreadcrumbList>
                </Breadcrumb>
              )}
            />
            {d?.node.mark && (
              <span
                className="ml-1 shrink-0"
                title={
                  d.node.mark === "trash"
                    ? "Marked for Trash"
                    : "Marked as useless"
                }
                aria-label={
                  d.node.mark === "trash"
                    ? "Marked for Trash"
                    : "Marked as useless"
                }
              >
                {d.node.mark === "trash" ? (
                  <Trash2 className="size-3 text-destructive" />
                ) : (
                  <Flag className="size-3 text-caution" />
                )}
              </span>
            )}
          </nav>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => showSuggestions()}
          >
            <FileText />
            <span className="max-sm:sr-only">Suggestions</span>
          </Button>
          <TrashShortlistButton
            documentId={s.documentId}
            onClick={() => setShortlist(true)}
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
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuGroup>
                <DropdownMenuLabel>View options</DropdownMenuLabel>
                <div className="mx-1 mb-1 flex items-center gap-2">
                  <DropdownMenuRadioGroup
                    aria-label="View options"
                    className="flex min-w-0 flex-1 gap-1 rounded-lg bg-muted p-1"
                    value={view}
                    onValueChange={(value) => {
                      const next = value as "treemap" | "sunburst"
                      void run(async () => {
                        if (next === "sunburst" && !Sunburst) {
                          const module = await loadSunburst()
                          setSunburst(() => module.default)
                        }
                        url({ view: next })
                        await prefs({ view: next })
                      })
                    }}
                  >
                    <DropdownMenuRadioItem
                      value="treemap"
                      closeOnClick={false}
                      className="flex-1 justify-center px-2 py-1.5 text-xs data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                    >
                      <LayoutGrid />
                      Treemap
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="sunburst"
                      closeOnClick={false}
                      className="flex-1 justify-center px-2 py-1.5 text-xs data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                    >
                      <ChartPie />
                      Radial
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </div>
              </DropdownMenuGroup>
              <MinimumFileSize value={s.viewer.minFileBytes} />
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="max-w-56 truncate">
                  {d?.node.name ?? "Folder"}
                </DropdownMenuLabel>
                {directoryActions(d?.node)}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy || s.snapshotMode || s.cache?.refreshing}
                onClick={() => void restartScan()}
              >
                <RefreshCw />
                Rescan
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShortlist(true)}>
                <Trash2 />
                Trash shortlist
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => url({ panel: "scan" })}>
                <Info />
                Scan details
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy}
                onClick={() => void run(exportSnapshot)}
              >
                <Download />
                Export snapshot
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => url({ settings: "general" })}>
                <Settings />
                Settings
              </DropdownMenuItem>
              {license?.enabled && (
                <DropdownMenuItem onClick={openLicense}>
                  <KeyRound />
                  License
                </DropdownMenuItem>
              )}
              {license?.enabled ? (
                <DropdownMenuItem
                  className="py-1 text-[11px] text-muted-foreground tabular-nums"
                  onClick={openLicense}
                >
                  whyfull {__WHYFULL_VERSION__}
                  {!license.licensed && ` · ${trialLabel(license)}`}
                </DropdownMenuItem>
              ) : (
                <div className="px-2 py-1 text-[11px] text-muted-foreground tabular-nums">
                  whyfull {__WHYFULL_VERSION__}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          {s.cache?.refreshing ? (
            <ScanActivity
              compact
              progress={s.progress}
              usedBytes={s.volume?.used}
              lastUpdatedAt={status.dataUpdatedAt}
              previousDurationMs={s.durationMs}
              refreshing
              busy={busy}
              onStop={() =>
                void run(async () => {
                  const next = await api<ViewerStatus>("cancel", {})
                  client.setQueryData(["status"], next)
                  await client.invalidateQueries({ queryKey: ["drives"] })
                })
              }
            />
          ) : s.cache?.restored ? (
            <p className="shrink-0 px-2 py-1 text-xs text-muted-foreground">
              Showing saved results
              {s.cache.completedAt
                ? ` · ${new Date(s.cache.completedAt).toLocaleString()}`
                : ""}
            </p>
          ) : null}
          <ResizablePanelGroup
            key={isMobile ? "vertical" : "horizontal"}
            orientation={isMobile ? "vertical" : "horizontal"}
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
            className="explorer-grid flex-1 overflow-hidden rounded-xl border"
            aria-busy={directory.isFetching || changing}
          >
            <ResizablePanel
              id="chart"
              defaultSize={isMobile ? "50%" : "70%"}
              minSize={isMobile ? 220 : 320}
              className="explorer-chart flex min-h-0 min-w-0 flex-col"
              style={{ overflow: "hidden" }}
            >
              <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="relative min-h-0 flex-1">
                  {directory.error && !d ? (
                    <div className="p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => url({ id: 0, path: s.root })}
                      >
                        Back to root
                      </Button>
                    </div>
                  ) : d ? (
                    <>
                      {view === "treemap" ? (
                        <Treemap
                          root={displayChart!}
                          colors={colors}
                          dark={dark}
                          onOpen={open}
                          onSelect={setSelected}
                          onHover={setHover}
                          hovered={hover}
                          onContext={setContext}
                        />
                      ) : Sunburst ? (
                        <Sunburst
                          root={displayChart!}
                          colors={colors}
                          dark={dark}
                          onOpen={open}
                          onSelect={setSelected}
                          onHover={setHover}
                          hovered={hover}
                          onContext={setContext}
                          onUp={up}
                        />
                      ) : null}
                    </>
                  ) : null}
                </div>
                <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t px-2 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {hover ? (hover.path ?? hover.name) : ""}
                  </span>
                  {hover ? (
                    <span className="shrink-0 tabular-nums">
                      {formatSize(hover.value, d?.node.value)}
                    </span>
                  ) : displayChart?.children?.some(
                      (entry) =>
                        isSafeTier(entry.tier) && !entry.kept && !entry.trashed
                    ) ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="size-2 rounded-full bg-highlight ring-1 ring-primary" />
                      Safe to remove
                    </span>
                  ) : null}
                </div>
              </section>
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label="Resize chart and file list"
            />
            <ResizablePanel
              id="files"
              defaultSize={isMobile ? "50%" : "30%"}
              minSize={isMobile ? 240 : 280}
              className="flex min-h-0 min-w-0 flex-col"
            >
              <section className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-2 border-b p-2">
                  <div className="shrink-0">
                    <Select
                      value={sort}
                      onValueChange={(value) => {
                        if (value !== "size" && value !== "name") return
                        url({ sort: value })
                        void run(() => prefs({ sort: value }))
                      }}
                      items={[
                        { value: "size", label: "Size ↓" },
                        { value: "name", label: "Name A–Z" },
                      ]}
                    >
                      <SelectTrigger
                        aria-label="Sort entries"
                        className="min-w-0 max-w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="size">Size ↓</SelectItem>
                        <SelectItem value="name">Name A–Z</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <InputGroup className="min-w-28 flex-1">
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="search"
                      ref={input}
                      aria-label={
                        limitedFiles
                          ? "Search listed entries"
                          : "Search this folder"
                      }
                      placeholder={
                        limitedFiles ? "Search listed entries…" : "Search…"
                      }
                      value={search.q ?? ""}
                      onChange={(e) =>
                        url({ q: e.target.value || undefined }, true)
                      }
                    />
                  </InputGroup>
                  {!s.snapshotMode && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={!!search.files}
                        onChange={(e) =>
                          url({ files: e.target.checked || undefined })
                        }
                      />
                      All files
                    </label>
                  )}
                </div>
                {manyFiles && d && (
                  <div className="space-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
                    {fileHeavy && (
                      <div
                        className="grid grid-cols-2 gap-x-4 gap-y-3 py-2"
                        title="Space used on disk by files directly in this folder"
                      >
                        <div>
                          <div
                            className="text-2xl font-semibold text-foreground tabular-nums"
                            title={`${d.ownFiles.toLocaleString()} files`}
                          >
                            {formatCount(d.ownFiles)} files
                          </div>
                          <div>In this folder</div>
                        </div>
                        <div>
                          <div className="text-2xl font-semibold text-foreground tabular-nums">
                            {formatSize(d.ownBytes)}
                          </div>
                          <div>Space used</div>
                        </div>
                        <div>
                          <div className="font-medium text-foreground tabular-nums">
                            {formatSize(d.ownBytes / d.ownFiles)}
                          </div>
                          <div>Average file</div>
                        </div>
                        <div>
                          <div className="font-medium text-foreground tabular-nums">
                            {formatSize(d.largestFileBytes)}
                          </div>
                          <div>Largest file</div>
                        </div>
                      </div>
                    )}
                    <p className="font-medium text-foreground">
                      {fileHeavy
                        ? "Filenames"
                        : `${d.ownFiles.toLocaleString()} files`}{" "}
                      ·{" "}
                      {limitedFiles
                        ? `${search.q ? "searching" : "showing"} largest ${d.retainedFiles}`
                        : "live listing"}
                    </p>
                    {largestShare !== null &&
                    largestShare < 0.01 &&
                    d.node.state === "scanned" &&
                    !d.node.issues ? (
                      <p>
                        No single file dominates. Largest:{" "}
                        {formatSize(d.largestFileBytes, d.ownBytes)} (&lt;1% of
                        file space).
                      </p>
                    ) : (
                      <p>
                        {limitedFiles
                          ? "Other filenames are not included in this list."
                          : "Live file listing."}
                      </p>
                    )}
                    {fileHeavy && (
                      <Button
                        variant="link"
                        size="sm"
                        className="mr-3 h-auto p-0 text-xs"
                        onClick={() => setFileDetails(true)}
                      >
                        File sizes…
                      </Button>
                    )}
                    {limitedFiles && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        disabled={busy}
                        onClick={() => {
                          if (!s.snapshotMode)
                            url({ files: true, q: undefined })
                          else
                            void run(async () => {
                              const next = await api<ViewerStatus>(
                                "scan-folder",
                                {
                                  id: d.node.id,
                                }
                              )
                              await documentChanged(next)
                              url({
                                files: true,
                                q: undefined,
                                id: 0,
                                path: next.root,
                              })
                            })
                        }}
                      >
                        {s.snapshotMode
                          ? "Scan folder & list all files"
                          : "List all files"}
                      </Button>
                    )}
                  </div>
                )}
                <div className="ranked-list min-h-0 flex-1 overflow-y-auto">
                  {d?.entries.map((entry) => (
                    <div
                      key={entry.id}
                      data-entry-id={entry.id}
                      data-hovered={isHoveredEntry(entry, hover) || undefined}
                      onMouseEnter={() => setHover(entry)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(entry)}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                          setHover(null)
                      }}
                      className={`group flex items-center gap-2 border-b px-2 py-1 hover:bg-muted/60 ${isHoveredEntry(entry, hover) ? "bg-accent ring-1 ring-inset ring-ring/50" : selected?.id === entry.id ? "bg-muted" : ""}`}
                    >
                      <span
                        className="size-2 shrink-0 rounded-sm"
                        style={{
                          background: colorFor(colors, entry, dark).fill,
                        }}
                      />
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => open(entry)}
                      >
                        {entry.kind === "directory" ? (
                          <Folder className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <File className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span
                          className={
                            entry.mark === "trash"
                              ? "truncate text-sm text-destructive line-through"
                              : "truncate text-sm"
                          }
                          title={entry.path ?? entry.name}
                        >
                          {entry.name}
                        </span>
                        {entry.mark === "trash" && (
                          <Trash2
                            className="size-3 shrink-0 text-destructive"
                            aria-label="Marked for Trash"
                          />
                        )}
                        {!entry.mark &&
                          !entry.kept &&
                          !entry.trashed &&
                          isSafeTier(entry.tier) && (
                            <span
                              role="img"
                              className="size-2 shrink-0 rounded-full bg-highlight ring-1 ring-primary"
                              aria-label={`Safe to remove: ${tierLabel(entry.tier)}`}
                              title={`Safe to remove: ${tierLabel(entry.tier)}`}
                            />
                          )}
                        {entry.kept && (
                          <ShieldCheck className="size-3 shrink-0" />
                        )}
                        {entry.trashed && (
                          <Badge variant="outline">Trashed</Badge>
                        )}
                      </button>
                      <span className="shrink-0 text-xs font-medium tabular-nums">
                        {formatSize(entry.value, d?.node.value)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Inspect ${entry.name}`}
                        onClick={() => setSelected(entry)}
                      >
                        <ChevronRight />
                      </Button>
                    </div>
                  ))}
                  {d?.entries.length === 0 && (
                    <p className="p-6 text-sm text-muted-foreground">
                      No matching entries.
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
                  <span>
                    {d?.total.toLocaleString() ?? 0}{" "}
                    {limitedFiles
                      ? "listed"
                      : d?.total === 1
                        ? "entry"
                        : "entries"}
                  </span>
                  <div className="flex gap-1">
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
                      disabled={!d || (page + 1) * 100 >= d.total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
                {selected && focus && (
                  <div className="border-t bg-muted/30 p-3">
                    <div className="mb-1 flex justify-between gap-2 text-sm font-medium">
                      <span className="truncate">{focus.name}</span>
                      <span className="shrink-0">
                        {formatSize(focus.value, d?.node.value)}
                      </span>
                    </div>
                    <p className="mb-3 break-all text-xs text-muted-foreground">
                      {focus.path ?? focus.reason ?? "Grouped entries"}
                    </p>
                    {focus.tool && focus.advice && (
                      <p className="mb-3 text-xs text-muted-foreground">
                        {focus.advice}
                      </p>
                    )}
                    {focus.mark && (
                      <Badge variant="outline" className="mb-2">
                        {focus.mark === "trash"
                          ? "Marked for Trash"
                          : "Marked as useless"}
                      </Badge>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {focus.kind === "directory" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!s.finderAvailable || busy}
                          onClick={() =>
                            void run(() => api("finder", { id: focus.id }))
                          }
                        >
                          <FolderOpen />
                          Finder
                        </Button>
                      )}
                      {focus.kind === "directory" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || focus.kept}
                            onClick={() =>
                              void run(() => policy(focus, "keep"))
                            }
                          >
                            <ShieldCheck />
                            Keep
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setExclude(focus)
                            }}
                          >
                            Exclude
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !canAct}
                        onClick={() =>
                          void run(async () =>
                            setPlan(
                              await api<TrashPlan>("trash/preview", {
                                id: focus.id,
                                parentId: Number(d?.node.id.slice(1)),
                              })
                            )
                          )
                        }
                      >
                        <Trash2 />
                        Move to Trash
                        {demo && (
                          <span className="text-muted-foreground">
                            · Simulated
                          </span>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            </ResizablePanel>
          </ResizablePanelGroup>
        </main>
        <Dialog open={fileDetails} onOpenChange={setFileDetails}>
          <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ChartColumn className="size-4 text-muted-foreground" />
                File sizes
              </DialogTitle>
              <DialogDescription>{d?.node.name}</DialogDescription>
            </DialogHeader>
            {d && (
              <FileDistribution
                directory={d}
                documentId={s.documentId}
                showTitle={false}
              />
            )}
          </DialogContent>
        </Dialog>
        <CleanupShortlist
          open={shortlist}
          onOpenChange={setShortlist}
          finderAvailable={s.finderAvailable}
          documentId={s.documentId}
          onBrowse={(entry) =>
            url({
              id: Number(entry.id!.slice(1)),
              path: entry.path,
              panel: undefined,
              q: undefined,
            })
          }
        />
        <AlertDialog
          open={!!plan}
          onOpenChange={(open) => {
            if (!open) setPlan(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {plan?.mode === "demo"
                  ? "Simulate moving to Trash?"
                  : "Move this item to Trash?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {plan?.mode === "demo"
                  ? "Cleanup is simulated, so files stay in place."
                  : "Restore it from Trash in Finder."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="break-all text-sm">{plan?.path}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(plan?.bytes)} allocated · preview expires in 60
              seconds
            </p>
            <AlertDialogFooter>
              {plan?.mode === "demo" && (
                <Button
                  variant="link"
                  className="mr-auto px-0"
                  onClick={() => {
                    setPlan(null)
                    url({ settings: "general" })
                  }}
                >
                  Cleanup settings
                </Button>
              )}
              <Button variant="outline" onClick={() => setPlan(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api<{ message: string }>(
                      "trash/execute",
                      { planId: plan!.id }
                    )
                    setPlan(null)
                    toast.success(result.message)
                  })
                }
              >
                {plan?.mode === "demo" ? "Simulate" : "Move to Trash"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={!!exclude}
          onOpenChange={(open) => {
            if (!open) setExclude(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Exclude this folder?</AlertDialogTitle>
              <AlertDialogDescription>
                Skip this folder and its contents in future scans. Files stay
                unchanged.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="break-all text-sm">{exclude?.path}</p>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setExclude(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() => void run(() => policy(exclude!, "exclude"))}
              >
                Save exclusion
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuGroup>
          <ContextMenuLabel className="max-w-52 truncate">
            {context?.name ?? d?.node.name}
          </ContextMenuLabel>
          {directoryActions(context ?? d?.node, true)}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!context || context.kind !== "directory"}
          onClick={() => open(context!)}
        >
          <Folder />
          Open folder
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!context}
          onClick={() => setSelected(context)}
        >
          <Info />
          Inspect
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
