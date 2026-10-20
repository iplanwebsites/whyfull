import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, parse } from "node:path"
import { volume } from "./size"
export interface ScanDrive {
  id: string
  name: string
  default: boolean
  volume: ReturnType<typeof volume>
}
export const defaultScanRoot = () =>
  process.platform === "darwin" && existsSync("/System/Volumes/Data")
    ? "/System/Volumes/Data"
    : process.platform === "win32"
      ? parse(realpathSync(homedir())).root
      : "/"
/** Inspect mount directories and device IDs only; never traverse their contents. */
export function listScanDrives(): ScanDrive[] {
  const roots = new Map<string, string>(),
    primary = defaultScanRoot()
  const add = (path: string, name: string) => {
    try {
      const resolved = realpathSync(path)
      if (statSync(resolved).isDirectory() && !roots.has(resolved))
        roots.set(resolved, name)
    } catch {}
  }
  add(primary, process.platform === "darwin" ? "Data" : primary)
  if (process.platform === "darwin") {
    try {
      for (const name of readdirSync("/Volumes")) {
        const path = join("/Volumes", name)
        try {
          if (
            !name.startsWith(".") &&
            statSync(path).dev !== statSync("/Volumes").dev
          )
            add(path, name)
        } catch {}
      }
    } catch {}
  } else if (process.platform === "win32") {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
      add(`${letter}:\\`, `${letter}:`)
  } else {
    for (const base of ["/mnt", "/media", "/run/media"])
      try {
        for (const name of readdirSync(base)) {
          const path = join(base, name)
          if (statSync(path).dev !== statSync(base).dev) add(path, name)
          else
            for (const child of readdirSync(path)) {
              const mounted = join(path, child)
              if (statSync(mounted).dev !== statSync(path).dev)
                add(mounted, child)
            }
        }
      } catch {}
  }
  return [...roots]
    .map(([id, name]) => ({
      id,
      name: name || basename(id),
      default: id === primary,
      volume: volume(id),
    }))
    .sort(
      (a, b) =>
        Number(b.default) - Number(a.default) || a.name.localeCompare(b.name)
    )
}
