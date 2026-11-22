import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  HardDrive,
  FolderOpen,
  ChevronDown,
  FileJson,
  LoaderCircle,
  MapPin,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "@/lib/notifications"
import { api, importReport, hasToken } from "@/lib/api"
import type { ViewerStatus, ScanDrive } from "@/lib/api"
import { DestinationRow } from "./destination-row"
import { isWithinDirectory } from "@/lib/destinations"
import { PlacesDialog, useKnowledge } from "./places-dialog"

export function useDrives() {
  return useQuery({
    queryKey: ["drives"],
    queryFn: ({ signal }) => api<ScanDrive[]>("drives", undefined, signal),
    refetchInterval: (query) =>
      query.state.data?.some((drive) => drive.scan?.status === "scanning")
        ? 1500
        : 5000,
    enabled: hasToken(),
  })
}
export function RunnerControls({
  status,
  path,
  onChanged,
  onNavigate,
  onPendingChange,
  disabled = false,
}: {
  disabled?: boolean
  status: ViewerStatus
  path?: string
  onChanged: (status: ViewerStatus) => Promise<void>
  onNavigate?: (path: string) => void
  onPendingChange?: (pending: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null),
    [pending, setPending] = useState(false),
    [stopping, setStopping] = useState<string | null>(null)
  const client = useQueryClient()
  const knowledge = useKnowledge()
  const [placesOpen, setPlacesOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderPath, setFolderPath] = useState("")
  const drives = useDrives()
  const canonical = (value: string) =>
    status.homeDirectory.startsWith("/Users/") &&
    (value === "/System/Volumes/Data" ||
      value.startsWith("/System/Volumes/Data/"))
      ? value.slice("/System/Volumes/Data".length) || "/"
      : value
  const location = canonical(path ?? status.root)
  const savedPlaces =
    knowledge.data?.locations.filter((item) => item.enabled) ?? []
  const savedPlace = savedPlaces
    .filter((item) => isWithinDirectory(location, canonical(item.resolvedPath)))
    .sort((a, b) => b.resolvedPath.length - a.resolvedPath.length)[0]
  const folder = status.directoryDestination
  const isDirectory = !!folder && isWithinDirectory(location, folder.id)
  const isHome =
    !isDirectory && isWithinDirectory(location, status.homeDirectory)
  async function destination(root: string) {
    const target = canonical(root)
    // Navigation inside the current inventory never needs a scan request.
    if (
      status.source.kind === "live" &&
      (root === status.root ||
        (root === status.homeDirectory &&
          status.root === "/System/Volumes/Data" &&
          target.startsWith("/Users/")))
    )
      return { ...status, navigation: { path: root } }
    return api<ViewerStatus>("scan-root", { root })
  }
  function choose(item: ScanDrive) {
    const current = item.id === status.root
    const covered = item.scan?.documentId === status.documentId
    if (onNavigate && status.source.kind !== "report" && (current || covered)) {
      onNavigate(covered ? item.scan!.path : item.id)
      return
    }
    void change(() => destination(item.id), `Opening ${item.name}…`)
  }
  const selected = drives.data
    ?.filter(
      (d) =>
        status.root === d.id ||
        status.root.startsWith(d.id.endsWith("/") ? d.id : d.id + "/")
    )
    .sort((a, b) => b.id.length - a.id.length)[0]
  async function change(operation: () => Promise<ViewerStatus>, label: string) {
    setPending(true)
    onPendingChange?.(true)
    const id = toast.loading(label)
    try {
      const next = await operation()
      await onChanged(next)
      void drives.refetch()
      toast.success(
        next.navigation
          ? "Location opened"
          : next.source.kind === "live"
            ? next.documentId === status.documentId ||
              next.status !== "scanning"
              ? "Location opened"
              : "Scan running"
            : "Report opened",
        { id }
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error), {
        id,
      })
    } finally {
      setPending(false)
      onPendingChange?.(false)
    }
  }
  async function stop(destination: ScanDrive) {
    const documentId = destination.scan?.documentId
    if (!documentId) return
    setStopping(documentId)
    try {
      const next = await api<ViewerStatus>("cancel", { documentId })
      client.setQueryData(["status"], next)
      await Promise.all([
        client.invalidateQueries({ queryKey: ["status"] }),
        client.invalidateQueries({ queryKey: ["drives"] }),
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setStopping(null)
    }
  }
  async function selectScanner(rust: boolean) {
    setPending(true)
    try {
      await api("preferences", { scanner: rust ? "rust" : "node" })
      client.setQueryData(["status"], await api<ViewerStatus>("status"))
      toast.success(
        `${rust ? "Experimental Rust" : "Node"} selected for new scans`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }
  const busy = pending || disabled || stopping !== null
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Open report file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) void change(() => importReport(file), "Opening report…")
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label="Choose folder, Home, or drive"
              className="max-w-52"
            />
          }
        >
          {pending ||
          (status.source.kind === "live" &&
            (status.status === "scanning" || status.cache?.refreshing)) ? (
            <LoaderCircle className="animate-spin" />
          ) : status.source.kind === "report" ? (
            <FileJson />
          ) : isDirectory ? (
            <FolderOpen />
          ) : (
            <HardDrive />
          )}
          <span className="truncate">
            {status.source.kind === "report"
              ? "Report"
              : isDirectory
                ? folder!.name
                : savedPlace
                  ? savedPlace.name
                  : isHome
                    ? "Home"
                    : (selected?.name ??
                      status.root.split("/").filter(Boolean).at(-1) ??
                      "Drive")}
          </span>
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-96 max-w-[calc(100vw-1rem)]">
          {folder && (
            <>
              <DestinationRow
                destination={folder}
                selected={isDirectory && status.source.kind !== "report"}
                disabled={busy}
                stopping={stopping === folder.scan?.documentId}
                updatedAt={
                  client.getQueryState(["status"])?.dataUpdatedAt ?? Date.now()
                }
                onChoose={() => choose(folder)}
                onStop={() => void stop(folder)}
              />
              <DropdownMenuSeparator />
            </>
          )}
          <DestinationRow
            destination={status.homeDestination}
            home
            selected={isHome && status.source.kind !== "report"}
            disabled={busy}
            stopping={stopping === status.homeDestination.scan?.documentId}
            updatedAt={
              client.getQueryState(["status"])?.dataUpdatedAt ?? Date.now()
            }
            onChoose={() => choose(status.homeDestination)}
            onStop={() => void stop(status.homeDestination)}
          />
          <DropdownMenuSeparator />
          {drives.data?.map((drive) => (
            <DestinationRow
              key={drive.id}
              destination={drive}
              selected={
                status.source.kind !== "report" &&
                !isHome &&
                !isDirectory &&
                status.root === drive.id
              }
              disabled={busy}
              stopping={stopping === drive.scan?.documentId}
              updatedAt={drives.dataUpdatedAt}
              onChoose={() => choose(drive)}
              onStop={() => void stop(drive)}
            />
          ))}
          {savedPlaces.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Saved places
              </p>
              {savedPlaces.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={busy}
                  onClick={() =>
                    void change(
                      () => destination(item.resolvedPath),
                      `Opening ${item.name}…`
                    )
                  }
                >
                  <MapPin />
                  <span className="min-w-0">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.path}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            onClick={() => {
              setFolderPath(path ?? status.root)
              setFolderOpen(true)
            }}
          >
            <FolderOpen />
            Scan a folder…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPlacesOpen(true)}>
            <MapPin />
            Add or manage places…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <FileJson />
            Open report…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={status.scanners?.selected === "rust"}
            disabled={busy || !status.scanners?.rust.available}
            onCheckedChange={(checked) => void selectScanner(checked)}
          >
            <span>
              <span className="block">
                Use Rust scanner{" "}
                <span className="ml-1 text-xs text-muted-foreground">
                  Experimental
                </span>
              </span>
              <span className="block text-xs text-muted-foreground">
                Lower scan memory · applies to new scans
              </span>
            </span>
          </DropdownMenuCheckboxItem>
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {status.scanners?.rust.available
              ? `Current scanner: ${status.scanners.active === "rust" ? "Rust (experimental)" : "Node"}. Rescan to use your selection.`
              : (status.scanners?.rust.reason ??
                "This build uses the Node scanner.")}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={() => setPlacesOpen(true)}>
        <MapPin />
        Places
      </Button>
      {placesOpen && (
        <PlacesDialog
          open={placesOpen}
          onOpenChange={setPlacesOpen}
          currentPath={path ?? status.root}
          onChanged={onChanged}
        />
      )}
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan a folder</DialogTitle>
            <DialogDescription>
              Choose a folder on this computer. Scans only read files; you can
              stop at any time.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void change(async () => {
                const next = await api<ViewerStatus>("scan-path", {
                  root: folderPath,
                })
                setFolderOpen(false)
                return next
              }, "Opening folder…")
            }}
          >
            <label className="block space-y-2 text-sm font-medium">
              Folder path
              <Input
                autoFocus
                required
                maxLength={4096}
                placeholder="~/Projects"
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                className="font-mono"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Use an absolute path or ~/ for your home folder. Save frequent
              folders in Places.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFolderOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button disabled={busy}>
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <FolderOpen />
                )}
                Open / scan
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
