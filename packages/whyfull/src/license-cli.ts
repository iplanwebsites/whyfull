import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import mri from "mri"
import {
  CLI_LICENSE_TERMS,
  DESKTOP_LICENSE_TERMS,
  DesktopLicense,
  LICENSE_PAGES,
  licenseLinks,
  licenseStatusReport,
  trialSummary,
  type DesktopLicenseView,
} from "./license"
import { openExternalUrl } from "./open-url"

const HELP = `
whyfull license [status] [--json]
whyfull license activate <key | activation link | -> [--json]
whyfull license deactivate [--json]
whyfull license buy [--open]

The command line is free: ${CLI_LICENSE_TERMS}
The desktop app: ${DESKTOP_LICENSE_TERMS}.

status      Show the desktop app's license or trial on this computer.
activate    Check a key offline and save it for the desktop app. Accepts the
            key, the link from your purchase email, or - to read stdin.
deactivate  Remove the key from this computer. The trial count stays.
buy         Print the purchase page. --open also opens it in your browser.

All commands accept --config <config.json>; license.json lives beside it.
None of them counts a day of the desktop trial or prints the full key.
Exit codes: 0 ok, 1 invalid key or failed action, 2 usage error.
`

/** Injectable for tests; the real CLI always uses the shipped public key. */
export interface LicenseCliIo {
  publicKey?: string
  readStdin?: () => string
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  openUrl?: (url: string) => Promise<void>
  clock?: () => Date
}

class UsageError extends Error {}

const ACTIONS = ["status", "activate", "deactivate", "buy"] as const

function human(view: DesktopLicenseView, file: string, note?: string) {
  const links = licenseLinks()
  const lines = [
    "",
    "  Whyfull license",
    "",
    `  Command line   ${CLI_LICENSE_TERMS}`,
    `  Desktop app    ${trialSummary(view)}`,
    `  License file   ${file}`,
    "",
    `  Buy            ${links.buy}`,
    `  Lost your key  ${links.recover}`,
    `  Terms          ${links.legal}`,
    "",
    view.licensed
      ? "  Remove from this computer: whyfull license deactivate"
      : "  Already bought it? whyfull license activate <key or link>",
    "",
  ]
  if (note) lines.splice(2, 0, "", `  ${note}`)
  return lines.join("\n")
}

/** `whyfull license …`. Returns the process exit code. */
export async function runLicenseCli(
  argv: string[],
  io: LicenseCliIo = {}
): Promise<number> {
  const out = io.stdout ?? ((text) => void process.stdout.write(text))
  const err = io.stderr ?? ((text) => void process.stderr.write(text))
  try {
    const args = [...argv]
    if (args.includes("--help") || args.includes("-h")) {
      out(HELP)
      return 0
    }
    // `-` is a positional (stdin), not a flag.
    const action =
      args[0] && !args[0].startsWith("-") ? args.shift()! : "status"
    if (!(ACTIONS as readonly string[]).includes(action))
      throw new UsageError(
        `Unknown command license ${action}. Use whyfull license --help`
      )
    // mri drops a bare "-", so take the stdin marker out first.
    const stdin = args.indexOf("-")
    if (stdin !== -1) args.splice(stdin, 1)
    let unknown: string | undefined
    const raw = mri(args, {
      string: ["config"],
      boolean: ["json", "open"],
      alias: { config: "config", json: "json", open: "open" },
      unknown: (flag) => {
        unknown = flag
      },
    })
    if (unknown) throw new UsageError(`Unknown option ${unknown}`)
    if (
      raw.config !== undefined &&
      (typeof raw.config !== "string" || !raw.config.trim())
    )
      throw new UsageError("--config requires one path")
    if (raw.open && action !== "buy")
      throw new UsageError(`--open is not supported for license ${action}`)
    if (raw.json && action === "buy")
      throw new UsageError("--json is not supported for license buy")
    const positional = [...(stdin === -1 ? [] : ["-"]), ...raw._.map(String)]
    if (action === "activate" ? positional.length !== 1 : positional.length)
      throw new UsageError(
        action === "activate"
          ? "license activate requires one key, activation link, or - for stdin"
          : `Unexpected argument ${positional[0]}`
      )

    if (action === "buy") {
      out(`${LICENSE_PAGES.buy}\n`)
      if (raw.open) {
        try {
          await (io.openUrl ?? openExternalUrl)(LICENSE_PAGES.buy)
        } catch (error) {
          err(
            `whyfull: ${error instanceof Error ? error.message : String(error)}\n`
          )
          return 1
        }
      }
      return 0
    }

    const license = new DesktopLicense({
      policyFile: raw.config === undefined ? undefined : resolve(raw.config),
      publicKey: io.publicKey,
      clock: io.clock,
    })
    let view: DesktopLicenseView
    let note: string | undefined
    if (action === "activate") {
      const input =
        positional[0] === "-"
          ? (io.readStdin ?? (() => readFileSync(0, "utf8")))()
          : positional[0]
      try {
        view = license.activate(input)
      } catch (error) {
        err(
          `whyfull: ${error instanceof Error ? error.message : String(error)}\n`
        )
        return 1
      }
      note = "Activated. Thank you for supporting Whyfull."
    } else if (action === "deactivate") {
      const before = license.status()
      try {
        // Nothing to remove: leave license.json as it is.
        view = before.licensed ? license.deactivate() : before
      } catch (error) {
        err(
          `whyfull: could not update ${license.path}: ${error instanceof Error ? error.message : String(error)}\n`
        )
        return 1
      }
      note = before.licensed
        ? "Removed the license from this computer."
        : "No license was active on this computer."
    } else view = license.status()

    out(
      raw.json
        ? JSON.stringify(licenseStatusReport(view, license.path), null, 2) +
            "\n"
        : human(view, license.path, note)
    )
    return 0
  } catch (error) {
    err(`whyfull: ${error instanceof Error ? error.message : String(error)}\n`)
    return error instanceof UsageError ? 2 : 1
  }
}
