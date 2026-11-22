import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

// buildOnly runs never create or change a GitHub release. They may relax
// signing so each platform can be exercised on CI before secrets exist.
export function releaseInfo({
  version,
  channel = "auto",
  macosSigning = "auto",
  buildOnly = false,
  updater = "auto",
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
      "Preview releases need a prerelease version, e.g. 0.0.2-preview.1; stable releases need a plain version"
    )
  if (macosSigning === "auto") macosSigning = preview ? "unsigned" : "notarized"
  if (!["unsigned", "notarized"].includes(macosSigning))
    throw new Error("Unknown macOS signing mode")
  if (!["auto", "off"].includes(updater))
    throw new Error("Unknown updater mode")
  // Previews never follow the stable updater feed.
  const updates = !preview && updater === "auto"
  if (!buildOnly && !preview && macosSigning !== "notarized")
    throw new Error("Stable macOS releases must be signed and notarized")
  if (!buildOnly && !preview && !updates)
    throw new Error("Stable releases must include signed updates")
  return {
    version,
    tag: `v${version}`,
    channel,
    preview,
    macosSigning,
    updater: updates,
    buildOnly,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url))
  )
  const info = releaseInfo({
    version,
    channel: process.env.RELEASE_CHANNEL || "auto",
    macosSigning: process.env.MACOS_SIGNING || "auto",
    buildOnly: process.env.BUILD_ONLY === "true",
    updater: process.env.UPDATER || "auto",
  })
  if (
    !info.buildOnly &&
    process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME !== info.tag
  )
    throw new Error(`Release tag must match the desktop version: ${info.tag}`)
  for (const [key, value] of Object.entries(info))
    console.log(`${key}=${value}`)
}
