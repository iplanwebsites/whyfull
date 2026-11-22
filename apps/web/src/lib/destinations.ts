/** Normalize the macOS Data firmlink so menu and breadcrumb visits share a view. */
export function directoryLocation(path: string | undefined, id = 0) {
  if (!path) return id
  return path.startsWith("/System/Volumes/Data/")
    ? path.slice("/System/Volumes/Data".length)
    : path
}

export function diskUsage(
  volume: { total: number; used: number } | null | undefined
) {
  if (
    !volume ||
    !Number.isFinite(volume.total) ||
    volume.total <= 0 ||
    !Number.isFinite(volume.used) ||
    volume.used < 0
  )
    return null
  const percent = Math.max(0, Math.min(100, (volume.used / volume.total) * 100))
  return { percent, label: `${Math.floor(percent)}% full`, full: percent >= 90 }
}

/** Compare scoped folders with path boundaries, including Windows and macOS aliases. */
export function isWithinDirectory(path: string, root: string) {
  const normalize = (value: string) =>
    String(directoryLocation(value)).replaceAll("\\", "/").replace(/\/$/, "")
  const location = normalize(path),
    parent = normalize(root)
  return location === parent || location.startsWith(`${parent}/`)
}
