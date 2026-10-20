import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { lstat, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { execFile } from "node:child_process"
import { pathWithin, policyPath } from "./disk-policy"
import type { DiskPolicy, DiskSnapshot } from "./filesystem-types"

export interface TrashPlan {
  id: string
  path: string
  name: string
  bytes: number
  mode: "demo" | "trash"
  expiresAt: number
}

interface PreparedPlan extends TrashPlan {
  scan: DiskSnapshot
  fingerprint?: string
}

/** No shell, recursive removal, overwrite, or delete fallback. */
export async function moveToNativeTrash(path: string): Promise<void> {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/trash"))
    throw new Error("Native Trash is available on macOS 14 or newer only")
  await new Promise<void>((resolve, reject) => {
    execFile(
      "/usr/bin/trash",
      ["-s", path],
      { timeout: 60000 },
      (error, _stdout, stderr) => {
        if (error)
          reject(
            new Error(
              stderr.trim() ||
                "The operating system could not move this item to Trash"
            )
          )
        else resolve()
      }
    )
  })
}

export class TrashController {
  private mode: "demo" | "trash" = "demo"
  private plans = new Map<string, PreparedPlan>()
  readonly moved = new Set<string>()

  constructor(
    private options: {
      snapshot: () => DiskSnapshot
      policy: () => DiskPolicy
      allowTrash?: boolean
      snapshotMode?: boolean
      executor?: (path: string) => Promise<void>
    }
  ) {}

  status() {
    const supported =
      !!this.options.executor ||
      (process.platform === "darwin" && existsSync("/usr/bin/trash"))
    return {
      mode: this.mode,
      supported,
      enabled:
        !!this.options.allowTrash && !this.options.snapshotMode && supported,
      reason: this.options.snapshotMode
        ? "Saved inventories support demos only. Start a live scan to move files to Trash."
        : !supported
          ? "Native Trash is supported on macOS 14 or newer. Demo mode is available here."
          : !this.options.allowTrash
            ? "Start whyfull --view --allow-trash to enable real Trash moves. Every session still starts in demo mode."
            : null,
    }
  }

  setMode(mode: unknown) {
    if (mode !== "demo" && mode !== "trash")
      throw new Error("Unknown cleanup mode")
    if (mode === "trash" && !this.status().enabled)
      throw new Error(this.status().reason || "Trash moves are disabled")
    if (mode === "trash" && this.options.snapshot().status === "scanning")
      throw new Error(
        "Pause or complete the scan before enabling real Trash moves"
      )
    this.mode = mode
    this.plans.clear()
    return this.status()
  }

  private item(entryId: unknown, parentId?: unknown) {
    const scan = this.options.snapshot()
    if (typeof entryId !== "string") throw new Error("Select a measured item")
    const directoryMatch = /^d(\d+)$/.exec(entryId)
    if (directoryMatch) {
      const node = scan.directories[Number(directoryMatch[1])]
      if (!node || node.parent === null)
        throw new Error("The scan root cannot be moved to Trash")
      if (node.state !== "scanned")
        throw new Error("This folder was not fully readable or is excluded")
      return { path: node.path, bytes: node.bytes }
    }
    const fileMatch = /^f(\d+)-(\d+)$/.exec(entryId)
    if (fileMatch) {
      const node = scan.directories[Number(fileMatch[1])]
      const file = node?.topFiles[Number(fileMatch[2])]
      if (!file || node.state !== "scanned")
        throw new Error("Unknown measured file")
      return { path: join(node.path, file.name), bytes: file.bytes }
    }
    if (entryId.startsWith("live-") && Number.isInteger(parentId)) {
      const node = scan.directories[Number(parentId)]
      const name = entryId.slice(5)
      if (
        !node ||
        node.state !== "scanned" ||
        !name ||
        name === "." ||
        name === ".." ||
        name !== basename(name) ||
        /[\\/\0]/.test(name)
      )
        throw new Error("Invalid direct file")
      return { path: join(node.path, name), bytes: 0 }
    }
    throw new Error("Grouped or unmeasured entries cannot be moved to Trash")
  }

  private checkPath(path: string) {
    const scan = this.options.snapshot()
    const canonical = policyPath(path)
    if (!pathWithin(path, scan.root) || path === scan.root)
      throw new Error("Item is outside the scan scope or is the scan root")
    const protectedExact = [
      "/",
      "/Users",
      "/Applications",
      "/Library",
      "/private",
      "/opt",
      "/home",
      "/var",
      "/private/var",
      "/etc",
      "/private/etc",
      homedir(),
    ]
    const protectedTrees = [
      "/System",
      "/bin",
      "/sbin",
      "/usr",
      "/private/var/db",
    ]
    if (
      protectedExact.some((p) => canonical === policyPath(p)) ||
      protectedTrees.some((p) => pathWithin(canonical, p))
    )
      throw new Error("This system or home location is protected")
    const policy = this.options.policy()
    if (
      [...policy.keep, ...policy.exclude].some(
        (p) =>
          pathWithin(canonical, policyPath(p)) ||
          pathWithin(policyPath(p), canonical)
      )
    )
      throw new Error(
        "This item contains or belongs to a kept or excluded location"
      )
    if ([...this.moved].some((p) => pathWithin(path, p)))
      throw new Error(
        "This item was already moved to Trash; rescan to refresh the inventory"
      )
  }

  private async fingerprint(path: string) {
    if ((await realpath(path)) !== path)
      throw new Error(
        "This path now contains a symlink; rescan before continuing"
      )
    const st = await lstat(path)
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()))
      throw new Error("Only regular files and folders can be moved to Trash")
    return `${st.dev}:${st.ino}:${st.mtimeMs}:${st.size}`
  }

  async prepare(entryId: unknown, parentId?: unknown): Promise<TrashPlan> {
    const scan = this.options.snapshot()
    if (this.mode === "trash" && scan.status === "scanning")
      throw new Error("Pause or complete the scan before moving files")
    const item = this.item(entryId, parentId)
    this.checkPath(item.path)
    const fingerprint =
      this.mode === "trash" ? await this.fingerprint(item.path) : undefined
    for (const [id, plan] of this.plans)
      if (plan.expiresAt < Date.now()) this.plans.delete(id)
    if (this.plans.size >= 100) throw new Error("Too many pending previews")
    const plan: PreparedPlan = {
      ...item,
      name: basename(item.path),
      id: randomBytes(24).toString("hex"),
      mode: this.mode,
      expiresAt: Date.now() + 60000,
      scan,
      fingerprint,
    }
    this.plans.set(plan.id, plan)
    const { scan: _scan, fingerprint: _fingerprint, ...publicPlan } = plan
    return publicPlan
  }

  async execute(id: unknown) {
    const plan = typeof id === "string" ? this.plans.get(id) : undefined
    if (!plan) throw new Error("Preview is missing or already used")
    this.plans.delete(plan.id)
    if (
      plan.expiresAt < Date.now() ||
      plan.scan !== this.options.snapshot() ||
      plan.mode !== this.mode
    )
      throw new Error("The inventory or mode changed. Create a new preview.")
    this.checkPath(plan.path)
    if (plan.mode === "demo")
      return {
        mode: "demo",
        path: plan.path,
        moved: false,
        message: "Demo complete. No files were changed.",
      }
    if (!this.status().enabled || this.options.snapshot().status === "scanning")
      throw new Error("Real Trash moves are disabled while scanning")
    if ((await this.fingerprint(plan.path)) !== plan.fingerprint)
      throw new Error(
        "The item changed since the preview. Create a new preview."
      )
    await (this.options.executor ?? moveToNativeTrash)(plan.path)
    this.moved.add(plan.path)
    return {
      mode: "trash",
      path: plan.path,
      moved: true,
      message:
        "Moved to Trash. Restore it in Finder if needed. Rescan to refresh sizes.",
    }
  }
}
