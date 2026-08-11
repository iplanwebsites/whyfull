/**
 * Discovery mode: find large directories outside the known target set.
 *
 * This scans common locations (Desktop, Downloads, Documents, Applications,
 * Library/Application Support) for directories over a size threshold that
 * aren't already tracked by TARGETS. With --drill, it also reports the
 * largest children inside each discovered directory.
 *
 * Useful for finding unexpected hogs like:
 * - Native Instruments sample libraries (10s of GB)
 * - Music production plugins and samples
 * - Game assets and mods
 * - Forgotten media collections
 */

import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { measure } from "./size"
import { forPlatform } from "./targets"
import type {
  DiscoveredDir,
  DiscoveredChild,
  DiscoverOptions,
  DiscoverResult,
} from "./types"

const home = homedir()

/** Directories to scan for unexpected hogs. Shallow: only immediate children. */
const DISCOVERY_ROOTS: Record<
  string,
  Array<{ path: string; label: string }>
> = {
  darwin: [
    { path: `${home}/Desktop`, label: "Desktop" },
    { path: `${home}/Downloads`, label: "Downloads" },
    { path: `${home}/Documents`, label: "Documents" },
    { path: `${home}/Music`, label: "Music folder" },
    { path: `${home}/Library/Application Support`, label: "App Support" },
    { path: "/Applications", label: "Applications" },
  ],
  linux: [
    { path: `${home}/Desktop`, label: "Desktop" },
    { path: `${home}/Downloads`, label: "Downloads" },
    { path: `${home}/Documents`, label: "Documents" },
    { path: `${home}/Music`, label: "Music folder" },
    { path: `${home}/.local/share`, label: "Local data" },
  ],
  win32: [
    { path: `${home}/Desktop`, label: "Desktop" },
    { path: `${home}/Downloads`, label: "Downloads" },
    { path: `${home}/Documents`, label: "Documents" },
    { path: `${home}/Music`, label: "Music folder" },
    { path: `${home}/AppData/Local`, label: "AppData Local" },
    { path: `${home}/AppData/Roaming`, label: "AppData Roaming" },
  ],
}

/** Well-known directories that are expected to be large — not worth flagging. */
const IGNORE_NAMES = new Set([
  // macOS
  "Photos Library.photoslibrary",
  "iCloud Drive",
  "GarageBand",
  "Logic",
  // Common
  "node_modules",
  ".git",
  // Already tracked in targets (partial list — forPlatform() also filters)
  "huggingface",
  "Docker",
  "com.docker.docker",
  "Spotify",
  "Code",
  "Claude",
  "Google",
  "pip",
  "pnpm",
  "npm",
  "yarn",
  "Homebrew",
  "electron",
  "ms-playwright",
  "puppeteer",
])

/** Get largest immediate children of a directory. */
function topChildren(
  dir: string,
  limit: number,
  budget: number
): DiscoveredChild[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const out: DiscoveredChild[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    const { bytes } = measure(full, { seen: new Set(), budget })
    if (bytes < 100e6) continue // skip children under 100 MB
    out.push({ name: entry.name, path: full, bytes })
  }

  return out.sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}

/**
 * Scan discovery roots for large directories not already known.
 * Returns directories over threshold, sorted by size descending.
 */
export function discover(opts: DiscoverOptions = {}): DiscoverResult {
  const {
    platform = process.platform,
    threshold = 5e9, // 5 GB default
    maxResults = 20,
    drill = 3, // top N children to show per discovered dir
    onProgress = null,
  } = opts

  const roots = DISCOVERY_ROOTS[platform] || []
  const knownPaths = new Set(
    forPlatform(platform)
      .flatMap((t) => t.candidates)
      .filter(Boolean)
      .map((p) => p!.toLowerCase())
  )

  const found: DiscoveredDir[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    if (!existsSync(root.path)) continue

    let entries
    try {
      entries = readdirSync(root.path, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (entry.name.startsWith(".") && entry.name !== ".Trash") continue
      if (IGNORE_NAMES.has(entry.name)) continue

      const full = join(root.path, entry.name)
      if (knownPaths.has(full.toLowerCase())) continue

      if (onProgress) onProgress(entry.name)

      // Confirm the entry is still readable before starting a measured walk.
      try {
        statSync(full)
      } catch {
        continue
      }

      // Measure with a budget to keep it fast
      const { bytes } = measure(full, { seen, budget: 50000 })
      if (bytes < threshold) continue

      // Drill into children for more detail
      const children = drill > 0 ? topChildren(full, drill, 20000) : []

      found.push({
        name: entry.name,
        path: full,
        bytes,
        root: root.label,
        children,
      })
    }
  }

  return {
    dirs: found.sort((a, b) => b.bytes - a.bytes).slice(0, maxResults),
    threshold,
  }
}
