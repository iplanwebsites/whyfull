import { cp, mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
const desktop = fileURLToPath(new URL("../", import.meta.url))
const runtime = join(desktop, "src-tauri/runtime")
const { version, platform, arch } = JSON.parse(
  await readFile(join(runtime, "version.json"))
)
const name = `whyfull-${version}-${platform}-${arch}`
const dist = join(desktop, "dist")
const stage = join(dist, name)
await rm(stage, { force: true, recursive: true })
await mkdir(stage, { recursive: true })
await cp(runtime, join(stage, "runtime"), { recursive: true })
await writeFile(
  join(stage, "whyfull"),
  '#!/bin/sh\nbase=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$base/runtime/node" "$base/runtime/engine/cli.mjs" "$@"\n'
)
await chmod(join(stage, "whyfull"), 0o755)
await writeFile(
  join(stage, "whyfull.cmd"),
  '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0runtime\\engine\\cli.mjs" %*\r\n'
)
await writeFile(
  join(stage, "README.txt"),
  `Whyfull ${version}\nRun ./whyfull (Windows: whyfull.cmd). No Node installation is needed.\nKeep the launcher and runtime directory together. Add this directory to PATH.\nExamples: whyfull --help; whyfull --json; whyfull ui; whyfull --scan --root . --json\nUpdates: replace this directory with a newer release. For automatic updates, use the desktop app's Install command-line tool menu instead.\n`
)
const archive = join(dist, name + (platform === "win32" ? ".zip" : ".tar.gz"))
const result =
  platform === "win32"
    ? spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Compress-Archive -LiteralPath $env:WHYFULL_ARCHIVE_SOURCE -DestinationPath $env:WHYFULL_ARCHIVE_DEST -Force",
        ],
        {
          env: {
            ...process.env,
            WHYFULL_ARCHIVE_SOURCE: stage,
            WHYFULL_ARCHIVE_DEST: archive,
          },
          stdio: "inherit",
        }
      )
    : spawnSync("tar", ["-czf", archive, "-C", dist, name], {
        stdio: "inherit",
      })
if (result.error) throw result.error
if (result.status !== 0) throw new Error("CLI archive failed")
await writeFile(
  archive + ".sha256",
  `${createHash("sha256")
    .update(await readFile(archive))
    .digest("hex")}  ${archive.split(/[\\/]/).at(-1)}\n`
)
console.log(archive)
