import { stat, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { defaultPolicyPath } from "./disk-policy"
import {
  loadInventoryCache,
  saveInventoryCache,
  inventoryCachePath,
} from "./sqlite-inventory"
import type { DiskScanOptions, DiskSnapshot } from "./filesystem-types"

/** Completed, engine-specific SQLite snapshots. Partial work never replaces one. */
export class ScanCache {
  constructor(
    readonly directory: string,
    private options: { enabled?: boolean } = {}
  ) {}
  static forDirectory(root: string, enabled = true) {
    return new ScanCache(join(root, ".whyfull"), { enabled })
  }
  static forConfig(policyFile = defaultPolicyPath(), enabled = true) {
    return new ScanCache(join(dirname(policyFile), "scans"), { enabled })
  }
  path(root: string, scanner: "node" | "rust" = "node") {
    return inventoryCachePath(this.directory, root, scanner)
  }
  async latestRoot(): Promise<string | null> {
    if (this.options.enabled === false) return null
    try {
      const value = JSON.parse(
        await readFile(join(this.directory, "latest.json"), "utf8")
      ) as { root?: unknown }
      if (
        typeof value.root !== "string" ||
        !(await stat(value.root)).isDirectory()
      )
        return null
      return value.root
    } catch {
      return null
    }
  }
  async load(root: string, options: DiskScanOptions) {
    return this.options.enabled === false
      ? null
      : loadInventoryCache(this.directory, root, options)
  }
  async save(snapshot: DiskSnapshot, _options: DiskScanOptions) {
    return this.options.enabled === false || snapshot.status !== "complete"
      ? null
      : saveInventoryCache(this.directory, snapshot)
  }
}
