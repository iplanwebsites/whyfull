import { loadViewerFile } from "./viewer-document"
import { homedir } from "node:os"
import { defaultScanRoot } from "./drives"
import { basename } from "node:path"
import mri from "mri"
import { accessSync, constants } from "node:fs"
import { dirname, resolve } from "node:path"
import { defaultScanWorkers, scanFilesystem } from "./filesystem"
import {
  defaultPolicyPath,
  loadDiskPolicy,
  normalizePolicyPath,
} from "./disk-policy"
import { saveDiskSnapshot, startViewer } from "./viewer-server"
import { human } from "./size"
import type { DiskScanOptions, DiskSnapshot } from "./filesystem-types"
import { diskSnapshotChunks } from "./disk-snapshot"
import { once } from "node:events"
import { ScanCache } from "./scan-cache"
import { sqliteInventory, inventoryWorkingDirectory } from "./sqlite-inventory"

export async function runDiskCli(argv: string[]): Promise<void> {
  let nativeResult: DiskSnapshot | undefined
  try {
    // Canonicalize the alias so mixed/repeated flags share validation.
    argv = argv.map((arg) => arg.replace(/^--dir(?==|$)/, "--directory"))
    // This is the only optional-value flag: a bare --directory means cwd.
    argv = argv.flatMap((arg, index) =>
      arg === "--directory" &&
      (!argv[index + 1] || argv[index + 1].startsWith("-"))
        ? [arg, process.cwd()]
        : [arg]
    )
    let unknown: string | undefined
    const raw = mri(argv, {
      boolean: [
        "view",
        "tui",
        "scan",
        "open",
        "help",
        "json",
        "cache",
        "allow-trash",
      ],
      string: [
        "root",
        "directory",
        "workers",
        "engine",
        "scanner",
        "exclude",
        "json-file",
        "snapshot",
        "report",
        "config",
      ],
      alias: Object.fromEntries(
        [
          "view",
          "tui",
          "scan",
          "open",
          "help",
          "json",
          "cache",
          "root",
          "directory",
          "workers",
          "engine",
          "scanner",
          "exclude",
          "json-file",
          "snapshot",
          "report",
          "config",
          "allow-trash",
        ].map((key) => [key, key])
      ),
      default: { open: true, cache: true },
      unknown: (flag) => {
        unknown = flag
      },
    })
    const directoryMode = raw.directory !== undefined
    if (
      directoryMode &&
      !raw.view &&
      raw.scan !== true &&
      !raw.tui &&
      !raw.json &&
      raw["json-file"] === undefined
    )
      raw.view = true
    const positional =
      raw.view && raw._.length === 1 ? String(raw._[0]) : undefined
    if (unknown || (raw._.length && !positional))
      throw new Error(`Unexpected argument ${unknown || raw._[0]}`)
    if (raw.help) {
      process.stdout.write(
        "npx whyfull --ui [--root <directory>] [--no-open] [--no-scan] [--workers 1..32] [--engine sync|async] [--scanner node|rust]\nnpx whyfull --scan --root <directory> --json-file <new-file>\nnpx whyfull --ui --report <file> [--no-open] (disk snapshots or CLI JSON reports)\naliases for --ui: --view, ui, app\nwhyfull --directory [path] [--ui | --tui | --scan | --json | --json-file <new-file>]\n--dir [path] is an alias for --directory [path].\n--directory defaults to cwd, opens the UI by default, and caches scans in <path>/.whyfull/inventories/.\nBoth scanners use SQLite and require Node 22.18+. Rust is experimental and requires a bundled helper. Node remains the default.\nCompleted --scan inventories share the UI cache; --ui opens the latest scanned root.\n--no-cache skips loading and saving persistent scan caches; explicit JSON exports still work.\n--allow-trash enables native macOS Trash for live viewers; demo is always the default.\n--exclude <directory> may be repeated. --config <file> selects saved Keep/Exclude rules.\n"
      )
      return
    }
    const one = (name: string) => {
      const value = raw[name]
      if (value !== undefined && (typeof value !== "string" || !value.trim()))
        throw new Error(`--${name} requires one non-empty value`)
      return value as string | undefined
    }
    if (directoryMode && one("root"))
      throw new Error("Choose --directory or --root")
    const directory = one("directory")
    const workers = Number(one("workers") ?? defaultScanWorkers())
    if (!Number.isInteger(workers) || workers < 1 || workers > 32)
      throw new Error("--workers must be an integer from 1 to 32")
    const engine = one("engine") ?? "sync"
    if (engine !== "sync" && engine !== "async")
      throw new Error("--engine must be sync or async")
    const scanner = one("scanner")
    if (scanner !== undefined && scanner !== "node" && scanner !== "rust")
      throw new Error("--scanner must be node or rust")
    if (raw.view && raw.scan === true) throw new Error("Choose --ui or --scan")
    const snapshotPath = one("snapshot") ?? one("report") ?? positional
    if (positional && (one("snapshot") || one("report")))
      throw new Error("Choose one report file")
    if (one("snapshot") && one("report"))
      throw new Error("Choose --snapshot or --report")
    if (snapshotPath && !raw.view)
      throw new Error("Opening a report requires --ui")
    if (
      snapshotPath &&
      [
        "root",
        "directory",
        "workers",
        "engine",
        "scanner",
        "exclude",
        "json-file",
      ].some((k) => raw[k] !== undefined)
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
    const policyFileForCache = policyFile ?? defaultPolicyPath()
    const sharedCache = ScanCache.forConfig(policyFileForCache, raw.cache)
    const latestRoot =
      raw.view && !directory && !one("root")
        ? await sharedCache.latestRoot()
        : null
    const root =
      directory ??
      one("root") ??
      latestRoot ??
      (raw.view ? homedir() : defaultScanRoot())
    const policy = loadDiskPolicy(policyFile)
    const options: DiskScanOptions = {
      root,
      workers: one("workers") ? workers : undefined,
      engine,
      scanner: scanner as "node" | "rust" | undefined,
      inventoryDirectory: inventoryWorkingDirectory(policyFileForCache),
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
        scanOnStart: raw.scan !== false,
        directoryMode,
        cache: raw.cache,
        saveTo,
        ...(snapshotPath
          ? {
              ...(await loadViewerFile(snapshotPath)),
              sourceName: basename(snapshotPath),
            }
          : {}),
      })
      process.stdout.write(
        `\n  whyfull · Local disk explorer\n  ${viewer.url}\n\n  ${snapshotPath ? "Viewing saved report" : raw.scan === false ? "Ready · choose a scan or open a saved report in the UI" : `Scanning ${viewer.snapshot.root} · ${viewer.snapshot.workers} workers · ${viewer.snapshot.scanner ?? "node"}`}\n  Press Ctrl+C to stop the viewer.\n\n`
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
            `  ${human(snapshot.directories[0].bytes)} · ${snapshot.files.toLocaleString()} files · ${(sqliteInventory(snapshot)?.directoryCount ?? snapshot.directories.length).toLocaleString()} folders · ${(snapshot.durationMs / 1000).toFixed(1)}s\n`
          )
        }
      },
    })
    nativeResult = snapshot
    process.removeListener("SIGINT", cancel)
    let cachedPath: string | null = null
    if (raw.cache && snapshot.status === "complete") {
      try {
        cachedPath = await (
          directoryMode ? ScanCache.forDirectory(snapshot.root) : sharedCache
        ).save(snapshot, {
          ...options,
          policy: snapshot.policy,
        })
      } catch (error) {
        process.stderr.write(
          `whyfull: could not save scan cache: ${error instanceof Error ? error.message : String(error)}\n`
        )
      }
    }
    if (saveTo) await saveDiskSnapshot(snapshot, saveTo)
    if (raw.json) {
      for (const chunk of diskSnapshotChunks(snapshot))
        if (!process.stdout.write(chunk)) await once(process.stdout, "drain")
    } else {
      process.stdout.write(
        `\n  ${snapshot.status}: ${human(snapshot.directories[0].bytes)} · ${snapshot.files.toLocaleString()} files · ${(snapshot.durationMs / 1000).toFixed(1)}s\n  ${snapshot.issues} read errors · ${snapshot.directories[0].excluded} excluded directories · ${snapshot.skippedLinks} links skipped\n`
      )
      if (saveTo) process.stdout.write(`  Saved ${saveTo}\n`)
      if (cachedPath) process.stdout.write(`  Cached ${cachedPath}\n`)
    }
    if (snapshot.status !== "complete") process.exitCode = 1
  } catch (error) {
    process.stderr.write(
      `whyfull: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 2
  } finally {
    if (nativeResult) sqliteInventory(nativeResult)?.dispose()
  }
}
