import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { releaseInfo } from "./release-info.mjs"

// Authenticode through Azure Artifact Signing. Tauri runs this for the app exe,
// the sidecars and the NSIS installer, replacing %1 with each file's path.
// The CLI reads AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_TENANT_ID itself.
export function windowsSignCommand(env = process.env) {
  const endpoint = env.WHYFULL_AZURE_SIGNING_ENDPOINT?.trim()
  const account = env.WHYFULL_AZURE_SIGNING_ACCOUNT?.trim()
  const profile = env.WHYFULL_AZURE_SIGNING_PROFILE?.trim()
  const missing = [
    ["WHYFULL_AZURE_SIGNING_ENDPOINT", endpoint],
    ["WHYFULL_AZURE_SIGNING_ACCOUNT", account],
    ["WHYFULL_AZURE_SIGNING_PROFILE", profile],
    ["AZURE_CLIENT_ID", env.AZURE_CLIENT_ID],
    ["AZURE_CLIENT_SECRET", env.AZURE_CLIENT_SECRET],
    ["AZURE_TENANT_ID", env.AZURE_TENANT_ID],
  ].filter(([, value]) => !value)
  if (missing.length)
    throw new Error(
      `Windows signing requires ${missing.map(([name]) => name).join(", ")}`
    )
  if (!/^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/.test(endpoint))
    throw new Error(
      "WHYFULL_AZURE_SIGNING_ENDPOINT must look like https://<region>.codesigning.azure.net"
    )
  // Object notation, so no value is split on whitespace.
  return {
    cmd: "artifact-signing-cli",
    args: ["-e", endpoint, "-a", account, "-c", profile, "-d", "Whyfull", "%1"],
  }
}

export function configure({
  release = false,
  preview,
  updater = true,
  buildOnly = false,
  windowsSigning = false,
} = {}) {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url))
  )
  preview ??= version.includes("-")
  // Only build-only CI runs may produce a stable-version build without updates.
  if (release)
    releaseInfo({
      version,
      channel: preview ? "preview" : "stable",
      buildOnly,
      updater: updater ? "auto" : "off",
    })
  const config = {
    version,
    bundle: {
      externalBin: [
        "binaries/whyfull-node",
        ...(["darwin", "linux"].includes(process.platform)
          ? ["binaries/whyfull-crawler"]
          : []),
      ],
    },
  }
  if (windowsSigning) {
    if (process.platform !== "win32")
      throw new Error("Windows signing is configured only on Windows runners")
    config.bundle.windows = { signCommand: windowsSignCommand() }
  }
  // Preview builds never follow the stable updater feed.
  const publicKey =
    preview || !updater
      ? undefined
      : process.env.WHYFULL_UPDATER_PUBLIC_KEY?.trim()
  if (publicKey) {
    config.bundle = { ...config.bundle, createUpdaterArtifacts: true }
    config.plugins = {
      updater: {
        pubkey: publicKey,
        endpoints: [
          "https://github.com/iplanwebsites/whyfull/releases/latest/download/latest.json",
        ],
      },
    }
  }
  if (
    release &&
    !preview &&
    updater &&
    (!publicKey || !process.env.TAURI_SIGNING_PRIVATE_KEY)
  ) {
    throw new Error(
      "Release builds require WHYFULL_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY"
    )
  }
  if (
    !buildOnly &&
    process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME !== `v${version}`
  ) {
    throw new Error(`Release tag must match the desktop version: v${version}`)
  }
  writeFileSync(
    new URL("../src-tauri/version.conf.json", import.meta.url),
    JSON.stringify(config, null, 2)
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  configure({
    release: process.argv.includes("--release"),
    preview: process.argv.includes("--preview") || undefined,
    updater: !process.argv.includes("--no-updater"),
    buildOnly: process.argv.includes("--build-only"),
    windowsSigning: process.argv.includes("--windows-signing"),
  })
