import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
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
  LayoutGrid,
  ChartPie,
  Sun,
  Moon,
  RefreshCw,
  Info,
  ChevronRight,
  Eye,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Badge } from "@workspace/ui/components/badge"
import { Switch } from "@workspace/ui/components/switch"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
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
import { Route } from "@/routes/index"
import { api, formatSize, exportSnapshot, hasToken } from "@/lib/api"
import type {
  ViewerStatus,
  DirectoryView,
  ViewEntry,
  ViewerPreferences,
  TrashPlan,
} from "@/lib/api"
import { chartColors, colorFor } from "@/lib/chart-colors"
import { Treemap } from "./treemap"
const Sunburst = lazy(() => import("./sunburst"))

export function Explorer() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    client = useQueryClient()
  const [page, setPage] = useState(0),
    [selected, setSelected] = useState<ViewEntry | null>(null),
    [hover, setHover] = useState<ViewEntry | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [plan, setPlan] = useState<TrashPlan | null>(null),
    [enable, setEnable] = useState(false),
    [exclude, setExclude] = useState<ViewEntry | null>(null)
  const restored = useRef(false),
    input = useRef<HTMLInputElement>(null)
  const status = useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api<ViewerStatus>("status", undefined, signal),
    refetchInterval: (query) =>
      query.state.data?.status === "scanning" ? 1500 : 5000,
    enabled: hasToken(),
  })
  const s = status.data,
    view = search.view ?? s?.viewer.view ?? "treemap",
    sort = search.sort ?? s?.viewer.sort ?? "size"
  const directory = useQuery({
    queryKey: [
      "directory",
      s?.startedAt,
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
    enabled: !!s,
    refetchInterval: s?.status === "scanning" ? 2500 : false,
  })
  const d = directory.data
  const dark =
    s?.viewer.theme === "dark" ||
    (s?.viewer.theme === "system" &&
      typeof window !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches)
  const colors = useMemo(() => chartColors(d?.chart, dark), [d?.chart, dark])
  function url(patch: Partial<typeof search>, replace = false) {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace })
    setPage(0)
    setSelected(null)
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setMessage("")
    try {
      await action()
      await client.invalidateQueries()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
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
    setMessage(
      action === "exclude"
        ? "Exclusion saved. Rescan to update the map."
        : "Keep rule saved. This folder is protected from Trash moves."
    )
    setExclude(null)
  }
  useEffect(() => {
    if (!s || restored.current) return
    restored.current = true
    if (search.id === undefined && !search.path && s.viewer.lastPath)
      url({ path: s.viewer.lastPath })
  }, [s])
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
  if (!s)
    return (
      <main className="p-12">
        {status.error?.message ?? "Loading your local inventory…"}
      </main>
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
    <div className="disk-workspace">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <span
          className="mr-1 flex items-center gap-1.5 text-sm font-semibold"
          title="whyfull"
        >
          <HardDrive className="size-4" />
          whyfull
        </span>
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
            {d?.crumbs.map((crumb, i) => (
              <BreadcrumbItem key={crumb.id}>
                {i > 0 && <BreadcrumbSeparator />}
                <button
                  className="max-w-36 truncate text-xs hover:text-foreground"
                  title={crumb.path}
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
                  {i === 0 ? crumb.path : crumb.name}
                </button>
              </BreadcrumbItem>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center gap-1">
          <Badge
            variant="outline"
            className={demo ? "text-emerald-700" : "text-destructive"}
          >
            <Eye size={12} />
            {demo ? "Demo" : "Real Trash"}
          </Badge>
          <Switch
            aria-label="Demo mode"
            title="Demo mode"
            checked={demo}
            onCheckedChange={(checked) =>
              checked
                ? void run(() => api("cleanup-mode", { mode: "demo" }))
                : (setMessage(""), setEnable(true))
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={s.status === "scanning" ? "Pause scan" : "Rescan"}
            title={s.status === "scanning" ? "Pause scan" : "Rescan"}
            disabled={busy || s.snapshotMode}
            onClick={() =>
              void run(async () => {
                await api(s.status === "scanning" ? "cancel" : "rescan", {})
              })
            }
          >
            <RefreshCw
              className={s.status === "scanning" ? "animate-spin" : ""}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Keep & exclude rules"
            title="Keep & exclude rules"
            onClick={() => url({ panel: "rules" })}
          >
            <ShieldCheck />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Scan details"
            title="Scan details"
            onClick={() => url({ panel: "scan" })}
          >
            <Info />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Export snapshot"
            title="Export snapshot"
            disabled={busy}
            onClick={() => void run(exportSnapshot)}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle appearance"
            title="Toggle appearance"
            onClick={() =>
              void run(() =>
                prefs({ theme: s.viewer.theme === "dark" ? "light" : "dark" })
              )
            }
          >
            {s.viewer.theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {(message || s.needsRescan) && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between rounded-lg border bg-muted px-4 py-3 text-sm"
          >
            {message || "Files moved to Trash. Rescan to refresh sizes."}
            <Button size="sm" variant="ghost" onClick={() => setMessage("")}>
              Dismiss
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Tabs
            value={view}
            onValueChange={(value) => {
              const v = value as "treemap" | "sunburst"
              url({ view: v })
              void run(() => prefs({ view: v }))
            }}
          >
            <TabsList>
              <TabsTrigger value="treemap">
                <LayoutGrid />
                Treemap
              </TabsTrigger>
              <TabsTrigger value="sunburst">
                <ChartPie />
                Rings
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span
            className="ml-auto text-xs tabular-nums text-muted-foreground"
            title="Allocated size"
          >
            {formatSize(d?.node.value ?? s.bytes)}
          </span>
        </div>
        <div className="explorer-grid flex-1 overflow-hidden rounded-xl border">
          <section className="flex min-w-0 flex-col bg-muted/25">
            <div className="relative min-h-0 flex-1">
              {directory.error ? (
                <div role="alert" className="p-8 text-sm">
                  {directory.error.message}
                  <Button
                    variant="link"
                    onClick={() => url({ id: 0, path: undefined })}
                  >
                    Return to scan root
                  </Button>
                </div>
              ) : d ? (
                <Suspense
                  fallback={<div className="p-8 text-sm">Loading rings…</div>}
                >
                  {view === "treemap" ? (
                    <Treemap
                      root={d.chart}
                      colors={colors}
                      dark={dark}
                      onOpen={open}
                      onSelect={setSelected}
                      onHover={setHover}
                    />
                  ) : (
                    <Sunburst
                      root={d.chart}
                      colors={colors}
                      dark={dark}
                      onOpen={open}
                      onSelect={setSelected}
                      onHover={setHover}
                      onUp={up}
                    />
                  )}
                </Suspense>
              ) : (
                <div className="p-8">Reading folder…</div>
              )}
            </div>
            <div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t px-2 text-[11px] text-muted-foreground">
              <span className="truncate">
                {hover?.path ?? hover?.name ?? ""}
              </span>
              <span className="shrink-0">
                {hover ? formatSize(hover.value) : ""}
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
                  aria-label="Search this folder"
                  placeholder="Search…"
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
            <div className="ranked-list min-h-0 flex-1 overflow-y-auto">
              {d?.entries.map((entry) => (
                <div
                  key={entry.id}
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
                      className="truncate text-sm"
                      title={entry.path ?? entry.name}
                    >
                      {entry.name}
                    </span>
                    {entry.kept && <ShieldCheck className="size-3 shrink-0" />}
                    {entry.trashed && <Badge variant="outline">Trashed</Badge>}
                  </button>
                  <span className="shrink-0 text-xs font-medium tabular-nums">
                    {formatSize(entry.value)}
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
              <span>{d?.total.toLocaleString() ?? 0} entries</span>
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
                  <span className="shrink-0">{formatSize(focus.value)}</span>
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
                <div className="flex flex-wrap gap-2">
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
                          setMessage("")
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
                      No rules yet. Select a folder in the explorer to add one.
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
            {formatSize(plan?.bytes)} allocated · preview expires in 60 seconds
          </p>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
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
                  setMessage(result.message)
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
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
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
              Future scans will skip this folder and its contents. Nothing will
              be moved or deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all text-sm">{exclude?.path}</p>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
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
    </div>
  )
}
