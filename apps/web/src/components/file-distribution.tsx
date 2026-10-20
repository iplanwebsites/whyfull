import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"
import { api, formatCount, formatSize } from "@/lib/api"
import type { DirectoryView, FileDistribution as Distribution } from "@/lib/api"
const colors = [
  "#64748b",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#c2410c",
  "#be123c",
]
function fraction(value: number, total: number) {
  if (!total || !value) return "0%"
  const percent = (value / total) * 100
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`
}
export function FileDistribution({
  directory,
  documentId,
}: {
  directory: DirectoryView
  documentId: string
}) {
  const result = useQuery({
    queryKey: ["file-distribution", documentId, directory.node.id],
    queryFn: ({ signal }) =>
      api<Distribution>("file-distribution", { id: directory.node.id }, signal),
    enabled: false,
    retry: false,
    staleTime: Infinity,
  })
  const data = result.data
  useEffect(() => {
    if (result.error) toast.error(result.error.message)
  }, [result.error])
  useEffect(() => {
    if (data?.unreadable)
      toast.error(
        `${data.unreadable} files could not be measured. The distribution is incomplete.`
      )
  }, [data])
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background p-4"
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-medium">File sizes</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={result.isFetching}
          onClick={() => void result.refetch()}
        >
          <RefreshCw className={result.isFetching ? "animate-spin" : ""} />
          {result.isFetching
            ? "Measuring…"
            : data
              ? "Refresh"
              : "Measure file sizes"}
        </Button>
      </div>
      <div className="mb-5 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <div className="text-xs text-muted-foreground">
            {data ? "Measured files" : "Files"}
          </div>
          <div
            className="text-2xl font-semibold tabular-nums"
            title={(data?.files ?? directory.ownFiles).toLocaleString()}
          >
            {formatCount(data?.files ?? directory.ownFiles)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            {data ? "Average file size" : "Average file on disk"}
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatSize(
              data?.averageBytes ??
                directory.ownBytes / Math.max(1, directory.ownFiles)
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            {data ? "Largest file" : "Largest file on disk"}
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatSize(data?.largestBytes ?? directory.largestFileBytes)}
          </div>
        </div>
      </div>
      {data ? (
        <div className="min-h-0 overflow-auto">
          <div className="mb-2 grid grid-cols-[minmax(90px,0.9fr)_1fr_1fr] gap-4 text-xs text-muted-foreground">
            <span>File size</span>
            <span>Files</span>
            <span>Allocated space</span>
          </div>
          {data.buckets.map((bucket, index) => (
            <div
              key={bucket.label}
              className="grid grid-cols-[minmax(90px,0.9fr)_1fr_1fr] items-center gap-4 border-t py-3 text-xs"
            >
              <span className="font-medium">{bucket.label}</span>
              <div title={`${bucket.files.toLocaleString()} files`}>
                <div className="mb-1 flex flex-wrap justify-between gap-1 tabular-nums">
                  <span>{formatCount(bucket.files)}</span>
                  <span className="text-muted-foreground">
                    {fraction(bucket.files, data.files)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded"
                    style={{
                      background: colors[index],
                      width: `${data.files ? (bucket.files / data.files) * 100 : 0}%`,
                      minWidth: bucket.files ? 2 : 0,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 flex flex-wrap justify-between gap-1 tabular-nums">
                  <span>{formatSize(bucket.bytes, data.bytes)}</span>
                  <span className="text-muted-foreground">
                    {fraction(bucket.bytes, data.bytes)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded"
                    style={{
                      background: colors[index],
                      width: `${data.bytes ? (bucket.bytes / data.bytes) * 100 : 0}%`,
                      minWidth: bucket.bytes ? 2 : 0,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
          <p className="mt-4 text-xs text-muted-foreground">
            Live direct-file metadata ·{" "}
            {new Date(data.measuredAt).toLocaleTimeString()}
            {data.unreadable ? " · incomplete" : ""}. Shared blocks can overlap
            across filenames.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
          <p>Measure file sizes to see how many are small, medium, or large.</p>
        </div>
      )}
    </div>
  )
}
