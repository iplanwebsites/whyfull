import { MinimumFileSize } from "./minimum-file-size"
import { toast } from "@workspace/ui/components/sonner"
import { RunnerControls, useDrives } from "./runner-controls"
import { DiagnosticsDialog } from "./diagnostics-dialog"
import { CleanupShortlist, TrashShortlistButton } from "./cleanup-shortlist"
import { FileDistribution } from "./file-distribution"
import { ReportViewer } from "./report-viewer"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  HardDrive,
  Folder,
  File,
  ShieldCheck,
  Trash2,
  Search,
  ArrowUp,
  Download,
  Terminal,
  LayoutGrid,
  ChartPie,
  Sun,
  Moon,
  RefreshCw,
  Info,
  ChevronRight,
  Eye,
  Ellipsis,
  FolderOpen,
  Copy,
  Flag,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
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
  DropdownMenuCheckboxItem,
} from "@workspace/ui/components/dropdown-menu"
import { Route } from "@/routes/index"
import { api, formatSize, exportSnapshot, hasToken } from "@/lib/api"
import type {
  ViewerStatus,
  DirectoryView,
  ViewEntry,
  ViewerPreferences,
  TrashPlan,
} from "@/lib/api"
import { copyPath } from "@/lib/clipboard"
import { chartColors, colorFor } from "@/lib/chart-colors"
import { Treemap } from "./treemap"
const loadSunburst = () => import("./sunburst")
type SunburstComponent = (typeof import("./sunburst"))["default"]

export function Explorer() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    client = useQueryClient()
  const [page, setPage] = useState(0),
    [shortlist, setShortlist] = useState(false),
    [diagnostics, setDiagnostics] = useState(false),
    [selected, setSelected] = useState<ViewEntry | null>(null),
    [hover, setHover] = useState<ViewEntry | null>(null),
    [changing, setChanging] = useState(false),
    [working, setBusy] = useState(false),
    [context, setContext] = useState<ViewEntry | null>(null),
    [plan, setPlan] = useState<TrashPlan | null>(null),
    [enable, setEnable] = useState(false),
    [exclude, setExclude] = useState<ViewEntry | null>(null)
  const [mapForPath, setMapForPath] = useState<string | null>(null)
  const [Sunburst, setSunburst] = useState<SunburstComponent | null>(null)
  const busy = working || changing
  const restored = useRef(false),
    input = useRef<HTMLInputElement>(null)
  const status = useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api<ViewerStatus>("status", undefined, signal),
    refetchInterval: (query) =>
      query.state.data?.status === "scanning" ? 1500 : 5000,
    enabled: hasToken(),
  })
  const drives = useDrives()
  const s = status.data,
    view = search.view ?? s?.viewer.view ?? "treemap",
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
      search.id,
      search.path,
      search.q,
      search.files,
      sort,
      page,
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
    enabled: !!s && s.source.kind !== "report" && !changing,
    refetchInterval: s?.status === "scanning" ? 2500 : false,
  })
  const d = directory.data
  const manyFiles = !!d && d.ownFiles > d.retainedFiles
  const limitedFiles = manyFiles && d?.fileScope === "largest"
  const fileHeavy =
    manyFiles && !!d && d.ownBytes > 0 && d.ownBytes >= d.node.value * 0.9
  const largestShare =
    d && d.ownBytes > 0 ? d.largestFileBytes / d.ownBytes : null
  const dark =
    s?.viewer.theme === "dark" ||
    (s?.viewer.theme === "system" &&
      typeof window !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches)
  const colors = useMemo(() => chartColors(d?.chart, dark), [d?.chart, dark])
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
        path: next.source.kind === "report" ? undefined : next.root,
        q: undefined,
        files: undefined,
        panel: undefined,
      }),
    })
    client.setQueryData(["status"], next)
    client.removeQueries({ queryKey: ["directory"] })
  }
  function url(patch: Partial<typeof search>, replace = false) {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace })
    setPage(0)
    setSelected(null)
    setHover(null)
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
  async function prefs(patch: Partial<ViewerPreferences>) {
    await api("preferences", patch)
    void client.invalidateQueries({ queryKey: ["status"] })
  }
  function open(node: ViewEntry) {
    if (node.kind !== "directory") return setSelected(node)
    url({ id: Number(node.id.slice(1)), path: node.path, q: undefined })
    if (node.path) void run(() => prefs({ lastPath: node.path }))
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
    if (
      s.source.kind !== "report" &&
      s.root !== s.homeDirectory &&
      search.id === undefined &&
      !search.path &&
      s.viewer.lastPath
    )
      url({ path: s.viewer.lastPath })
  }, [s])
  useEffect(() => {
    if (s?.source.kind === "live" && s.status !== "scanning")
      void client.invalidateQueries({ queryKey: ["directory", s.documentId] })
  }, [s?.status, s?.documentId, s?.source.kind, client])
  useEffect(() => {
    if (s?.status === "failed")
      toast.error(s.saveError ?? "The scan could not finish", {
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
    const theme = s?.viewer.theme ?? "light"
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" ||
        (theme === "system" &&
          matchMedia("(prefers-color-scheme: dark)").matches)
    )
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
  if (!s) return <main className="disk-workspace" aria-busy="true" />
  if (s.source.kind === "report")
    return (
      <ReportViewer
        key={s.documentId}
        status={s}
        onChanged={documentChanged}
        onPendingChange={setChanging}
      />
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
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <RunnerControls
            status={s}
            disabled={busy}
            onChanged={documentChanged}
            onPendingChange={setChanging}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Parent folder"
            title="Parent folder"
            disabled={!d || d.crumbs.length < 2}
            onClick={up}
          >
            <ArrowUp />
          </Button>
          <Breadcrumb className="min-w-0 flex-1 overflow-x-auto">
            <BreadcrumbList className="flex-nowrap gap-1">
              {d?.crumbs
                .filter(
                  (crumb, index) =>
                    index !== 0 ||
                    !drives.data?.some((drive) => drive.id === crumb.path)
                )
                .map((crumb, i) => (
                  <BreadcrumbItem key={crumb.id}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <button
                      className="max-w-36 truncate text-xs hover:text-foreground"
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
                  </BreadcrumbItem>
                ))}
            </BreadcrumbList>
          </Breadcrumb>
          {d?.node.mark && (
            <span
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
                <Flag className="size-3 text-amber-600" />
              )}
            </span>
          )}
          <span
            className="text-xs tabular-nums text-muted-foreground"
            title="Allocated size"
          >
            {formatSize(d?.node.value ?? s.bytes)}
          </span>
          <TrashShortlistButton
            documentId={s.documentId}
            onClick={() => setShortlist(true)}
          />
          <Badge
            variant="outline"
            className={demo ? "text-emerald-700" : "text-destructive"}
          >
            <Eye size={12} />
            {demo ? "Demo" : "Real Trash"}
          </Badge>
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
                        setMapForPath(d?.node.path ?? null)
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
                  <DropdownMenuRadioGroup
                    aria-label="Appearance"
                    className="flex shrink-0 gap-1 rounded-lg bg-muted p-1"
                    value={dark ? "dark" : "light"}
                    onValueChange={(value) =>
                      void run(() =>
                        prefs({ theme: value as "light" | "dark" })
                      )
                    }
                  >
                    <DropdownMenuRadioItem
                      value="light"
                      aria-label="Light mode"
                      title="Light mode"
                      closeOnClick={false}
                      className="justify-center px-2 py-1.5 data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                    >
                      <Sun />
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="dark"
                      aria-label="Dark mode"
                      title="Dark mode"
                      closeOnClick={false}
                      className="justify-center px-2 py-1.5 data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                    >
                      <Moon />
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
              <DropdownMenuCheckboxItem
                checked={demo}
                onCheckedChange={(checked) =>
                  checked
                    ? void run(() => api("cleanup-mode", { mode: "demo" }))
                    : setEnable(true)
                }
              >
                <Eye />
                Demo mode
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem
                disabled={busy || s.snapshotMode}
                onClick={() =>
                  void run(() =>
                    api(s.status === "scanning" ? "cancel" : "rescan", {})
                  )
                }
              >
                <RefreshCw />
                {s.status === "scanning" ? "Pause scan" : "Rescan"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDiagnostics(true)}>
                <Terminal />
                Diagnostics
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShortlist(true)}>
                <Trash2 />
                Cleanup shortlist
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => url({ panel: "rules" })}>
                <ShieldCheck />
                Keep & exclude rules
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
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <div
            className="explorer-grid flex-1 overflow-hidden rounded-xl border"
            aria-busy={directory.isFetching || changing}
          >
            <section className="flex min-w-0 flex-col bg-muted/25">
              <div className="relative min-h-0 flex-1">
                {directory.error ? (
                  <div className="p-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => url({ id: 0, path: s.root })}
                    >
                      Back to root
                    </Button>
                  </div>
                ) : d && fileHeavy && mapForPath !== d.node.path ? (
                  <FileDistribution
                    key={`${s.documentId}:${d.node.id}`}
                    directory={d}
                    documentId={s.documentId}
                    onMap={() => setMapForPath(d.node.path ?? null)}
                  />
                ) : d ? (
                  <>
                    {fileHeavy && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute right-3 top-3 z-10"
                        onClick={() => setMapForPath(null)}
                      >
                        File sizes
                      </Button>
                    )}
                    {view === "treemap" ? (
                      <Treemap
                        root={d.chart}
                        colors={colors}
                        dark={dark}
                        onOpen={open}
                        onSelect={setSelected}
                        onHover={setHover}
                        onContext={setContext}
                      />
                    ) : Sunburst ? (
                      <Sunburst
                        root={d.chart}
                        colors={colors}
                        dark={dark}
                        onOpen={open}
                        onSelect={setSelected}
                        onHover={setHover}
                        onContext={setContext}
                        onUp={up}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
              <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t px-2 text-[11px] text-muted-foreground">
                <span className="truncate">
                  {hover?.path ?? hover?.name ?? ""}
                </span>
                <span className="shrink-0">
                  {hover ? formatSize(hover.value, d?.node.value) : ""}
                </span>
              </div>
            </section>
            <section className="flex min-h-0 flex-col border-l">
              <div className="flex flex-wrap items-center gap-2 border-b p-2">
                <div className="shrink-0">
                  <select
                    aria-label="Sort entries"
                    className="rounded border bg-background px-2 py-1 text-xs"
                    value={sort}
                    onChange={(e) => {
                      const value = e.target.value as "size" | "name"
                      url({ sort: value })
                      void run(() => prefs({ sort: value }))
                    }}
                  >
                    <option value="size">Size ↓</option>
                    <option value="name">Name A–Z</option>
                  </select>
                </div>
                <div className="relative min-w-28 flex-1">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    ref={input}
                    aria-label={
                      limitedFiles
                        ? "Search listed entries"
                        : "Search this folder"
                    }
                    placeholder={
                      limitedFiles ? "Search listed entries…" : "Search…"
                    }
                    className="pl-9"
                    value={search.q ?? ""}
                    onChange={(e) =>
                      url({ q: e.target.value || undefined }, true)
                    }
                  />
                </div>
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
                  <p className="font-medium text-foreground">
                    {d.ownFiles.toLocaleString()} files ·{" "}
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
                        : "All-file browsing uses the current folder on disk."}
                    </p>
                  )}
                  {limitedFiles && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={busy}
                      onClick={() => {
                        if (!s.snapshotMode) url({ files: true, q: undefined })
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
                    className={`group flex items-center gap-2 border-b px-2 py-1 hover:bg-muted/60 ${selected?.id === entry.id ? "bg-muted" : ""}`}
                  >
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{ background: colorFor(colors, entry, dark).fill }}
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
                    {focus.path ??
                      focus.reason ??
                      "Grouped entries cannot be moved."}
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
                          onClick={() => void run(() => policy(focus, "keep"))}
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
                      {demo ? "Try cleanup" : "Move to Trash"}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
        <DiagnosticsDialog
          open={diagnostics}
          onOpenChange={setDiagnostics}
          onReport={documentChanged}
        />
        <CleanupShortlist
          open={shortlist}
          onOpenChange={setShortlist}
          finderAvailable={s.finderAvailable}
          documentId={s.documentId}
          onBrowse={(entry) =>
            open({
              id: entry.id!,
              // Marks use canonical paths; browse by this inventory's ID.
              name: entry.name,
              value: entry.bytes ?? 0,
              kind: "directory",
            })
          }
        />
        <Dialog
          open={!!search.panel}
          onOpenChange={(open) => {
            if (!open) url({ panel: undefined })
          }}
        >
          <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {search.panel === "rules"
                  ? "Keep & exclude rules"
                  : "Scan details"}
              </DialogTitle>
              <DialogDescription>
                {search.panel === "rules"
                  ? "Keep protects folders from cleanup. Exclude skips scanning a folder and hides its contents after a rescan."
                  : "This inventory stays on your computer."}
              </DialogDescription>
            </DialogHeader>
            {search.panel === "rules" ? (
              <div>
                {(["keep", "exclude"] as const).map((kind) => (
                  <section key={kind} className="mb-5">
                    <h3 className="mb-2 text-sm font-medium capitalize">
                      {kind}
                    </h3>
                    {s.policy[kind].length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No rules yet. Select a folder in the explorer to add
                        one.
                      </p>
                    )}
                    {s.policy[kind].map((path) => (
                      <div
                        key={path}
                        className="flex items-center gap-3 border-b py-2"
                      >
                        <span className="min-w-0 flex-1 break-all text-xs">
                          {path}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              api("policy", { path, action: "clear" })
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </section>
                ))}
                <p className="break-all text-xs text-muted-foreground">
                  Saved in {s.policyFile}
                </p>
              </div>
            ) : (
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
            )}
          </DialogContent>
        </Dialog>
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
                  ? "Preview cleanup"
                  : "Move this item to Trash?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {plan?.mode === "demo"
                  ? "This is a demo. No files will be changed."
                  : "macOS will move this item to Trash. You can restore it in Finder."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="break-all text-sm">{plan?.path}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(plan?.bytes)} allocated · preview expires in 60
              seconds
            </p>
            <AlertDialogFooter>
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
                {plan?.mode === "demo" ? "Run demo" : "Move to Trash"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={enable} onOpenChange={setEnable}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Enable real Trash moves?</AlertDialogTitle>
              <AlertDialogDescription>
                {s.cleanup.reason ??
                  "Cleanup will move selected items to macOS Trash after a preview. Every new session starts in demo mode."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setEnable(false)}>
                Keep demo mode
              </Button>
              <Button
                disabled={!s.cleanup.enabled || s.status === "scanning" || busy}
                onClick={() =>
                  void run(async () => {
                    await api("cleanup-mode", { mode: "trash" })
                    setEnable(false)
                  })
                }
              >
                Enable Trash
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
                Future scans will skip this folder and its contents. Nothing
                will be moved or deleted.
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
