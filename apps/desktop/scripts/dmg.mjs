// Local disk image packaging without Finder/Apple Events permission.
import { cp, mkdtemp, readFile, rm, symlink, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
if (process.platform !== "darwin") throw new Error("DMGs require macOS")
const desktop = fileURLToPath(new URL("../", import.meta.url))
const { version } = JSON.parse(
  await readFile(join(desktop, "src-tauri/version.conf.json"))
)
const output = join(desktop, "src-tauri/target/release/bundle/dmg")
await mkdir(output, { recursive: true })
// GitHub's macOS runners sometimes report "Resource temporarily unavailable"
// from hdiutil while the image is still busy; retry with a short backoff.
function hdiutil(args, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("hdiutil", args, { stdio: "inherit" })
    } catch (error) {
      if (attempt >= attempts) throw error
      console.warn(`hdiutil ${args[0]} failed (attempt ${attempt}); retrying`)
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        attempt * 3000
      )
    }
  }
}
const stage = await mkdtemp(join(tmpdir(), "whyfull-dmg-"))
try {
  await cp(
    join(desktop, "src-tauri/target/release/bundle/macos/Whyfull.app"),
    join(stage, "Whyfull.app"),
    { recursive: true, verbatimSymlinks: true }
  )
  await symlink("/Applications", join(stage, "Applications"))
  const arch = process.arch === "arm64" ? "aarch64" : process.arch
  const dmg = join(output, `Whyfull_${version}_${arch}.dmg`)
  hdiutil([
    "create",
    "-volname",
    "Whyfull",
    "-srcfolder",
    stage,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ])
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim()
  if (identity && identity !== "-") {
    execFileSync(
      "codesign",
      ["--force", "--sign", identity, "--timestamp", dmg],
      {
        stdio: "inherit",
      }
    )
    execFileSync("codesign", ["--verify", dmg], { stdio: "inherit" })
  }
  hdiutil(["verify", dmg])
  console.log(dmg)
} finally {
  await rm(stage, { recursive: true, force: true })
}
