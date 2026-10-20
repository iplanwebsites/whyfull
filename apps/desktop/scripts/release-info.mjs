import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export function releaseInfo({
  version,
  channel = "auto",
  macosSigning = "auto",
}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Release version must be a semantic version")
  const preview = version.includes("-")
  if (channel === "auto") channel = preview ? "preview" : "stable"
  if (
    !["stable", "preview"].includes(channel) ||
    (channel === "preview") !== preview
  )
    throw new Error(
      "Preview releases need a prerelease version, e.g. 0.0.3-preview.1; stable releases need a plain version"
    )
  if (macosSigning === "auto") macosSigning = preview ? "unsigned" : "notarized"
  if (!["unsigned", "notarized"].includes(macosSigning))
    throw new Error("Unknown macOS signing mode")
  if (!preview && macosSigning !== "notarized")
    throw new Error("Stable macOS releases must be signed and notarized")
  return {
    version,
    tag: `v${version}`,
    channel,
    preview,
    macosSigning,
    updater: !preview,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { version } = JSON.parse(
    readFileSync(
      new URL("../../../packages/whyfull/package.json", import.meta.url)
    )
  )
  const info = releaseInfo({
    version,
    channel: process.env.RELEASE_CHANNEL || "auto",
    macosSigning: process.env.MACOS_SIGNING || "auto",
  })
  if (
    process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME !== info.tag
  )
    throw new Error(`Release tag must match the engine version: ${info.tag}`)
  for (const [key, value] of Object.entries(info))
    console.log(`${key}=${value}`)
}
