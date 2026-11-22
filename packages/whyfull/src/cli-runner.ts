import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { spinner } from "@clack/prompts"
import pc from "picocolors"

/** Keep the terminal responsive while the selected command does synchronous I/O. */
export async function runSelectedCommand(args: string[], entryFile: string) {
  const ui = args.includes("--ui")
  const disk = args.includes("--scan")
  const help = args.includes("--help")
  const loading = spinner({ indicator: "timer", output: process.stderr })
  let active = !help
  if (active)
    loading.start(
      ui
        ? "Starting local web UI"
        : disk
          ? "Scanning filesystem"
          : "Scanning for cleanup opportunities"
    )
  const stop = (failed = false) => {
    if (!active) return
    active = false
    if (failed) loading.error("The command could not finish")
    else
      loading.stop(
        ui
          ? "Local web UI ready"
          : disk
            ? "Scan results ready"
            : "Opportunity report ready"
      )
  }
  const env = { ...process.env }
  if (pc.isColorSupported && env.FORCE_COLOR === undefined)
    env.FORCE_COLOR = "1"
  const child = spawn(process.execPath, [entryFile, ...args], {
    env,
    stdio: ["inherit", "pipe", "pipe"],
  })
  const interrupt = () => child.kill("SIGINT")
  const terminate = () => child.kill("SIGTERM")
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", terminate)
  // Clack can exit directly on a keyboard cancellation while its spinner blocks
  // input. Ensure that path also stops the selected command.
  process.once("exit", terminate)
  child.stdout.once("data", () => stop())
  child.stdout.pipe(process.stdout, { end: false })
  const errors = createInterface({ input: child.stderr })
  errors.on("line", (line) => {
    if (active && disk && /^\s+.+ · [\d,]+ files ·/.test(line)) {
      loading.message(`Scanning filesystem · ${line.trim()}`)
    } else if (
      /ExperimentalWarning: SQLite|Use .*--trace-warnings/.test(line)
    ) {
      process.stderr.write(`${line}\n`)
    } else {
      stop(true)
      process.stderr.write(`${line}\n`)
    }
  })
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, signal) =>
        resolve(
          code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)
        )
      )
    })
    stop(code !== 0)
    process.exitCode = code
  } catch (error) {
    stop(true)
    process.stderr.write(
      `whyfull: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 2
  } finally {
    errors.close()
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", terminate)
    process.off("exit", terminate)
  }
}
