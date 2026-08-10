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
    -h, --help        this

  Reads a table of known cache and model locations, measures what exists, and
  ranks it by how safe it is to remove. Prints the reclaim command for each.
  Never deletes, never writes, never touches the network.
`

interface CliOptions {
  json: boolean
  top: number
  all: boolean
  help: boolean
  exact: boolean
}

function parseArgs(argv: string[]): CliOptions {
  let unknown: string | undefined
  const argvNoDrillFriendly = argv.filter((a) => a !== "--no-drill")
  const hasNoDrill = argvNoDrillFriendly.length !== argv.length

  const raw = mri(argvNoDrillFriendly, {
    boolean: ["json", "all", "exact", "help"],
    string: ["top"],
    // mri only rejects flags outside this map — every recognised flag needs an
    // entry here (self-aliased is fine) or it silently reads as "unknown".
    alias: { json: "json", all: "all", exact: "exact", h: "help" },
    default: { top: "5" },
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

  const top = hasNoDrill ? 0 : Number.parseInt(raw.top, 10)
  if (Number.isNaN(top)) {
    process.stderr.write("whyfull: --top needs a number\n")
    process.exit(2)
  }

  return { json: raw.json, top, all: raw.all, help: raw.help, exact: raw.exact }
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

if (interactive) process.stderr.write("\r\x1b[2K")

if (opts.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  process.stdout.write(render(report, { showAll: opts.all }))
  process.stdout.write(
    `  ${dim(`Scanned ${human(report.total)} in ${((Date.now() - started) / 1000).toFixed(1)}s`)}\n\n`
  )
}
