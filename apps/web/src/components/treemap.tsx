import "./disk-charts.css"
import { isHoveredEntry } from "@/lib/chart-hover"
import { colorFor, isSafeTier, stateColors } from "@/lib/chart-colors"
import type { ChartColors } from "@/lib/chart-colors"
import { useLayoutEffect, useRef, useState } from "react"
import { horizontalTreemap } from "@/lib/treemap-layout"
import type { Rect } from "@/lib/treemap-layout"
import { formatSize, formatCount } from "@/lib/api"
import { tierLabel } from "@/lib/tiers"
import type { ViewEntry } from "@/lib/api"

export function Treemap({
  root,
  colors,
  dark,
  onOpen,
  onSelect,
  onHover,
  hovered = null,
  onContext,
}: {
  colors: ChartColors
  dark: boolean
  root: ViewEntry
  onOpen: (node: ViewEntry) => void
  onSelect: (node: ViewEntry) => void
  onHover: (node: ViewEntry | null) => void
  hovered?: ViewEntry | null
  onContext: (node: ViewEntry) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const measure = () => {
    const element = container.current
    if (!element) return
    const width = element.clientWidth,
      height = element.clientHeight
    setSize((previous) =>
      previous.width === width && previous.height === height
        ? previous
        : { width, height }
    )
  }
  // The first measurement can happen before the split layout settles, and
  // ResizeObserver callbacks are skipped while the page isn't rendering
  // (hidden windows, headless captures). Re-measure after every render too;
  // setSize keeps the previous object when nothing changed, so this is cheap.
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure)
    observer.observe(container.current!)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])
  const state = stateColors(dark)
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
        const safe = isSafeTier(entry.tier) && !entry.kept && !entry.trashed
        const hoveredTile = isHoveredEntry(entry, hovered)
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
              rx={4}
              fill={paint.fill}
              fillOpacity={entry.trashed ? 0.35 : 1}
              data-hovered={hoveredTile || undefined}
              data-safe={safe || undefined}
              stroke={
                hoveredTile
                  ? state.focus
                  : entry.mark === "trash"
                    ? state.trash
                    : entry.mark === "useless"
                      ? state.useless
                      : paint.stroke
              }
              strokeDasharray={entry.mark ? "4 2" : undefined}
              strokeWidth={hoveredTile ? 3 : entry.mark ? 1.5 : 1}
              role="button"
              tabIndex={0}
              aria-label={`${entry.name}, ${formatSize(entry.value, root.value)}${safe ? ", safe to remove" : ""}${entry.kind === "directory" ? ", open folder" : ""}`}
              className="map-tile"
              onClick={open}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  open()
                }
              }}
              onFocus={() => onHover(entry)}
              onBlur={() => onHover(null)}
              onMouseEnter={() => onHover(entry)}
              onMouseLeave={() => onHover(null)}
            />
            {safe && w > 14 && h > 14 && (
              <circle
                cx={x + w - 9}
                cy={y + 9}
                r={4}
                fill={state.safe}
                stroke={state.safeRing}
                strokeWidth={1.25}
                pointerEvents="none"
              >
                <title>{`Safe to remove: ${tierLabel(entry.tier)}`}</title>
              </circle>
            )}
            {w > 55 && h > 23 && (
              <foreignObject
                x={x + 10}
                y={y + 7}
                width={Math.max(0, w - (safe ? 28 : 20))}
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
    <div ref={container} className="whyfull-treemap">
      {size.width > 0 && size.height > 0 && (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-label="Horizontal treemap of allocated space"
          role="group"
        >
          {tiles(root.children ?? [], {
            x: 2,
            y: 2,
            width: size.width - 4,
            height: size.height - 4,
          })}
        </svg>
      )}
    </div>
  )
}
