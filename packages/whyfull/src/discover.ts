/**
 * Discovery mode: find large directories outside the known target set.
 *
 * This scans common locations (Desktop, Downloads, Documents, Applications,
 * Library/Application Support) for directories over a size threshold that
 * aren't already tracked by TARGETS. With --drill, it also reports the
 * largest entries inside each discovered directory.
 *
 * Useful for finding unexpected hogs like:
 * - Native Instruments sample libraries (10s of GB)
 * - Music production plugins and samples
 * - Game assets and mods
 * - Forgotten media collections
 */

import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, sep } from "node:path"
import { measure } from "./size"
import { forPlatform } from "./targets"
import type {
  DiscoveredDir,
  DiscoveredChild,
  DiscoverRoot,
  DiscoverOptions,
  DiscoverResult,
} from "./types"

const home = homedir()

/** Directories to scan for unexpected hogs. Shallow: only immediate children. */
const DISCOVERY_ROOTS: Record<string, DiscoverRoot[]> = {
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

/** Cache roots are cheap enough to scan on every run. */
const CACHE_ROOTS: Record<string, DiscoverRoot[]> = {
  darwin: [
    { path: `${home}/Library/Caches`, label: "Library cache" },
    { path: `${home}/.cache`, label: "User cache" },
  ],
  linux: [{ path: `${home}/.cache`, label: "User cache" }],
  // AppData/Local is mixed data, not a cache. Temp is the safe generic root.
  win32: [
    { path: `${home}/AppData/Local/Temp`, label: "Local temporary cache" },
  ],
}

/** Common parents of source checkouts; walked only three levels deep. */
const PROJECT_ROOTS: Record<string, DiscoverRoot[]> = {
  darwin: [
    { path: `${home}/web/git`, label: "Project cache" },
    { path: `${home}/Developer`, label: "Project cache" },
    { path: `${home}/Projects`, label: "Project cache" },
    { path: `${home}/src`, label: "Project cache" },
    { path: `${home}/code`, label: "Project cache" },
    { path: `${home}/repos`, label: "Project cache" },
  ],
  linux: [
    { path: `${home}/web/git`, label: "Project cache" },
    { path: `${home}/Developer`, label: "Project cache" },
    { path: `${home}/Projects`, label: "Project cache" },
    { path: `${home}/src`, label: "Project cache" },
    { path: `${home}/code`, label: "Project cache" },
    { path: `${home}/repos`, label: "Project cache" },
  ],
  win32: [
    { path: `${home}/source/repos`, label: "Project cache" },
    { path: `${home}/Projects`, label: "Project cache" },
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

/** Get largest immediate entries of a directory. */
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
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    const { bytes } = measure(full, { seen: new Set(), budget })
    if (bytes < 100e6) continue // skip children under 100 MB
    out.push({ name: entry.name, path: full, bytes })
  }

  return out.sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}

/**
 * Scan discovery roots for large entries not already known.
 * Returns entries over threshold, sorted by size descending.
 */
function scanRoots(
  opts: DiscoverOptions,
  defaults: Record<string, DiscoverRoot[]>,
  defaultThreshold: number
): DiscoverResult {
  const {
    platform = process.platform,
    roots = defaults[platform] || [],
    threshold = defaultThreshold,
    maxResults = 20,
    drill = 3, // top N children to show per discovered dir
    onProgress = null,
  } = opts

  const knownPaths = forPlatform(platform)
    .flatMap((t) => t.candidates)
    .filter(Boolean)
    .map((p) => p!.toLowerCase())

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
      if (entry.isSymbolicLink()) continue
      if (entry.name.startsWith(".") && entry.name !== ".Trash") continue
      if (IGNORE_NAMES.has(entry.name)) continue

      const full = join(root.path, entry.name)
      const normalized = full.toLowerCase()
      // Skip exact known targets and wrapper directories whose only large
      // child is already known (for example ~/.cache/node/corepack).
      if (
        knownPaths.some(
          (known) =>
            known === normalized || known.startsWith(`${normalized}${sep}`)
        )
      )
        continue

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

/** Find project-local .cache directories without crawling source trees. */
function projectCacheRoots(roots: DiscoverRoot[]): DiscoverRoot[] {
  const found = new Map<string, DiscoverRoot>()
  const skip = new Set(["node_modules", ".git", "vendor", "dist", "build"])
  let visited = 0

  for (const root of roots) {
    if (!existsSync(root.path)) continue
    const stack = [{ dir: root.path, depth: 0 }]
    while (stack.length > 0 && visited < 20000) {
      const { dir, depth } = stack.pop()!
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      visited += 1

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const full = join(dir, entry.name)
        if (entry.name === ".cache") {
          const project = basename(dirname(full))
          found.set(full, {
            path: full,
            label: `${root.label} (${project})`,
          })
          continue
        }
        if (depth >= 2 || entry.name.startsWith(".") || skip.has(entry.name)) {
          continue
        }
        stack.push({ dir: full, depth: depth + 1 })
      }
    }
  }

  return [...found.values()]
}

/** Scan broad user/data roots when explicitly requested with --discover. */
export function discover(opts: DiscoverOptions = {}): DiscoverResult {
  return scanRoots(opts, DISCOVERY_ROOTS, 5e9)
}

/** Find large, untracked top-level cache directories. Enabled by default. */
export function discoverCaches(opts: DiscoverOptions = {}): DiscoverResult {
  const platform = opts.platform ?? process.platform
  const ordinary = scanRoots(opts, CACHE_ROOTS, 250e6)
  const bases =
    opts.projectRoots ??
    (opts.roots === undefined ? PROJECT_ROOTS[platform] : [])
  if (!bases || bases.length === 0) return ordinary

  const project = scanRoots(
    { ...opts, roots: projectCacheRoots(bases) },
    {},
    250e6
  )
  const maxResults = opts.maxResults ?? 20
  return {
    dirs: [...ordinary.dirs, ...project.dirs]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, maxResults),
    threshold: ordinary.threshold,
  }
}
