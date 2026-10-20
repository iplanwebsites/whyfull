import { readFile, readdir, writeFile, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { releaseInfo } from "./release-info.mjs"

// These are the artifacts built by the native release matrix. Updater archives
// are deliberately excluded from user-facing downloads.
export const artifactSpecs = [
  ["desktop-macos-arm64", (v) => `Whyfull_${v}_aarch64.dmg`],
  ["desktop-macos-x64", (v) => `Whyfull_${v}_x64.dmg`],
  ["desktop-windows-x64", (v) => `Whyfull_${v}_x64-setup.exe`],
  ["desktop-linux-x64-appimage", (v) => `Whyfull_${v}_amd64.AppImage`],
  ["desktop-linux-x64-deb", (v) => `Whyfull_${v}_amd64.deb`],
  ["cli-macos-arm64", (v) => `whyfull-${v}-darwin-arm64.tar.gz`],
  ["cli-macos-x64", (v) => `whyfull-${v}-darwin-x64.tar.gz`],
  ["cli-windows-x64", (v) => `whyfull-${v}-win32-x64.zip`],
  ["cli-linux-x64", (v) => `whyfull-${v}-linux-x64.tar.gz`],
]

export async function createManifest({
  directory,
  version,
  channel,
  macosSigning,
  now = new Date(),
}) {
  const info = releaseInfo({ version, channel, macosSigning })
  const names = await readdir(directory)
  const downloads = []
  for (const [id, filename] of artifactSpecs) {
    const name = filename(version)
    if (!names.includes(name))
      throw new Error(`Missing release artifact: ${name}`)
    const file = join(directory, name)
    const details = await stat(file)
    if (!details.isFile() || details.size <= 0)
      throw new Error(`Empty or invalid release artifact: ${name}`)
    const sha256 = createHash("sha256")
      .update(await readFile(file))
      .digest("hex")
    downloads.push({ id, name, size: details.size, sha256 })
  }
  if (info.updater) {
    const update = JSON.parse(
      await readFile(join(directory, "latest.json"), "utf8")
    )
    if (update.version !== version)
      throw new Error("Updater manifest version mismatch")
    for (const target of [
      "darwin-aarch64",
      "darwin-x86_64",
      "windows-x86_64",
      "linux-x86_64",
    ]) {
      const platform = update.platforms?.[target]
      if (
        !platform?.signature ||
        !platform.url?.startsWith(
          `https://github.com/iplanwebsites/whyfull/releases/download/${info.tag}/`
        )
      )
        throw new Error(`Missing signed updater platform: ${target}`)
      const name = decodeURIComponent(
        new URL(platform.url).pathname.split("/").at(-1)
      )
      if (!names.includes(name))
        throw new Error(`Missing updater artifact: ${name}`)
    }
  }
  return {
    schemaVersion: 1,
    version,
    channel: info.channel,
    createdAt: now.toISOString(),
    macosSigning: info.macosSigning,
    windowsSigning: "unsigned",
    updater: info.updater,
    downloads,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory = process.argv[2]
  if (!directory)
    throw new Error(
      "Usage: node release-manifest.mjs <downloaded-release-directory>"
    )
  const { version } = JSON.parse(
    await readFile(
      new URL("../../../packages/whyfull/package.json", import.meta.url)
    )
  )
  const manifest = await createManifest({
    directory,
    version,
    channel: process.env.RELEASE_CHANNEL || "auto",
    macosSigning: process.env.MACOS_SIGNING || "auto",
  })
  await writeFile(
    join(directory, "downloads.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  )
  await writeFile(
    join(directory, "SHA256SUMS.txt"),
    manifest.downloads
      .map(({ sha256, name }) => `${sha256}  ${name}\n`)
      .join("")
  )
  console.log(
    `Validated ${manifest.downloads.length} downloads for ${version} (${manifest.channel})`
  )
}
