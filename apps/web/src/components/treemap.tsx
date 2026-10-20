import { colorFor } from "@/lib/chart-colors"
import type { ChartColors } from "@/lib/chart-colors"
import { useLayoutEffect, useRef, useState } from "react"
import { horizontalTreemap } from "@/lib/treemap-layout"
import type { Rect } from "@/lib/treemap-layout"
import { formatSize, formatCount } from "@/lib/api"
import type { ViewEntry } from "@/lib/api"

export function Treemap({
  root,
  colors,
  dark,
  onOpen,
  onSelect,
  onHover,
  onContext,
}: {
  colors: ChartColors
  dark: boolean
  root: ViewEntry
  onOpen: (node: ViewEntry) => void
  onSelect: (node: ViewEntry) => void
  onHover: (node: ViewEntry | null) => void
  onContext: (node: ViewEntry) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = container.current!
    const measure = () => {
      const width = element.clientWidth,
        height = element.clientHeight
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  function tiles(entries: ViewEntry[], bounds: Rect): React.ReactNode {
    return horizontalTreemap(entries, bounds)
      .filter(({ rect }) => rect.width > 2 && rect.height > 2)
      .map(({ entry, rect }) => {
        const paint = colorFor(colors, entry, dark)
        const x = rect.x + 1.5,
          y = rect.y + 1.5,
          w = Math.max(0, rect.width - 3),
          h = Math.max(0, rect.height - 3)
        const fileGroup =
          (entry.kind === "remainder" || entry.kind === "group") &&
          entry.files !== undefined
        const label = fileGroup
          ? `${formatCount(entry.files!)} ${entry.files === 1 ? "file" : "files"}`
          : entry.name
        const largeLabel = w > 240 && h > 140
        const largeCount = fileGroup && largeLabel
        const countSize = Math.min(64, Math.max(28, Math.min(w / 7, h / 4)))
        const open = () =>
          entry.kind === "directory" ? onOpen(entry) : onSelect(entry)
        return (
          <g key={entry.id}>
            <rect
              data-entry-id={entry.id}
              onContextMenu={() => onContext(entry)}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={5}
              fill={paint.fill}
              fillOpacity={entry.trashed ? 0.35 : 1}
              stroke={
                entry.mark === "trash"
                  ? "#ef4444"
                  : entry.mark === "useless"
                    ? "#d69e2e"
                    : paint.stroke
              }
              strokeDasharray={entry.mark ? "4 2" : undefined}
              strokeWidth={1}
              role="button"
              tabIndex={0}
              aria-label={`${entry.name}, ${formatSize(entry.value, root.value)}${entry.kind === "directory" ? ", open folder" : ""}`}
              className="map-tile"
              onClick={open}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  open()
                }
              }}
              onMouseEnter={() => onHover(entry)}
              onMouseLeave={() => onHover(null)}
            >
              <title>
                {entry.name}
                {entry.path ? `\n${entry.path}` : ""}
                {"\n"}
                {formatSize(entry.value, root.value)} allocated
                {entry.mark
                  ? ` · ${entry.mark === "trash" ? "Marked for Trash" : "Marked as useless"}`
                  : ""}
              </title>
            </rect>
            {w > 55 && h > 23 && (
              <foreignObject
                x={x + 10}
                y={y + 7}
                width={Math.max(0, w - 20)}
                height={
                  largeCount
                    ? Math.min(h - 12, countSize * 2 + 20)
                    : Math.min(h - 12, 70)
                }
                pointerEvents="none"
              >
                <div className="tile-label" style={{ color: paint.text }}>
                  <span
                    style={
                      largeCount
                        ? {
                            fontSize: countSize,
                            lineHeight: 1.1,
                            fontWeight: 600,
                            letterSpacing: "-0.035em",
                          }
                        : largeLabel
                          ? { fontSize: 26, fontWeight: 600 }
                          : undefined
                    }
                  >
                    {label}
                  </span>
                  <span
                    style={
                      largeCount
                        ? {
                            fontSize: Math.max(18, countSize * 0.45),
                            marginTop: 6,
                            fontWeight: 500,
                          }
                        : largeLabel
                          ? { fontSize: 20, fontWeight: 500 }
                          : undefined
                    }
                  >
                    {formatSize(entry.value, root.value)}
                  </span>
                </div>
              </foreignObject>
            )}
          </g>
        )
      })
  }
  return (
    <div ref={container} className="h-full min-h-0 w-full">
      {size.width > 0 && size.height > 0 && (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-label="Horizontal treemap of allocated space"
          role="group"
        >
          {tiles(root.children ?? [], {
            x: 6,
            y: 6,
            width: size.width - 12,
            height: size.height - 12,
          })}
        </svg>
      )}
    </div>
  )
}
