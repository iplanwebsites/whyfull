/**
 * Target resolution. Logic only — data lives in targets-data.ts.
 *
 * Resolves ~ to $HOME, loads user targets, and filters by platform.
 */

import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { defaultPolicyPath } from "./disk-policy"
import { normalizePolicyPath, policyPath } from "./disk-policy"
import { knowledgeTargets, loadKnowledge } from "./knowledge"
import community from "./community-locations.json"
import { TARGETS_RAW, TIERS } from "./targets-data"
import type { Target, ResolvedTarget, Tier } from "./types"

export { TIERS } from "./targets-data"

const home = homedir()
const envFallbacks: Record<string, string> = {
  LOCALAPPDATA: join(home, "AppData", "Local"),
  APPDATA: join(home, "AppData", "Roaming"),
}

/** Repo URL for contribution callouts. */
export const REPO_URL = "https://github.com/iplanwebsites/whyfull"

/** Resolve ~ and a leading $ENV_VAR in a path. */
function resolvePath(p: string | null): string | null {
  if (p === null) return null
  if (p.startsWith("~/")) {
    return join(home, p.slice(2))
  }

  const envPath = /^\$([A-Z_][A-Z0-9_]*)(?:[\\/](.*))?$/.exec(p)
  if (envPath) {
    const [, name, rest] = envPath
    const base = process.env[name] || envFallbacks[name]
    if (!base) return null
    return rest ? join(base, rest) : base
  }

  return p
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isTier(value: unknown): value is Tier {
  return typeof value === "string" && Object.hasOwn(TIERS, value)
}

function isPathMap(value: unknown): value is Target["paths"] {
  if (!isRecord(value)) return false
  return (["darwin", "linux", "win32"] as const).every(
    (platform) =>
      Array.isArray(value[platform]) &&
      value[platform].every((path) => typeof path === "string")
  )
}

function isUserTarget(value: unknown): value is Target {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    typeof value.group === "string" &&
    value.group.length > 0 &&
    typeof value.hint === "string" &&
    value.hint.length > 0 &&
    isTier(value.tier) &&
    isPathMap(value.paths) &&
    (value.depth === undefined ||
      (typeof value.depth === "number" && value.depth >= 0)) &&
    (value.budget === undefined ||
      (typeof value.budget === "number" && value.budget >= 0)) &&
    (value.childrenDir === undefined || typeof value.childrenDir === "string")
  )
}

/** Convert raw target to resolved Target with full paths. */
function resolveTarget(raw: (typeof TARGETS_RAW)[number]): Target {
  return {
    ...raw,
    paths: {
      darwin: raw.paths.darwin.map(resolvePath),
      linux: raw.paths.linux.map(resolvePath),
      win32: raw.paths.win32.map(resolvePath),
    },
  } as Target
}

/** Built-in targets with paths resolved. */
export const TARGETS: Target[] = [
  ...TARGETS_RAW,
  ...community.targets.filter(isUserTarget),
].map(resolveTarget)

/** Load user-defined targets from ~/.config/whyfull/targets.json. */
function loadUserTargets(policyFile = defaultPolicyPath()): Target[] {
  const configPath = join(dirname(policyFile), "targets.json")
  if (!existsSync(configPath)) return []

  try {
    const raw = readFileSync(configPath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    // Accept either an array or { targets: [...] }
    const arr = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.targets)
        ? parsed.targets
        : null
    if (!Array.isArray(arr)) return []

    // Validate the whole public shape before it reaches report rendering.
    return arr.filter(isUserTarget).map((t) => ({
      ...t,
      paths: {
        darwin: (t.paths.darwin || []).map(resolvePath),
        linux: (t.paths.linux || []).map(resolvePath),
        win32: (t.paths.win32 || []).map(resolvePath),
      },
    }))
  } catch {
    // Silently skip malformed config — don't crash the scan
    return []
  }
}

/** Targets applicable to this platform, with their first existing path. */
export function forPlatform(
  platform: NodeJS.Platform = process.platform,
  policyFile?: string
): ResolvedTarget[] {
  const builtInIds = new Set(TARGETS.map((target) => target.id))
  const userTargets = loadUserTargets(policyFile).filter(
    (target) => !builtInIds.has(target.id)
  )
  const personal = knowledgeTargets(loadKnowledge(policyFile))
  const key = (path: string) => {
    const value = policyPath(normalizePolicyPath(path))
    return platform === "win32" ? value.toLowerCase() : value
  }
  const personalPaths = new Set(
    personal
      .flatMap(
        (target) => target.paths[platform as keyof typeof target.paths] ?? []
      )
      .filter((path): path is string => !!path)
      .map(key)
  )
  const allTargets = [...TARGETS, ...userTargets, ...personal]
  return allTargets
    .map((t) => ({
      ...t,
      candidates: (t.paths[platform as keyof typeof t.paths] ?? []).filter(
        (path) =>
          personalPaths.size === 0 ||
          t.id.startsWith("local:") ||
          !path ||
          !personalPaths.has(key(path))
      ),
    }))
    .filter((t) => t.candidates.filter(Boolean).length > 0)
}
