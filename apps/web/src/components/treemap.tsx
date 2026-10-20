import { useEffect, useRef, useState } from "react"
import { horizontalTreemap } from "@/lib/treemap-layout"
import type { Rect } from "@/lib/treemap-layout"
import { entryColor, formatSize } from "@/lib/api"
import type { ViewEntry } from "@/lib/api"

export function Treemap({
  root,
  onOpen,
  onSelect,
  onHover,
}: {
  root: ViewEntry
  onOpen: (node: ViewEntry) => void
  onSelect: (node: ViewEntry) => void
  onHover: (node: ViewEntry | null) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    )
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  function tiles(
    entries: ViewEntry[],
    bounds: Rect,
    depth = 0,
    inherited?: string
  ): React.ReactNode {
    return horizontalTreemap(entries, bounds)
      .filter(({ rect }) => rect.width > 2 && rect.height > 2)
      .map(({ entry, rect }) => {
        const color = inherited ?? entryColor(entry)
        const x = rect.x + 2,
          y = rect.y + 2,
          w = Math.max(0, rect.width - 4),
          h = Math.max(0, rect.height - 4)
        const nested =
          depth < 1 &&
          h > 105 &&
          w > 150 &&
          entry.children?.some((child) => child.value > 0)
        const open = () =>
          entry.kind === "directory" ? onOpen(entry) : onSelect(entry)
        return (
          <g key={entry.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={5}
              fill={color}
              fillOpacity={entry.trashed ? 0.35 : depth ? 0.65 : 1}
              stroke="var(--background)"
              strokeWidth={2}
              role="button"
              tabIndex={0}
              aria-label={`${entry.name}, ${formatSize(entry.value)}${entry.kind === "directory" ? ", open folder" : ""}`}
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
                {entry.path ?? entry.name}
                {"\n"}
                {formatSize(entry.value)} allocated
              </title>
            </rect>
            {w > 55 && h > 23 && (
              <foreignObject
                x={x + 10}
                y={y + 7}
                width={Math.max(0, w - 20)}
                height={nested ? 27 : Math.min(h - 12, 50)}
                pointerEvents="none"
              >
                <div className={`tile-label ${nested ? "tile-parent" : ""}`}>
                  <span>{entry.name}</span>
                  <span>{formatSize(entry.value)}</span>
                </div>
              </foreignObject>
            )}
            {nested &&
              tiles(
                entry.children!,
                { x: x + 5, y: y + 38, width: w - 10, height: h - 43 },
                depth + 1,
                color
              )}
          </g>
        )
      })
  }
  return (
    <div ref={container} className="h-full min-h-0 w-full">
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
    </div>
  )
}
