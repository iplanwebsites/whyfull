import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export interface DiagnosticCommand {
  id: string
  label: string
  executable: string
  args: string[]
  timeoutMs: number
}
export interface DiagnosticRun {
  id: string
  status: "running" | "complete" | "failed" | "cancelled"
  trace: string
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  truncated: boolean
}
export function diagnosticCommands(): DiagnosticCommand[] {
  return [
    {
      id: "space",
      label: "System disk usage",
      executable: "/bin/df",
      args: ["-h", homedir()],
      timeoutMs: 15000,
    },
    ...(process.platform === "darwin"
      ? [
          {
            id: "volume",
            label: "Volume information",
            executable: "/usr/sbin/diskutil",
            args: ["info", homedir()],
            timeoutMs: 30000,
          },
          {
            id: "snapshots",
            label: "Local Time Machine snapshots",
            executable: "/usr/bin/tmutil",
            args: ["listlocalsnapshots", "/"],
            timeoutMs: 30000,
          },
          {
            id: "storage",
            label: "System storage diagnostic",
            executable: "/usr/sbin/system_profiler",
            args: ["SPStorageDataType"],
            timeoutMs: 60000,
          },
        ]
      : []),
    {
      id: "whyfull",
      label: "Known caches & models",
      executable: process.execPath,
      args: [
        join(dirname(fileURLToPath(import.meta.url)), "cli.mjs"),
        "--no-drill",
        "--no-cache-scan",
        "--no-worktrees",
      ],
      timeoutMs: 180000,
    },
  ].filter((command) => existsSync(command.executable))
}
/** Fixed read-only commands; the HTTP caller can choose IDs, never shell input. */
export class DiagnosticRunner {
  private runs = new Map<string, DiagnosticRun>()
  private stop: (() => void) | null = null
  constructor(private commands = diagnosticCommands()) {}
  status() {
    return {
      commands: this.commands.map((command) => ({
        id: command.id,
        label: command.label,
        command: [command.executable, ...command.args]
          .map((part) => JSON.stringify(part))
          .join(" "),
      })),
      runs: [...this.runs.values()].map((run) => ({ ...run })),
      running: !!this.stop,
    }
  }
  run(id: unknown) {
    const command = this.commands.find((item) => item.id === id)
    if (!command) throw new Error("Select an available diagnostic command")
    if (this.stop)
      throw new Error("Stop the current diagnostic before starting another")
    const run: DiagnosticRun = {
      id: command.id,
      status: "running",
      trace: "",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      truncated: false,
    }
    this.runs.set(command.id, run)
    const child = spawn(command.executable, command.args, {
      cwd: homedir(),
      shell: false,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const append = (text: string) => {
      const available = 256 * 1024 - run.trace.length
      if (text.length > available) run.truncated = true
      if (available > 0) run.trace += text.slice(0, available)
    }
    child.stdout.setEncoding("utf8").on("data", append)
    child.stderr.setEncoding("utf8").on("data", append)
    let stopped: "cancelled" | "failed" | null = null
    const stop = (status: "cancelled" | "failed") => {
      stopped = status
      child.kill("SIGKILL")
    }
    this.stop = () => stop("cancelled")
    const timer = setTimeout(() => {
      append("\nDiagnostic timed out.\n")
      stop("failed")
    }, command.timeoutMs)
    timer.unref()
    child.on("error", (error) => append(`${error.message}\n`))
    child.on("close", (code) => {
      clearTimeout(timer)
      run.exitCode = code
      run.status = stopped ?? (code === 0 ? "complete" : "failed")
      run.finishedAt = new Date().toISOString()
      this.stop = null
    })
    return this.status()
  }
  cancel() {
    this.stop?.()
    return this.status()
  }
}
export type DiagnosticsStatus = ReturnType<DiagnosticRunner["status"]>
