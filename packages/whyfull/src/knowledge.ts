/** Private, declarative scan knowledge. Instructions are text, never commands. */
import { createHash, randomUUID } from "node:crypto"
import { hostname, homedir } from "node:os"
import { dirname, join, resolve, posix, win32 } from "node:path"
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { defaultPolicyPath } from "./disk-policy"
import type { Target } from "./types"
import type {
  KnowledgeLayer,
  KnowledgeScope,
  KnowledgeView,
  SavedLocation,
  LocalContext,
} from "./knowledge-types"

interface KnowledgeFile {
  schemaVersion: 1
  revision: number
  user: KnowledgeLayer
  computers: Record<string, KnowledgeLayer>
}
const emptyLayer = (): KnowledgeLayer => ({ instructions: "", locations: [] })
const machineKey = () =>
  createHash("sha256")
    .update(process.env.WHYFULL_MACHINE_ID || hostname())
    .digest("hex")
    .slice(0, 24)
export const knowledgePath = (policyFile = defaultPolicyPath()) =>
  join(dirname(policyFile), "knowledge.json")

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a knowledge object")
  return value as Record<string, unknown>
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`Unknown knowledge field: ${key}`)
}
function text(
  value: unknown,
  name: string,
  max: number,
  required = false
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ||
    (required && !value.trim())
  )
    throw new Error(`Invalid ${name}`)
  return value
}
function location(value: unknown): SavedLocation {
  const raw = record(value)
  fields(raw, [
    "id",
    "name",
    "path",
    "kind",
    "tier",
    "instructions",
    "enabled",
    "source",
    "platform",
    "updatedAt",
  ])
  const id = text(raw.id, "location ID", 80, true)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error(
      "Location ID must use lowercase letters, numbers, and hyphens"
    )
  const path = text(raw.path, "location path", 4096, true)
  if (
    (!(raw.platform === "win32" ? win32 : posix).isAbsolute(path) &&
      path !== "~" &&
      !path.startsWith("~/")) ||
    /[\r\n\t]/.test(path)
  )
    throw new Error("Use an absolute location path or ~/path")
  const name = text(raw.name, "location name", 160, true)
  if (/[\r\n\t]/.test(name))
    throw new Error("Location names must be a single line")
  if (!["folder", "project", "cache", "data"].includes(String(raw.kind)))
    throw new Error("Invalid location kind")
  if (
    !["AUTO", "REBUILD", "JUDGEMENT", "APP", "DATA"].includes(String(raw.tier))
  )
    throw new Error("Invalid safety tier")
  if (typeof raw.enabled !== "boolean") throw new Error("Invalid enabled state")
  if (raw.source !== "user" && raw.source !== "agent")
    throw new Error("Invalid location source")
  if (!["darwin", "linux", "win32"].includes(String(raw.platform)))
    throw new Error("Invalid location platform")
  if (
    typeof raw.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.updatedAt))
  )
    throw new Error("Invalid update date")
  return {
    ...raw,
    name,
    path,
    instructions: text(raw.instructions, "location instructions", 12000),
  } as unknown as SavedLocation
}
function layer(value: unknown): KnowledgeLayer {
  const raw = record(value)
  fields(raw, ["instructions", "locations"])
  if (!Array.isArray(raw.locations) || raw.locations.length > 500)
    throw new Error("A knowledge scope supports up to 500 locations")
  const locations = raw.locations.map(location)
  if (new Set(locations.map((item) => item.id)).size !== locations.length)
    throw new Error("Duplicate location IDs in knowledge scope")
  return {
    instructions: text(raw.instructions, "instructions", 24000),
    locations,
  }
}
function readKnowledge(file: string): KnowledgeFile {
  try {
    if (statSync(file).size > 2 * 1024 ** 2)
      throw new Error("Knowledge file is too large (maximum 2 MiB)")
    const raw = record(JSON.parse(readFileSync(file, "utf8")))
    fields(raw, ["schemaVersion", "revision", "user", "computers"])
    if (raw.schemaVersion !== 1)
      throw new Error("Unsupported knowledge schema version")
    if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)
      throw new Error("Invalid knowledge revision")
    const computers = record(raw.computers)
    if (Object.keys(computers).length > 100)
      throw new Error("Too many computer profiles")
    return {
      schemaVersion: 1,
      revision: Number(raw.revision),
      user: layer(raw.user),
      computers: Object.fromEntries(
        Object.entries(computers).map(([key, value]) => {
          if (!/^[a-f0-9]{24}$/.test(key))
            throw new Error("Invalid computer profile ID")
          return [key, layer(value)]
        })
      ),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        schemaVersion: 1,
        revision: 0,
        user: emptyLayer(),
        computers: {},
      }
    throw error
  }
}
export function resolveLocationPath(path: string): string {
  return resolve(
    path === "~"
      ? homedir()
      : path.startsWith("~/")
        ? join(homedir(), path.slice(2))
        : path
  )
}
function view(data: KnowledgeFile, file: string): KnowledgeView {
  const computerSettings = data.computers[machineKey()] ?? emptyLayer()
  const merged = new Map<
    string,
    SavedLocation & { scope: KnowledgeScope; resolvedPath: string }
  >()
  for (const [scope, settings] of [
    ["user", data.user],
    ["computer", computerSettings],
  ] as const) {
    for (const item of settings.locations.filter(
      (item) => item.platform === process.platform
    ))
      merged.set(item.id, {
        ...item,
        scope,
        resolvedPath: resolveLocationPath(item.path),
      })
  }
  return {
    schemaVersion: 1,
    revision: data.revision,
    file,
    computer: hostname(),
    user: data.user,
    computerSettings,
    locations: [...merged.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  }
}
export function loadKnowledge(policyFile?: string): KnowledgeView {
  const file = knowledgePath(policyFile)
  return view(readKnowledge(file), file)
}
export function knowledgeContext(knowledge: KnowledgeView): LocalContext {
  return {
    userInstructions: knowledge.user.instructions,
    computerInstructions: knowledge.computerSettings.instructions,
  }
}

/** Small atomic edits, with a lock and optional optimistic revision for agents/UI. */
export function updateKnowledge(
  input: unknown,
  policyFile?: string
): KnowledgeView {
  const raw = record(input)
  fields(raw, [
    "action",
    "scope",
    "revision",
    ...(raw.action === "save-location"
      ? ["location", "createOnly"]
      : raw.action === "remove-location"
        ? ["id"]
        : raw.action === "instructions"
          ? ["instructions"]
          : []),
  ])
  if (raw.scope !== "user" && raw.scope !== "computer")
    throw new Error("Choose user or computer scope")
  if (raw.createOnly !== undefined && typeof raw.createOnly !== "boolean")
    throw new Error("Invalid create-only state")
  if (
    raw.revision !== undefined &&
    (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)
  )
    throw new Error("Invalid knowledge revision")
  const file = knowledgePath(policyFile)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const lock = `${file}.lock`
  let fd: number
  try {
    fd = openSync(lock, "wx", 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Knowledge is being updated. Retry after the other writer finishes; a stale knowledge.json.lock can be removed after that process exits."
      )
    throw error
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const data = readKnowledge(file)
    if (raw.revision !== undefined && raw.revision !== data.revision)
      throw new Error(
        "Knowledge changed elsewhere. Refresh before saving your edit."
      )
    const settings =
      raw.scope === "user"
        ? data.user
        : (data.computers[machineKey()] ??= emptyLayer())
    if (raw.action === "save-location") {
      const entry = record(raw.location)
      const existing = settings.locations.find((item) => item.id === entry.id)
      if (raw.createOnly && existing)
        throw new Error(
          "A place with this ID already exists in this scope. Choose another ID or edit the saved place."
        )
      const next = location({
        kind: "folder",
        tier: "DATA",
        instructions: "",
        enabled: true,
        source: "user",
        platform: process.platform,
        ...existing,
        ...entry,
        updatedAt: new Date().toISOString(),
      })
      settings.locations = [
        ...settings.locations.filter((item) => item.id !== next.id),
        next,
      ]
    } else if (raw.action === "remove-location") {
      if (!settings.locations.some((item) => item.id === raw.id))
        throw new Error("Location not found in this scope")
      settings.locations = settings.locations.filter(
        (item) => item.id !== raw.id
      )
    } else if (raw.action === "instructions") {
      settings.instructions = text(raw.instructions, "instructions", 24000)
    } else throw new Error("Unknown knowledge action")
    layer(settings)
    if (Object.keys(data.computers).length > 100)
      throw new Error("Too many computer profiles")
    if (data.revision === Number.MAX_SAFE_INTEGER)
      throw new Error("Knowledge revision limit reached")
    data.revision++
    const contents = JSON.stringify(data, null, 2) + "\n"
    if (Buffer.byteLength(contents) > 2 * 1024 ** 2)
      throw new Error("Knowledge file is too large (maximum 2 MiB)")
    writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" })
    renameSync(temporary, file)
    return view(data, file)
  } finally {
    closeSync(fd)
    for (const path of [temporary, lock])
      try {
        unlinkSync(path)
      } catch {
        /* already renamed or removed */
      }
  }
}

export function knowledgeTargets(knowledge: KnowledgeView): Target[] {
  return knowledge.locations
    .filter((item) => item.enabled)
    .map((item) => ({
      id: `local:${item.id}`,
      label: item.name,
      group: `Your locations · ${item.kind}`,
      tier: item.tier,
      hint:
        item.instructions ||
        "Personal location. Inspect its contents and confirm what can be regenerated before cleanup.",
      paths: {
        darwin: [],
        linux: [],
        win32: [],
        [item.platform]: [item.resolvedPath],
      },
      budget: 30000,
    }))
}

/** Public contributions deliberately require fresh text; never export private notes. */
export function locationProposal(input: unknown, policyFile?: string) {
  const raw = record(input)
  fields(raw, ["id", "publicId", "name", "path", "hint"])
  const item = loadKnowledge(policyFile).locations.find(
    (item) => item.id === raw.id
  )
  if (!item) throw new Error("Choose a saved location to contribute")
  const publicId = text(raw.publicId ?? item.id, "public ID", 80, true)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(publicId))
    throw new Error(
      "Public ID must use lowercase letters, numbers, and hyphens"
    )
  const path = text(raw.path, "public path template", 1024, true)
  if (
    !/^(~\/|\$[A-Z_][A-Z0-9_]*\/)/.test(path) ||
    path.split(/[\\/]/).some((part) => part === "..") ||
    /[\r\n\t]/.test(path)
  )
    throw new Error(
      "Public paths must start with ~/ or $ENV_VAR/ and cannot contain parent traversal"
    )
  const name = text(raw.name, "public name", 160, true)
  const hint = text(raw.hint, "public cleanup guidance", 4000, true)
  return {
    targets: [
      {
        id: publicId,
        label: name,
        group: "Community",
        tier: "JUDGEMENT",
        hint,
        paths: { darwin: [], linux: [], win32: [], [item.platform]: [path] },
      },
    ],
  }
}
