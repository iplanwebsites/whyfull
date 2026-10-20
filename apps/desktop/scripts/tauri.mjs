import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { configure } from "./configure.mjs"
const desktop = fileURLToPath(new URL("../", import.meta.url))
const args = process.argv.slice(2)
configure({ release: !!process.env.CI && args[0] === "build" })
const localDmg =
  process.platform === "darwin" &&
  !process.env.CI &&
  args[0] === "build" &&
  args.length === 1
if (localDmg) args.push("--bundles", "app")
const result = spawnSync(
  process.platform === "win32" ? "tauri.cmd" : "tauri",
  [...args, "--config", "src-tauri/version.conf.json"],
  { cwd: desktop, stdio: "inherit", shell: process.platform === "win32" }
)
if (result.error) throw result.error
if (result.status === 0 && localDmg) await import("./dmg.mjs")
process.exit(result.status ?? 1)
