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
const stage = await mkdtemp(join(tmpdir(), "whyfull-dmg-"))
try {
  await cp(
    join(desktop, "src-tauri/target/release/bundle/macos/Whyfull.app"),
    join(stage, "Whyfull.app"),
    { recursive: true, verbatimSymlinks: true }
  )
  await symlink("/Applications", join(stage, "Applications"))
  const dmg = join(output, `Whyfull_${version}_${process.arch}.dmg`)
  execFileSync(
    "hdiutil",
    [
      "create",
      "-volname",
      "Whyfull",
      "-srcfolder",
      stage,
      "-ov",
      "-format",
      "UDZO",
      dmg,
    ],
    { stdio: "inherit" }
  )
  execFileSync("hdiutil", ["verify", dmg], { stdio: "inherit" })
  console.log(dmg)
} finally {
  await rm(stage, { recursive: true, force: true })
}
