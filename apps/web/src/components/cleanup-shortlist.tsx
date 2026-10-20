import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderOpen, Trash2, Flag, X, ArrowRight, Search } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { toast } from "@workspace/ui/components/sonner"
import { api, formatSize } from "@/lib/api"
import type { ShortlistEntry } from "@/lib/api"

export function TrashShortlistButton({
  documentId,
  onClick,
}: {
  documentId: string
  onClick: () => void
}) {
  const result = useQuery({
    queryKey: ["shortlist", documentId],
    queryFn: ({ signal }) =>
      api<ShortlistEntry[]>("shortlist", undefined, signal),
    refetchInterval: 5000,
  })
  const count =
    result.data?.filter((entry) => entry.mark === "trash").length ?? 0
  return (
    <Button
      variant="ghost"
      size="sm"
      className={count ? "text-destructive" : undefined}
      aria-label={`Trash shortlist (${count})`}
      title="Trash shortlist"
      onClick={onClick}
    >
      <Trash2 />
      <span className="tabular-nums">{count}</span>
    </Button>
  )
}

export function CleanupShortlist({
  open,
  onOpenChange,
  finderAvailable,
  documentId,
  onBrowse,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  finderAvailable: boolean
  documentId: string
  onBrowse?: (entry: ShortlistEntry) => void
}) {
  const client = useQueryClient()
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(100)
  const result = useQuery({
    queryKey: ["shortlist", documentId],
    queryFn: ({ signal }) =>
      api<ShortlistEntry[]>("shortlist", undefined, signal),
    enabled: open,
    refetchInterval: open ? 5000 : false,
  })
  const entries = (result.data ?? [])
    .filter((entry) =>
      entry.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    )
    .sort((a, b) => Number(b.mark === "trash") - Number(a.mark === "trash"))
  async function action(entry: ShortlistEntry, action: "finder" | "clear") {
    setBusy(true)
    try {
      await api("shortlist", { path: entry.path, action })
      if (action === "clear") await client.invalidateQueries()
      else toast.success("Sent to Finder")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trash shortlist</DialogTitle>
          <DialogDescription>
            Saved marks across scans. Nothing moves until you review a Trash
            action. Sizes can overlap.
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search shortlist"
            placeholder="Search…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(100)
            }}
          />
        </InputGroup>
        <div className="text-xs text-muted-foreground">
          {result.data
            ? `${result.data.length} marked ${result.data.length === 1 ? "folder" : "folders"}`
            : "Loading…"}
        </div>
        {result.data && !entries.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {query
              ? "No matching folders."
              : "No marks yet. Right-click a folder to mark it for Trash or as useless."}
          </p>
        )}
        <div className="divide-y">
          {entries.slice(0, limit).map((entry) => (
            <div key={entry.path} className="flex items-center gap-2 py-3">
              {entry.mark === "trash" ? (
                <Trash2 className="size-4 shrink-0 text-destructive" />
              ) : (
                <Flag className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={
                      entry.mark === "trash"
                        ? "font-medium text-destructive line-through"
                        : "font-medium"
                    }
                  >
                    {entry.name}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.mark === "trash"
                      ? "Marked for Trash"
                      : "Marked as useless"}
                  </span>
                  {entry.kept && <Badge variant="outline">Kept</Badge>}
                </div>
                <div className="break-all text-xs text-muted-foreground">
                  {entry.path}
                </div>
                <div className="mt-1 text-xs tabular-nums">
                  {entry.bytes === null
                    ? "Outside this inventory · size unknown"
                    : `${entry.partial ? "≥ " : ""}${formatSize(entry.bytes, Math.max(...(result.data ?? []).map((item) => item.bytes ?? 0)))}`}
                </div>
              </div>
              {entry.id && onBrowse && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Browse folder"
                  aria-label={`Browse ${entry.name}`}
                  disabled={busy}
                  onClick={() => {
                    onOpenChange(false)
                    onBrowse(entry)
                  }}
                >
                  <ArrowRight />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                title="Show in Finder"
                aria-label={`Show ${entry.name} in Finder`}
                disabled={busy || !finderAvailable}
                onClick={() => void action(entry, "finder")}
              >
                <FolderOpen />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Clear mark"
                aria-label={`Clear mark for ${entry.name}`}
                disabled={busy}
                onClick={() => void action(entry, "clear")}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
        {entries.length > limit && (
          <Button variant="outline" onClick={() => setLimit(limit + 100)}>
            Show more ({entries.length - limit})
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
