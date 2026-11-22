import { readFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import mri from "mri"
import { loadKnowledge, locationProposal, updateKnowledge } from "./knowledge"

const HELP = `
whyfull locations list [--json]
whyfull locations add <path> --id <stable-id> [--name <label>]
  [--kind folder|project|cache|data] [--tier DATA|JUDGEMENT|REBUILD|APP|AUTO]
  [--instructions <text>] [--source user|agent] [--enabled|--no-enabled]
whyfull locations remove <id> [--scope user|computer]
whyfull locations export <id> [--public-id <public-id>] --name <public-name> --path-template <~/path> --hint <public-guidance>

whyfull instructions show [--json]
whyfull instructions set --text <text> [--scope user|computer]
whyfull instructions set --file <path|-> [--scope user|computer]

All commands accept --config <config.json>. Edits accept --revision <number>
to reject stale changes, --scope user|computer (default: computer), and --json.
Adding an existing ID updates only the fields supplied in that scope.
Locations default to DATA: size and a cache label do not make deletion safe.
Computer entries override user entries with the same ID. --no-enabled pauses
an entry. Saved project locations also seed cache and worktree discovery.
Instructions are private guidance for you and your agent; they never run or
replace Keep/Exclude rules. Set --text '' to clear a scope's instructions.
Export prints a draft for community-locations.json. Use --public-id to avoid
sharing a private location ID. Review all public fields
before submitting a PR; private instructions and absolute paths are omitted.
`

export function runKnowledgeCli(argv: string[]): void {
  try {
    const [command, ...args] = argv
    const action =
      args[0] && !args[0].startsWith("-")
        ? args.shift()!
        : command === "locations"
          ? "list"
          : "show"
    if (args.includes("--help") || args.includes("-h")) {
      process.stdout.write(HELP)
      return
    }
    let unknown: string | undefined
    const strings = [
      "scope",
      "config",
      "revision",
      "id",
      "name",
      "kind",
      "tier",
      "instructions",
      "source",
      "text",
      "file",
      "path-template",
      "public-id",
      "hint",
    ]
    const raw = mri(args, {
      string: strings,
      boolean: ["json", "enabled"],
      alias: Object.fromEntries(
        [...strings, "json", "enabled"].map((key) => [key, key])
      ),
      unknown: (flag) => {
        unknown = flag
      },
    })
    if (unknown) throw new Error(`Unknown option ${unknown}`)
    for (const key of strings)
      if (raw[key] !== undefined && typeof raw[key] !== "string")
        throw new Error(`--${key} requires one value`)
    const allowed =
      command === "locations"
        ? action === "add"
          ? [
              "id",
              "name",
              "kind",
              "tier",
              "instructions",
              "source",
              "enabled",
              "scope",
              "revision",
            ]
          : action === "remove"
            ? ["scope", "revision"]
            : action === "export"
              ? ["public-id", "name", "path-template", "hint"]
              : []
        : action === "set"
          ? ["text", "file", "scope", "revision"]
          : []
    for (const key of Object.keys(raw))
      if (!["_", "json", "config", ...allowed].includes(key))
        throw new Error(`--${key} is not supported for ${command} ${action}`)
    const config = raw.config === undefined ? undefined : resolve(raw.config)
    if (raw.config !== undefined && !raw.config.trim())
      throw new Error("--config requires a path")
    const scope = raw.scope ?? "computer"
    const revision =
      raw.revision === undefined ? undefined : Number(raw.revision)
    if (
      raw.revision !== undefined &&
      (!raw.revision.trim() ||
        !Number.isSafeInteger(revision) ||
        Number(revision) < 0)
    )
      throw new Error("--revision requires a non-negative integer")
    const positional = () => {
      if (raw._.length !== 1 || !String(raw._[0]).trim())
        throw new Error(
          `${command} ${action} requires exactly one ${action === "add" ? "path" : "location ID"}`
        )
      return String(raw._[0])
    }
    let next
    if (command === "locations" && action === "add") {
      const path = positional()
      if (!raw.id) throw new Error("Provide a stable --id for the location")
      const current = loadKnowledge(config)
      const settings =
        scope === "user" ? current.user : current.computerSettings
      const existing = settings.locations.find((item) => item.id === raw.id)
      next = updateKnowledge(
        {
          action: "save-location",
          scope,
          revision,
          location: {
            id: raw.id,
            path: path.startsWith("~/") || path === "~" ? path : resolve(path),
            platform: process.platform,
            name: raw.name ?? existing?.name ?? basename(path),
            ...Object.fromEntries(
              ["kind", "tier", "instructions", "source", "enabled"]
                .filter((key) => raw[key] !== undefined)
                .map((key) => [key, raw[key]])
            ),
          },
        },
        config
      )
    } else if (command === "locations" && action === "remove") {
      next = updateKnowledge(
        { action: "remove-location", scope, revision, id: positional() },
        config
      )
    } else if (command === "locations" && action === "export") {
      const proposal = locationProposal(
        {
          id: positional(),
          publicId: raw["public-id"],
          name: raw.name,
          path: raw["path-template"],
          hint: raw.hint,
        },
        config
      )
      process.stdout.write(JSON.stringify(proposal, null, 2) + "\n")
      return
    } else if (command === "instructions" && action === "set") {
      if (raw._.length || (raw.text === undefined) === (raw.file === undefined))
        throw new Error("Choose --text or --file for instructions")
      const instructions =
        raw.file === undefined
          ? raw.text
          : readFileSync(raw.file === "-" ? 0 : raw.file, "utf8")
      next = updateKnowledge(
        { action: "instructions", scope, revision, instructions },
        config
      )
    } else if (
      (command === "locations" && action === "list") ||
      (command === "instructions" && action === "show")
    ) {
      if (raw._.length) throw new Error(`Unexpected argument ${raw._[0]}`)
      next = loadKnowledge(config)
    } else
      throw new Error(
        `Unknown command ${command} ${action}. Use whyfull ${command} --help`
      )
    if (raw.json) process.stdout.write(JSON.stringify(next, null, 2) + "\n")
    else if (command === "instructions") {
      process.stdout.write(
        `User instructions\n${next.user.instructions || "(none)"}\n\nThis computer\n${next.computerSettings.instructions || "(none)"}\n`
      )
    } else {
      process.stdout.write(
        next.locations.length
          ? next.locations
              .map(
                (item) =>
                  `${item.enabled ? "•" : "○"} ${item.name} [${item.id}] · ${item.scope} · ${item.kind} · ${item.tier}\n  ${item.path}`
              )
              .join("\n") + "\n"
          : "No saved locations yet. Add one with whyfull locations add <path> --id <name>\n"
      )
    }
    if (!raw.json)
      process.stdout.write(
        `\nLocal knowledge: ${next.file} · revision ${next.revision}\n`
      )
  } catch (error) {
    process.stderr.write(
      `whyfull: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 2
  }
}
