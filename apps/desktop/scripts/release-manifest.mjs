import { readFile, readdir, writeFile, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { releaseInfo } from "./release-info.mjs"
import {
  allPlatforms,
  downloadsFor,
  parsePlatforms,
  platforms as platformTable,
  updaterTargetsFor,
} from "./release-platforms.mjs"

// Every user-facing download and updater key across all platforms, in the
// order the matrix builds them. Updater archives are not user-facing downloads.
export const artifactSpecs = allPlatforms.flatMap(
  (name) => platformTable[name].downloads
)
export const updaterTargets = allPlatforms.flatMap(
  (name) => platformTable[name].updaterTargets
)

export async function createManifest({
  directory,
  version,
  channel,
  macosSigning,
  buildOnly = false,
  updater = "auto",
  platforms = allPlatforms,
  now = new Date(),
}) {
  platforms = parsePlatforms(platforms)
  const info = releaseInfo({
    version,
    channel,
    macosSigning,
    buildOnly,
    updater,
  })
  const names = await readdir(directory)
  const downloads = []
  for (const [id, filename] of downloadsFor(platforms)) {
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
    const targets = updaterTargetsFor(platforms)
    const extra = Object.keys(update.platforms ?? {}).filter(
      (target) => !targets.some(([expected]) => expected === target)
    )
    if (extra.length)
      throw new Error(
        `Updater platform outside this release: ${extra.join(", ")}`
      )
    for (const [target, filename] of targets) {
      const platform = update.platforms?.[target]
      const name = filename(version)
      if (
        !platform?.signature ||
        platform.url !==
          `https://github.com/iplanwebsites/whyfull/releases/download/${info.tag}/${encodeURIComponent(name)}`
      )
        throw new Error(`Missing signed updater platform: ${target}`)
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
    platforms,
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
    await readFile(new URL("../package.json", import.meta.url))
  )
  const manifest = await createManifest({
    directory,
    version,
    channel: process.env.RELEASE_CHANNEL || "auto",
    macosSigning: process.env.MACOS_SIGNING || "auto",
    buildOnly: process.env.BUILD_ONLY === "true",
    updater: process.env.UPDATER || "auto",
    platforms: process.env.RELEASE_PLATFORMS || allPlatforms,
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
