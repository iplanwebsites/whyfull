#!/usr/bin/env node
/**
 * whyfull — report where disk space went on a developer machine.
 *
 * Reports are read-only; the viewer offers demo-first native Trash moves.
 */

import mri from "mri"
import { selectCommand } from "./cli-selector"
import { runSelectedCommand } from "./cli-runner"
import { fileURLToPath } from "node:url"
import { scan } from "./scan"
import { discover, discoverCaches } from "./discover"
import { findWorktrees } from "./worktrees"
import { buildJsonReport, saveJsonReport } from "./json"
import { render, dim } from "./report"
import { human } from "./size"
import { runDiskCli } from "./disk-cli"
import { runKnowledgeCli } from "./knowledge-cli"
import { runLicenseCli } from "./license-cli"
import { loadKnowledge } from "./knowledge"
import { resolve } from "node:path"
import { CLI_LICENSE_NOTICE } from "./license"

const HELP = `
  whyfull — where did my disk go?

  Usage
    npx whyfull           interactive picker — start here (help when not a TTY)
    npx whyfull --tui     terminal summary with cleanup guidance
    npx whyfull --json    report for your coding agent (JSON on stdout)
    npx whyfull --ui      visual explorer in your browser
                          aliases: --view, ui, app
    npx whyfull scan [path]           inventory a folder (defaults to cwd)
    npx whyfull locations --help      save, list, and contribute frequent places
    npx whyfull instructions --help   private user / computer guidance
    npx whyfull license               pricing and this computer's desktop license
                                      (status --json, activate, deactivate, buy)

  Examples for scripts and agents (no prompts)
    npx whyfull --tui --json-file report.json
    npx whyfull --scan --root /path --json-file disk.json
    npx whyfull --scan --root /path --json      full inventory on stdout
    npx whyfull --directory ./project --json    folder inventory on stdout
    npx whyfull --directory ./project           explorer scoped to a folder
    npx whyfull --ui --no-scan                  open the explorer without scanning
    npx whyfull --ui --report report.json       open either saved JSON format

  Explorer (--ui)
    --no-scan         wait for the user to start a scan
    --no-open         start without opening the browser
    --root <dir>      scan root (default: home; --scan on macOS: Data)
    --report <file>   open a CLI JSON report or disk snapshot
    --snapshot <file> open a saved disk inventory
    --allow-trash     enable macOS Trash capability (still starts in demo)

  Scanning
    --scan            inventory an entire filesystem (Node by default)
    --directory [dir] folder mode, defaults to cwd (alias: --dir [dir]);
                      cache: <dir>/.whyfull/inventories/
    --workers <n>     filesystem workers, 1–32 (default: up to 8)
    --engine <name>   sync or async metadata (for scan benchmarks)
    --scanner <name>  node (default) or rust (experimental, requires helper)
    --exclude <dir>   skip a directory and descendants; repeatable
    --no-cache        skip persistent scan cache reads and writes;
                      completed --scan inventories share the explorer cache

  Report (--tui, --json)
    --json-file <path>  save the JSON privately; refuses to overwrite
    --top <n>         drill into the n largest children of big targets (default 5)
    --all             also list locations that were not found
    --no-drill        skip child breakdown (fastest)
    --exact           count every file in huge package stores (slow, precise)
    --discover        also scan common user folders for unknown hogs (>5 GB)
    --no-cache-scan   skip untracked user/project cache scanning (>250 MB)
    --no-worktrees    skip the git worktree scan (--worktrees, on by default)
    --worktree-root <dir>  extra directory to seed the worktree scan (repeatable)
    --worktree-age <days>  only list worktrees idle this long (default 0 = all)
    --config <file>   settings file; local knowledge is stored alongside it
    -h, --help        this

  Reads a table of known cache and model locations, measures what exists, and
  ranks it by how safe it is to remove. Prints the reclaim command for each.
  Reports never change scanned locations. Explorer cleanup defaults to demo;
  --allow-trash permits confirmed native Trash moves. No permanent deletion.

  Add custom targets in ~/.config/whyfull/targets.json — see README for schema.

  ${CLI_LICENSE_NOTICE}
`

interface CliOptions {
  policyFile?: string
  json: boolean
  jsonFile: string | null
  top: number
  all: boolean
  help: boolean
  exact: boolean
  discover: boolean
  cacheScan: boolean
  worktrees: boolean
  worktreeRoots: string[]
  worktreeAge: number
}

function parseArgs(argv: string[]): CliOptions {
  let unknown: string | undefined
  const argvNoDrillFriendly = argv.filter((a) => a !== "--no-drill")
  const hasNoDrill = argvNoDrillFriendly.length !== argv.length

  const raw = mri(argvNoDrillFriendly, {
    boolean: [
      "json",
      "tui",
      "all",
      "exact",
      "help",
      "discover",
      "cache-scan",
      "cache",
      "worktrees",
    ],
    string: ["top", "json-file", "worktree-root", "worktree-age", "config"],
    // mri only rejects flags outside this map — every recognised flag needs an
    // entry here (self-aliased is fine) or it silently reads as "unknown".
    alias: {
      json: "json",
      tui: "tui",
      "json-file": "json-file",
      all: "all",
      exact: "exact",
      h: "help",
      discover: "discover",
      "cache-scan": "cache-scan",
      cache: "cache",
      config: "config",
      worktrees: "worktrees",
      "worktree-root": "worktree-root",
      "worktree-age": "worktree-age",
    },
    default: {
      top: "5",
      "worktree-age": "0",
      "cache-scan": true,
      worktrees: true,
    },
    unknown: (flag) => {
      unknown = flag
    },
  })

  if (unknown) {
    process.stderr.write(`whyfull: unknown option ${unknown}\n`)
    process.exit(2)
  }

  if (raw._.length > 0) {
    process.stderr.write(`whyfull: unexpected argument ${raw._[0]}\n`)
    process.exit(2)
  }

  const top = hasNoDrill ? 0 : Number(raw.top)
  if (!Number.isSafeInteger(top) || top < 0) {
    process.stderr.write("whyfull: --top needs a non-negative integer\n")
    process.exit(2)
  }

  // mri collapses a repeated flag to a string or an array depending on count.
  const rootArg = raw["worktree-root"]
  const worktreeRoots = (
    Array.isArray(rootArg) ? rootArg : rootArg ? [rootArg] : []
  ).map(String)

  const worktreeAge = Number(raw["worktree-age"])
  if (!Number.isSafeInteger(worktreeAge) || worktreeAge < 0) {
    process.stderr.write(
      "whyfull: --worktree-age needs a non-negative integer\n"
    )
    process.exit(2)
  }

  const jsonFileArg = raw["json-file"]
  if (
    raw.config !== undefined &&
    (typeof raw.config !== "string" || !raw.config.trim())
  ) {
    process.stderr.write("whyfull: --config needs one non-empty path\n")
    process.exit(2)
  }
  if (
    jsonFileArg !== undefined &&
    (Array.isArray(jsonFileArg) ||
      typeof jsonFileArg !== "string" ||
      jsonFileArg.trim().length === 0)
  ) {
    process.stderr.write("whyfull: --json-file needs one non-empty path\n")
    process.exit(2)
  }

  return {
    policyFile:
      typeof raw.config === "string" && raw.config.trim()
        ? resolve(raw.config)
        : undefined,
    json: raw.json,
    jsonFile: jsonFileArg ?? null,
    top,
    all: raw.all,
    help: raw.help,
    exact: raw.exact,
    discover: raw.discover,
    cacheScan: raw["cache-scan"],
    worktrees: raw.worktrees,
    worktreeRoots,
    worktreeAge,
  }
}

async function main() {
  let argv = process.argv.slice(2)
  if (["locations", "instructions"].includes(argv[0])) {
    runKnowledgeCli(argv)
    return
  }
  if (argv[0] === "license") {
    process.exitCode = await runLicenseCli(argv.slice(1))
    return
  }
  if (argv[0] === "scan") {
    const rest = argv.slice(1)
    const path = rest[0] && !rest[0].startsWith("-") ? rest.shift() : undefined
    argv = [
      "--scan",
      ...(path
        ? ["--root", path]
        : rest.some((arg) => /^(--root|--dir|--directory)(=|$)/.test(arg))
          ? []
          : ["--root", process.cwd()]),
      ...rest,
    ]
  }
  if (argv.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const selected = await selectCommand()
      if (!selected) process.exit(0)
      await runSelectedCommand(selected, fileURLToPath(import.meta.url))
      return
    } else {
      argv = ["--help"]
    }
  }
  // Keep the old viewer aliases while giving both formats explicit flags.
  argv = argv.map((arg) => (arg === "--ui" ? "--view" : arg))
  const flags = argv
  const wantsDirectory = flags.some((arg) =>
    ["--directory", "--dir"].some(
      (flag) => arg === flag || arg.startsWith(`${flag}=`)
    )
  )
  const wantsUi =
    ["ui", "app"].includes(argv[0]?.toLowerCase()) ||
    flags.includes("--view") ||
    (wantsDirectory &&
      !flags.some(
        (arg) =>
          ["--scan", "--tui", "--json", "--json-file"].includes(arg) ||
          arg.startsWith("--json-file=")
      ))
  if (wantsUi && (flags.includes("--tui") || flags.includes("--json"))) {
    process.stderr.write(
      "whyfull: choose --ui, --tui, or --json for output; --ui can save with --json-file\n"
    )
    process.exit(2)
  }
  if (flags.includes("--no-scan") && !wantsUi) {
    process.stderr.write("whyfull: --no-scan requires --ui\n")
    process.exit(2)
  }
  const viewerCommand = ["ui", "app"].includes(argv[0]?.toLowerCase())
  const args = viewerCommand ? ["--view", ...argv.slice(1)] : argv
  if (
    viewerCommand ||
    wantsDirectory ||
    args.some((arg) =>
      ["--view", "--scan", "--snapshot", "--report"].includes(arg)
    )
  ) {
    await runDiskCli(args)
  } else {
    const opts = parseArgs(args)

    if (opts.help) {
      process.stdout.write(HELP)
      process.exit(0)
    }

    const started = Date.now()
    const knowledge = loadKnowledge(opts.policyFile)
    const projects = knowledge.locations.filter(
      (item) => item.enabled && item.kind === "project"
    )
    opts.worktreeRoots = [
      ...new Set([
        ...opts.worktreeRoots,
        ...projects.map((item) => item.resolvedPath),
      ]),
    ]
    // Progress uses cursor control, so it needs a real terminal and must respect
    // NO_COLOR — otherwise escapes end up in logs and CI output.
    const interactive =
      process.stdout.isTTY && !opts.json && !process.env.NO_COLOR

    const report = scan({
      policyFile: opts.policyFile,
      top: opts.top,
      exact: opts.exact,
      onProgress: interactive
        ? (label: string) => {
            process.stderr.write(`\r\x1b[2K  scanning ${label}…`)
          }
        : null,
    })

    // Discovery mode: scan common dirs for unknown hogs
    const discovered = opts.discover
      ? discover({
          policyFile: opts.policyFile,
          onProgress: interactive
            ? (name: string) => {
                process.stderr.write(`\r\x1b[2K  discovering ${name}…`)
              }
            : null,
        })
      : null

    // Cache discovery is shallow and default-on: cache roots are precisely where
    // fast-growing tools appear before they earn a built-in target.
    const cacheHogs = opts.cacheScan
      ? discoverCaches({
          policyFile: opts.policyFile,
          onProgress: interactive
            ? (name: string) => {
                process.stderr.write(`\r\x1b[2K  cache ${name}…`)
              }
            : null,
        })
      : null

    // Worktree discovery: seeds + metadata expansion, then a budgeted measure per
    // worktree. Default-on because agent-created checkouts are often the largest
    // developer-only consumer; --no-worktrees keeps a quick known-location mode.
    const worktrees = opts.worktrees
      ? findWorktrees({
          roots: opts.worktreeRoots,
          minAgeDays: opts.worktreeAge,
          exact: opts.exact,
          onProgress: interactive
            ? (label: string) => {
                process.stderr.write(`\r\x1b[2K  worktree ${label}…`)
              }
            : null,
        })
      : null

    if (interactive) process.stderr.write("\r\x1b[2K")

    const durationMs = Date.now() - started
    const jsonReport = buildJsonReport({
      report,
      discovered,
      cacheHogs,
      worktrees,
      durationMs,
      options: {
        top: opts.top,
        showAll: opts.all,
        exact: opts.exact,
        discover: opts.discover,
        cacheScan: opts.cacheScan,
        worktrees: opts.worktrees,
        worktreeRoots: opts.worktreeRoots,
        worktreeAge: opts.worktreeAge,
      },
    })

    let savedPath: string | null = null
    if (opts.jsonFile) {
      try {
        savedPath = saveJsonReport(opts.jsonFile, jsonReport)
      } catch (err) {
        const reason =
          err instanceof Error && "code" in err && err.code === "EEXIST"
            ? "file already exists (refusing to overwrite)"
            : err instanceof Error
              ? err.message
              : String(err)
        process.stderr.write(`whyfull: could not save JSON report: ${reason}\n`)
        process.exit(2)
      }
    }

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(jsonReport, null, 2)}\n`)
    } else {
      process.stdout.write(
        render(report, {
          showAll: opts.all,
          discovered,
          cacheHogs,
          worktrees,
        })
      )
      process.stdout.write(
        `  ${dim(`Scanned ${human(report.total)} in ${(durationMs / 1000).toFixed(1)}s`)}\n`
      )
      if (savedPath)
        process.stdout.write(`  ${dim(`Saved JSON to ${savedPath}`)}\n`)
      process.stdout.write(`  ${dim(CLI_LICENSE_NOTICE)}\n`)
      process.stdout.write("\n")
    }
  }
}

await main().catch((error) => {
  process.stderr.write(
    `whyfull: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 2
})
