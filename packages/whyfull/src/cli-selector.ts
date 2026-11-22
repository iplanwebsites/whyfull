import {
  cancel,
  intro,
  isCancel,
  log,
  outro,
  select,
  text,
} from "@clack/prompts"
import pc from "picocolors"
import { homedir } from "node:os"
import { volume } from "./size"
import { basename } from "node:path"
import { CLI_LICENSE_NOTICE } from "./license"

const choices = [
  { label: "Open web UI & latest scan", args: ["--ui"] },
  {
    label: `Open current directory · ${basename(process.cwd())}`,
    args: ["--ui", "--directory"],
  },
  { label: "Open web UI without scanning", args: ["--ui", "--no-scan"] },
  { label: "Show opportunity summary", args: ["--tui"] },
  { label: "Save opportunity report as JSON", args: ["--tui", "--json-file"] },
  {
    label: "Save current directory scan as JSON",
    args: ["--scan", "--directory", "--json-file"],
  },
  {
    label: "Save full filesystem scan as JSON",
    args: ["--scan", "--json-file"],
  },
  { label: "Help & commands for agents", args: ["--help"] },
  { label: "License & pricing", args: ["license"] },
] as const

function command(args: readonly string[]) {
  return `npx whyfull ${args
    .map((arg) =>
      /^[\w./-]+$/.test(arg) ? arg : "'" + arg.replaceAll("'", "'\\''") + "'"
    )
    .join(" ")}`
}

export async function selectCommand(): Promise<string[] | null> {
  const disk = volume(homedir())
  const usage =
    disk && disk.total > 0 && Number.isFinite(disk.used / disk.total)
      ? `Disk ${Math.round(Math.max(0, Math.min(1, disk.used / disk.total)) * 100)}% full`
      : "Disk usage unavailable"
  intro(`${pc.bgCyan(pc.black(" whyfull "))} ${pc.dim(usage)}`)
  log.message(pc.dim(CLI_LICENSE_NOTICE))
  const selected = await select({
    message: "Choose an action · ↑/↓ to move · Enter to select",
    initialValue: 0,
    maxItems: choices.length + 1,
    options: [
      ...choices.map((choice, value) => ({
        value,
        label: choice.label,
        hint: `${command(choice.args)}${choice.args.some((arg) => arg === "--json-file") ? " <new-file.json>" : ""}`,
      })),
      { value: -1, label: "Quit", hint: "Esc or Ctrl+C also cancels" },
    ],
  })
  if (isCancel(selected) || selected === -1) {
    cancel("See you next time.")
    return null
  }
  const args: string[] = [...choices[selected].args]
  if (args.includes("--json-file")) {
    const path = await text({
      message: "Save to a new JSON file",
      placeholder: "./whyfull-report.json",
      validate: (value) => (value?.trim() ? undefined : "Enter a file path."),
    })
    if (isCancel(path)) {
      cancel("Report cancelled.")
      return null
    }
    args.push(path.trim())
    if (args.includes("--scan") && !args.includes("--directory")) {
      const root = await text({
        message: "Folder or disk to scan",
        placeholder: "Enter for the system data volume",
      })
      if (isCancel(root)) {
        cancel("Scan cancelled.")
        return null
      }
      if (root.trim()) args.push("--root", root.trim())
    }
  }
  // Keep the exact command after selection so it can be copied and repeated.
  outro(`Running: ${command(args)}`)
  return args
}
