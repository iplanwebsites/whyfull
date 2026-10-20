import { homedir } from "node:os"
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path"
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import type { DiskPolicy } from "./filesystem-types"

export const defaultPolicyPath = () =>
  join(homedir(), ".config", "whyfull", "config.json")

export function normalizePolicyPath(path: string): string {
  const expanded = resolve(
    path === "~"
      ? homedir()
      : path.startsWith("~/")
        ? join(homedir(), path.slice(2))
        : path
  )
  try {
    return realpathSync(expanded)
  } catch {
    return expanded
  }
}

/** The data volume also exposes user paths through macOS firmlinks. */
export function policyPath(path: string): string {
  return process.platform === "darwin" &&
    path.startsWith("/System/Volumes/Data/")
    ? path.slice("/System/Volumes/Data".length)
    : path
}

/** Directory-boundary matching: /foo never matches /foobar. */
export function pathWithin(path: string, parent: string): boolean {
  const root = normalize(parent)
  return (
    path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
  )
}

function validate(value: unknown): DiskPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid whyfull configuration")
  const raw = value as Record<string, unknown>
  const read = (key: string) => {
    const values = raw[key] ?? []
    if (
      !Array.isArray(values) ||
      values.length > 10000 ||
      values.some(
        (p) =>
          typeof p !== "string" ||
          !p ||
          p.includes("\0") ||
          (!isAbsolute(p) && p !== "~" && !p.startsWith("~/"))
      )
    )
      throw new Error(`Invalid ${key} paths in whyfull configuration`)
    return [...new Set(values.map((p) => normalizePolicyPath(p as string)))]
  }
  return { keep: read("keep"), exclude: read("exclude") }
}

export function loadDiskPolicy(path = defaultPolicyPath()): DiskPolicy {
  try {
    return validate(JSON.parse(readFileSync(path, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { keep: [], exclude: [] }
    throw error
  }
}

export function saveDiskPolicy(
  policy: DiskPolicy,
  path = defaultPolicyPath()
): void {
  const next = validate(policy)
  updateConfig({ ...next }, path)
}

function updateConfig(next: Record<string, unknown>, path: string): void {
  // Preserve unrelated configuration keys and never replace malformed settings.
  let existing = {}
  try {
    existing = JSON.parse(readFileSync(path, "utf8"))
    validate(existing)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ ...existing, ...next }, null, 2) + "\n",
      { mode: 0o600, flag: "wx" }
    )
    renameSync(temporary, path)
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      /* renamed */
    }
  }
}

export interface ViewerPreferences {
  view: "treemap" | "sunburst"
  sort: "size" | "name"
  theme: "light" | "dark" | "system"
  lastPath: string | null
  sidebarOpen: boolean
}

export function loadViewerPreferences(
  path = defaultPolicyPath()
): ViewerPreferences {
  let value: Record<string, unknown> = {}
  try {
    const config = JSON.parse(readFileSync(path, "utf8"))
    validate(config)
    value =
      config.viewer &&
      typeof config.viewer === "object" &&
      !Array.isArray(config.viewer)
        ? config.viewer
        : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return {
    view: value.view === "sunburst" ? "sunburst" : "treemap",
    sort: value.sort === "name" ? "name" : "size",
    theme:
      value.theme === "dark" || value.theme === "system"
        ? value.theme
        : "light",
    lastPath: typeof value.lastPath === "string" ? value.lastPath : null,
    sidebarOpen: value.sidebarOpen !== false,
  }
}

export function saveViewerPreferences(
  patch: Record<string, unknown>,
  path = defaultPolicyPath()
): ViewerPreferences {
  const next = loadViewerPreferences(path)
  if (patch.view !== undefined) {
    if (patch.view !== "sunburst" && patch.view !== "treemap")
      throw new Error("Invalid map view")
    next.view = patch.view
  }
  if (patch.sort !== undefined) {
    if (patch.sort !== "name" && patch.sort !== "size")
      throw new Error("Invalid sort order")
    next.sort = patch.sort
  }
  if (patch.theme !== undefined) {
    if (!["light", "dark", "system"].includes(String(patch.theme)))
      throw new Error("Invalid theme")
    next.theme = patch.theme as ViewerPreferences["theme"]
  }
  if (patch.lastPath !== undefined) {
    if (
      patch.lastPath !== null &&
      (typeof patch.lastPath !== "string" ||
        patch.lastPath.length > 8192 ||
        !isAbsolute(patch.lastPath) ||
        patch.lastPath.includes("\0"))
    )
      throw new Error("Invalid saved folder")
    next.lastPath = patch.lastPath as string | null
  }
  if (patch.sidebarOpen !== undefined) {
    if (typeof patch.sidebarOpen !== "boolean")
      throw new Error("Invalid sidebar state")
    next.sidebarOpen = patch.sidebarOpen
  }
  updateConfig({ viewer: next }, path)
  return next
}
