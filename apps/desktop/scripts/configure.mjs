import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { releaseInfo } from "./release-info.mjs"

export function configure({
  release = false,
  preview,
  updater = true,
  buildOnly = false,
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
  })
