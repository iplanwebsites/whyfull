import type { ViewEntry } from "./api"

const canonical = (path: string) =>
  path.replace(/^\/System\/Volumes\/Data(?=\/)/, "").replace(/\/$/, "")

/** Match a hovered item and its branch, including macOS Data-volume aliases. */
export function isHoveredEntry(entry: ViewEntry, hovered: ViewEntry | null) {
  if (!hovered) return false
  if (entry.id === hovered.id) return true
  if (!entry.path || !hovered.path) return false
  const path = canonical(entry.path)
  const active = canonical(hovered.path)
  return (
    path === active ||
    active.startsWith(`${path}/`) ||
    path.startsWith(`${active}/`)
  )
}
