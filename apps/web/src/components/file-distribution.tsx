import { useQuery } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { api, formatCount, formatSize } from "@/lib/api"
import type { DirectoryView, FileDistribution as Distribution } from "@/lib/api"
// Small to large file sizes, in the viewer's earthy chart family.
const colors = [
  "#a8a28c",
  "#8fa287",
  "#6c7a86",
  "#626d30",
  "#b4674a",
  "#8a4a3a",
]
function fraction(value: number, total: number) {
  if (!total || !value) return "0%"
  const percent = (value / total) * 100
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`
}
export function FileDistribution({
  directory,
  documentId,
  showTitle = true,
}: {
  directory: DirectoryView
  documentId: string
  showTitle?: boolean
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
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background p-4"
      onContextMenu={(event) => event.stopPropagation()}
    >
      {(showTitle || data) && (
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          {showTitle && (
            <h2 className="flex-1 text-sm font-medium">File sizes</h2>
          )}
          {data && (
            <Button
              variant="outline"
              size="sm"
              disabled={result.isFetching}
              onClick={() => void result.refetch()}
            >
              <RefreshCw className={result.isFetching ? "animate-spin" : ""} />
              {result.isFetching ? "Measuring…" : "Refresh"}
            </Button>
          )}
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <div className="text-xs text-muted-foreground">Files</div>
          <div
            className="text-2xl font-semibold tabular-nums"
            title={(data?.files ?? directory.ownFiles).toLocaleString()}
          >
            {formatCount(data?.files ?? directory.ownFiles)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Average size</div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatSize(
              data?.averageBytes ??
                directory.ownBytes / Math.max(1, directory.ownFiles)
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Largest file</div>
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
            Measured {new Date(data.measuredAt).toLocaleTimeString()}
            {data.unreadable
              ? ` · ${formatCount(data.unreadable)} unreadable files not counted`
              : ""}{" "}
            · Shared blocks may overlap
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
          {result.error ? (
            <p role="alert">Couldn’t measure. {result.error.message}</p>
          ) : (
            <p>Size breakdown not measured</p>
          )}
          <Button
            disabled={result.isFetching}
            onClick={() => void result.refetch()}
          >
            <RefreshCw className={result.isFetching ? "animate-spin" : ""} />
            {result.isFetching
              ? "Measuring…"
              : result.error
                ? "Try again"
                : "Measure file sizes"}
          </Button>
        </div>
      )}
    </div>
  )
}
