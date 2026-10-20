import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  HardDrive,
  ChevronDown,
  FileJson,
  Check,
  LoaderCircle,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "@workspace/ui/components/sonner"
import { api, importReport, formatSize, hasToken } from "@/lib/api"
import type { ViewerStatus, ScanDrive } from "@/lib/api"
export function useDrives() {
  return useQuery({
    queryKey: ["drives"],
    queryFn: ({ signal }) => api<ScanDrive[]>("drives", undefined, signal),
    refetchInterval: 30000,
    enabled: hasToken(),
  })
}
export function RunnerControls({
  status,
  onChanged,
  onPendingChange,
  disabled = false,
}: {
  disabled?: boolean
  status: ViewerStatus
  onChanged: (status: ViewerStatus) => Promise<void>
  onPendingChange?: (pending: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null),
    [pending, setPending] = useState(false)
  const drives = useDrives()
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
      toast.success(
        next.source.kind === "live" ? "Scan started" : "Report opened",
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
              disabled={pending || disabled}
              aria-label="Choose drive or open report"
              className="max-w-52"
            />
          }
        >
          {pending ||
          (status.source.kind === "live" && status.status === "scanning") ? (
            <LoaderCircle className="animate-spin" />
          ) : status.source.kind === "report" ? (
            <FileJson />
          ) : (
            <HardDrive />
          )}
          <span className="truncate">
            {status.source.kind === "report"
              ? "Report"
              : (selected?.name ??
                status.root.split("/").filter(Boolean).at(-1) ??
                "Drive")}
          </span>
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72">
          {drives.data?.map((drive) => (
            <DropdownMenuItem
              key={drive.id}
              disabled={pending || disabled}
              onClick={() =>
                void change(
                  () => api<ViewerStatus>("scan-root", { root: drive.id }),
                  `Scanning ${drive.name}…`
                )
              }
            >
              <HardDrive />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate">{drive.name}</span>
                  {drive.default && (
                    <span className="text-[10px] text-muted-foreground">
                      Default
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {drive.id}
                  {drive.volume
                    ? ` · ${formatSize(drive.volume.free)} free`
                    : ""}
                </div>
              </div>
              {status.source.kind === "live" && status.root === drive.id && (
                <Check className="size-3" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={pending || disabled}
            onClick={() => input.current?.click()}
          >
            <FileJson />
            Open report…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
