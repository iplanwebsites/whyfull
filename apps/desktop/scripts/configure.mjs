import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { releaseInfo } from "./release-info.mjs"

export function configure({ release = false, preview } = {}) {
  const { version } = JSON.parse(
    readFileSync(
      new URL("../../../packages/whyfull/package.json", import.meta.url)
    )
  )
  preview ??= version.includes("-")
  if (release) releaseInfo({ version, channel: preview ? "preview" : "stable" })
  const config = { version }
  // Preview builds never follow the stable updater feed.
  const publicKey = preview
    ? undefined
    : process.env.WHYFULL_UPDATER_PUBLIC_KEY?.trim()
  if (publicKey) {
    config.bundle = { createUpdaterArtifacts: true }
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
    (!publicKey || !process.env.TAURI_SIGNING_PRIVATE_KEY)
  ) {
    throw new Error(
      "Release builds require WHYFULL_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY"
    )
  }
  if (
    process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME !== `v${version}`
  ) {
    throw new Error(`Release tag must match the engine version: v${version}`)
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
  })
