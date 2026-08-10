#!/usr/bin/env node
/**
 * yful — report where disk space went on a developer machine.
 *
 * Read-only by design. There is no delete flag and there will not be one:
 * `hf cache delete` already does revision-aware blob refcounting, and
 * reimplementing that is how you corrupt someone's model cache.
 */

import { scan } from "./scan"
import { render, dim } from "./report"
import { human } from "./size"

const HELP = `
  yful — where did my disk go?

  Usage
    npx yful [options]

  Options
    --json            machine-readable output
    --top <n>         drill into the n largest children of big targets (default 5)
    --all             also list locations that were not found
    --no-drill        skip child breakdown (fastest)
    --exact           count every file in huge package stores (slow, precise)
    --help            this

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
  const opts: CliOptions = { json: false, top: 5, all: false, help: false, exact: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "--all") opts.all = true
    else if (arg === "--exact") opts.exact = true
    else if (arg === "--no-drill") opts.top = 0
    else if (arg === "--help" || arg === "-h") opts.help = true
    else if (arg === "--top") {
      const n = Number.parseInt(argv[i + 1], 10)
      if (Number.isNaN(n)) {
        process.stderr.write("yful: --top needs a number\n")
        process.exit(2)
      }
      opts.top = n
      i += 1
    } else {
      process.stderr.write(`yful: unknown option ${arg}\n`)
      process.exit(2)
    }
  }
  return opts
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
