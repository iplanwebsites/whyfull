import { loadViewerFile } from "./viewer-document"
import { homedir } from "node:os"
import { defaultScanRoot } from "./drives"
import { basename } from "node:path"
import mri from "mri"
import { accessSync, constants } from "node:fs"
import { dirname, resolve } from "node:path"
import { defaultScanWorkers, scanFilesystem } from "./filesystem"
import { loadDiskPolicy, normalizePolicyPath } from "./disk-policy"
import { saveDiskSnapshot, startViewer } from "./viewer-server"
import { human } from "./size"
import type { DiskScanOptions } from "./filesystem-types"
import { diskSnapshotChunks } from "./disk-snapshot"
import { once } from "node:events"

export async function runDiskCli(argv: string[]): Promise<void> {
  try {
    let unknown: string | undefined
    const raw = mri(argv, {
      boolean: ["view", "scan", "open", "help", "json", "allow-trash"],
      string: [
        "root",
        "workers",
        "engine",
        "exclude",
        "json-file",
        "snapshot",
        "report",
        "config",
      ],
      alias: Object.fromEntries(
        [
          "view",
          "scan",
          "open",
          "help",
          "json",
          "root",
          "workers",
          "engine",
          "exclude",
          "json-file",
          "snapshot",
          "report",
          "config",
          "allow-trash",
        ].map((key) => [key, key])
      ),
      default: { open: true },
      unknown: (flag) => {
        unknown = flag
      },
    })
    const positional =
      raw.view && raw._.length === 1 ? String(raw._[0]) : undefined
    if (unknown || (raw._.length && !positional))
      throw new Error(`Unexpected argument ${unknown || raw._[0]}`)
    if (raw.help) {
      process.stdout.write(
        "npx whyfull ui [--root <directory>] [--report <file>] [--no-open]\nnpx whyfull app (alias for ui; opens your default browser)\nwhyfull --view [--root <directory>] [--workers 1..32] [--engine sync|async]\nwhyfull --scan --root <directory> --json-file <new-file>\nwhyfull --view --report <file> [--no-open] (disk snapshots or CLI JSON reports)\n--allow-trash enables native macOS Trash for live viewers; demo is always the default.\n--exclude <directory> may be repeated. --config <file> selects saved Keep/Exclude rules.\n"
      )
      return
    }
    const one = (name: string) => {
      const value = raw[name]
      if (value !== undefined && (typeof value !== "string" || !value.trim()))
        throw new Error(`--${name} requires one non-empty value`)
      return value as string | undefined
    }
    const workers = Number(one("workers") ?? defaultScanWorkers())
    if (!Number.isInteger(workers) || workers < 1 || workers > 32)
      throw new Error("--workers must be an integer from 1 to 32")
    const engine = one("engine") ?? "sync"
    if (engine !== "sync" && engine !== "async")
      throw new Error("--engine must be sync or async")
    if (raw.view && raw.scan) throw new Error("Choose --view or --scan")
    const snapshotPath = one("snapshot") ?? one("report") ?? positional
    if (positional && (one("snapshot") || one("report")))
      throw new Error("Choose one report file")
    if (one("snapshot") && one("report"))
      throw new Error("Choose --snapshot or --report")
    if (snapshotPath && !raw.view)
      throw new Error("Opening a report requires --view")
    if (
      snapshotPath &&
      ["root", "workers", "engine", "exclude", "json-file"].some(
        (k) => raw[k] !== undefined
      )
    )
      throw new Error("Snapshot viewing cannot be combined with scan options")
    const saveTo = one("json-file") ? resolve(one("json-file")!) : undefined
    if (saveTo) {
      try {
        accessSync(saveTo)
        throw new Error("Report file already exists; refusing to overwrite")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      accessSync(dirname(saveTo), constants.W_OK)
    }
    const excludes =
      raw.exclude === undefined
        ? []
        : Array.isArray(raw.exclude)
          ? raw.exclude
          : [raw.exclude]
    if (excludes.some((p: unknown) => typeof p !== "string" || !p))
      throw new Error("--exclude requires a directory")
    const policyFile = one("config") ? resolve(one("config")!) : undefined
    const root = one("root") ?? (raw.view ? homedir() : defaultScanRoot())
    const policy = loadDiskPolicy(policyFile)
    const options: DiskScanOptions = {
      root,
      workers,
      engine,
      policy: {
        keep: policy.keep,
        exclude: [...policy.exclude, ...excludes.map(normalizePolicyPath)],
      },
    }
    if (raw.view) {
      const viewer = await startViewer({
        ...options,
        policy: { keep: [], exclude: excludes.map(normalizePolicyPath) },
        policyFile,
        allowTrash: raw["allow-trash"] === true,
        open: raw.open,
        saveTo,
        ...(snapshotPath
          ? {
              ...(await loadViewerFile(snapshotPath)),
              sourceName: basename(snapshotPath),
            }
          : {}),
      })
      process.stdout.write(
        `\n  whyfull · Local disk explorer\n  ${viewer.url}\n\n  ${snapshotPath ? "Viewing saved report" : `Scanning ${viewer.snapshot.root} · ${workers} workers · ${engine}`}\n  Press Ctrl+C to stop the viewer.\n\n`
      )
      process.once("SIGINT", () => {
        void viewer.close()
      })
      process.once("SIGTERM", () => {
        void viewer.close()
      })
      return
    }
    const controller = new AbortController()
    const cancel = () => controller.abort()
    process.once("SIGINT", cancel)
    let lastLog = 0
    const snapshot = await scanFilesystem({
      ...options,
      signal: controller.signal,
      onProgress: (snapshot) => {
        if (!raw.json && Date.now() - lastLog > 2000) {
          lastLog = Date.now()
          process.stderr.write(
            `  ${human(snapshot.directories[0].bytes)} · ${snapshot.files.toLocaleString()} files · ${snapshot.directories.length.toLocaleString()} folders · ${(snapshot.durationMs / 1000).toFixed(1)}s\n`
          )
        }
      },
    })
    process.removeListener("SIGINT", cancel)
    if (saveTo) await saveDiskSnapshot(snapshot, saveTo)
    if (raw.json) {
      for (const chunk of diskSnapshotChunks(snapshot))
        if (!process.stdout.write(chunk)) await once(process.stdout, "drain")
    } else {
      process.stdout.write(
        `\n  ${snapshot.status}: ${human(snapshot.directories[0].bytes)} · ${snapshot.files.toLocaleString()} files · ${(snapshot.durationMs / 1000).toFixed(1)}s\n  ${snapshot.issues} read errors · ${snapshot.directories[0].excluded} excluded directories · ${snapshot.skippedLinks} links skipped\n`
      )
      if (saveTo) process.stdout.write(`  Saved ${saveTo}\n`)
    }
    if (snapshot.status !== "complete") process.exitCode = 1
  } catch (error) {
    process.stderr.write(
      `whyfull: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 2
  }
}
