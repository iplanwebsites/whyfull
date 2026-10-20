import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const executable = fileURLToPath(
  new URL(
    `../src-tauri/target/release/whyfull-desktop${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url
  )
)
const result = spawnSync(executable, ["--cli", "--help"], {
  encoding: "utf8",
  timeout: 20000,
})
if (result.status !== 0 || !result.stdout?.includes("where did my disk go"))
  throw new Error(
    `Native CLI smoke test failed: ${result.error ?? result.stderr}`
  )
console.log("Native CLI help works without starting a webview")
