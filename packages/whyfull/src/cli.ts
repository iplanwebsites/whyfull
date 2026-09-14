#!/usr/bin/env node
/**
 * whyfull — report where disk space went on a developer machine.
 *
 * Read-only by design. There is no delete flag and there will not be one:
 * `hf cache delete` already does revision-aware blob refcounting, and
 * reimplementing that is how you corrupt someone's model cache.
 */

import mri from "mri"
import { scan } from "./scan"
import { discover, discoverCaches } from "./discover"
import { findWorktrees } from "./worktrees"
import { buildJsonReport, saveJsonReport } from "./json"
import { render, dim } from "./report"
import { human } from "./size"

const HELP = `
  whyfull — where did my disk go?

  Usage
    npx whyfull [options]

  Options
    --json            versioned, machine-readable output on stdout
    --json-file <path>  save the same JSON privately; refuses to overwrite
    --top <n>         drill into the n largest children of big targets (default 5)
    --all             also list locations that were not found
    --no-drill        skip child breakdown (fastest)
    --exact           count every file in huge package stores (slow, precise)
    --discover        also scan common user folders for unknown hogs (>5 GB)
    --no-cache-scan   skip untracked user/project cache scanning (>250 MB)
    --worktrees       find git worktrees left by agent tools (default)
    --no-worktrees    skip the default git worktree scan
    --worktree-root <dir>  extra directory to seed the worktree scan (repeatable)
    --worktree-age <days>  only list worktrees idle this long (default 0 = all)
    -h, --help        this

  Reads a table of known cache and model locations, measures what exists, and
  ranks it by how safe it is to remove. Prints the reclaim command for each.
  Never deletes or mutates scanned locations and never touches the network.
  --json-file creates only the explicitly requested report file.

  Add custom targets in ~/.config/whyfull/targets.json — see README for schema.
`

interface CliOptions {
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
      "all",
      "exact",
      "help",
      "discover",
      "cache-scan",
      "worktrees",
    ],
    string: ["top", "json-file", "worktree-root", "worktree-age"],
    // mri only rejects flags outside this map — every recognised flag needs an
    // entry here (self-aliased is fine) or it silently reads as "unknown".
    alias: {
      json: "json",
      "json-file": "json-file",
      all: "all",
      exact: "exact",
      h: "help",
      discover: "discover",
      "cache-scan": "cache-scan",
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
    jsonFileArg !== undefined &&
    (Array.isArray(jsonFileArg) ||
      typeof jsonFileArg !== "string" ||
      jsonFileArg.trim().length === 0)
  ) {
    process.stderr.write("whyfull: --json-file needs one non-empty path\n")
    process.exit(2)
  }

  return {
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

const opts = parseArgs(process.argv.slice(2))

if (opts.help) {
  process.stdout.write(HELP)
  process.exit(0)
}

const started = Date.now()
// Progress uses cursor control, so it needs a real terminal and must respect
// NO_COLOR — otherwise escapes end up in logs and CI output.
const interactive = process.stdout.isTTY && !opts.json && !process.env.NO_COLOR

const report = scan({
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
  process.stdout.write("\n")
}
