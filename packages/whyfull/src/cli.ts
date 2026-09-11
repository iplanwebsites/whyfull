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
import { discover } from "./discover"
import { findWorktrees } from "./worktrees"
import { render, dim } from "./report"
import { human } from "./size"

const HELP = `
  whyfull — where did my disk go?

  Usage
    npx whyfull [options]

  Options
    --json            machine-readable output
    --top <n>         drill into the n largest children of big targets (default 5)
    --all             also list locations that were not found
    --no-drill        skip child breakdown (fastest)
    --exact           count every file in huge package stores (slow, precise)
    --discover        also scan Desktop/Downloads/Music for unknown hogs (>5 GB)
    --worktrees       also find abandoned git worktrees left by agent tools
    --worktree-root <dir>  extra directory to seed the worktree scan (repeatable)
    --worktree-age <days>  only list worktrees idle this long (default 0 = all)
    -h, --help        this

  Reads a table of known cache and model locations, measures what exists, and
  ranks it by how safe it is to remove. Prints the reclaim command for each.
  Never deletes, never writes, never touches the network.

  Add custom targets in ~/.config/whyfull/targets.json — see README for schema.
`

interface CliOptions {
  json: boolean
  top: number
  all: boolean
  help: boolean
  exact: boolean
  discover: boolean
  worktrees: boolean
  worktreeRoots: string[]
  worktreeAge: number
}

function parseArgs(argv: string[]): CliOptions {
  let unknown: string | undefined
  const argvNoDrillFriendly = argv.filter((a) => a !== "--no-drill")
  const hasNoDrill = argvNoDrillFriendly.length !== argv.length

  const raw = mri(argvNoDrillFriendly, {
    boolean: ["json", "all", "exact", "help", "discover", "worktrees"],
    string: ["top", "worktree-root", "worktree-age"],
    // mri only rejects flags outside this map — every recognised flag needs an
    // entry here (self-aliased is fine) or it silently reads as "unknown".
    alias: {
      json: "json",
      all: "all",
      exact: "exact",
      h: "help",
      discover: "discover",
      worktrees: "worktrees",
      "worktree-root": "worktree-root",
      "worktree-age": "worktree-age",
    },
    default: { top: "5", "worktree-age": "0" },
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

  return {
    json: raw.json,
    top,
    all: raw.all,
    help: raw.help,
    exact: raw.exact,
    discover: raw.discover,
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

// Worktree discovery: seeds + metadata expansion, then a budgeted measure per
// worktree. Off by default because it is the only part of the run that can
// take seconds on a machine with dozens of abandoned checkouts.
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

if (opts.json) {
  const output = {
    ...report,
    ...(discovered ? { discovered } : {}),
    ...(worktrees ? { worktrees } : {}),
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
} else {
  process.stdout.write(
    render(report, { showAll: opts.all, discovered, worktrees })
  )
  process.stdout.write(
    `  ${dim(`Scanned ${human(report.total)} in ${((Date.now() - started) / 1000).toFixed(1)}s`)}\n\n`
  )
}
