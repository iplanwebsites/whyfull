// The release platform set: which native builds a release ships, the files and
// updater keys each contributes, and the join-but-never-leave rule for stable.
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const platforms = {
  "macos-arm64": {
    runner: "macos-15",
    bundles: "app",
    downloads: [
      ["desktop-macos-arm64", (v) => `Whyfull_${v}_aarch64.dmg`],
      ["cli-macos-arm64", (v) => `whyfull-${v}-darwin-arm64.tar.gz`],
    ],
    updaterTargets: [
      ["darwin-aarch64", (v) => `Whyfull_${v}_aarch64.app.tar.gz`],
      ["darwin-aarch64-app", (v) => `Whyfull_${v}_aarch64.app.tar.gz`],
    ],
  },
  "macos-x64": {
    // Native Intel runner: Rust host, the copied Node binary and the crawler
    // are all x86_64. Do not cross-build this from arm64.
    runner: "macos-15-intel",
    bundles: "app",
    downloads: [
      ["desktop-macos-x64", (v) => `Whyfull_${v}_x64.dmg`],
      ["cli-macos-x64", (v) => `whyfull-${v}-darwin-x64.tar.gz`],
    ],
    updaterTargets: [
      ["darwin-x86_64", (v) => `Whyfull_${v}_x64.app.tar.gz`],
      ["darwin-x86_64-app", (v) => `Whyfull_${v}_x64.app.tar.gz`],
    ],
  },
  "windows-x64": {
    runner: "windows-latest",
    bundles: "nsis",
    downloads: [
      ["desktop-windows-x64", (v) => `Whyfull_${v}_x64-setup.exe`],
      ["cli-windows-x64", (v) => `whyfull-${v}-win32-x64.zip`],
    ],
    updaterTargets: [
      ["windows-x86_64", (v) => `Whyfull_${v}_x64-setup.exe`],
      ["windows-x86_64-nsis", (v) => `Whyfull_${v}_x64-setup.exe`],
    ],
  },
  "linux-x64": {
    runner: "ubuntu-22.04",
    bundles: "appimage,deb",
    downloads: [
      ["desktop-linux-x64-appimage", (v) => `Whyfull_${v}_amd64.AppImage`],
      ["desktop-linux-x64-deb", (v) => `Whyfull_${v}_amd64.deb`],
      ["cli-linux-x64", (v) => `whyfull-${v}-linux-x64.tar.gz`],
    ],
    // A .deb install looks up `-deb` first; the bare key is the AppImage.
    updaterTargets: [
      ["linux-x86_64", (v) => `Whyfull_${v}_amd64.AppImage`],
      ["linux-x86_64-appimage", (v) => `Whyfull_${v}_amd64.AppImage`],
      ["linux-x86_64-deb", (v) => `Whyfull_${v}_amd64.deb`],
    ],
  },
}
export const allPlatforms = Object.keys(platforms)

export function parsePlatforms(list) {
  const names = Array.isArray(list)
    ? list
    : String(list ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
  if (!names.length) throw new Error("A release needs at least one platform")
  for (const name of names)
    if (!platforms[name]) throw new Error(`Unknown release platform: ${name}`)
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate release platform")
  // Keep a stable, canonical order for outputs and manifests.
  return allPlatforms.filter((name) => names.includes(name))
}

export function releasePlatforms(
  file = new URL("../release-platforms.json", import.meta.url)
) {
  return parsePlatforms(JSON.parse(readFileSync(file, "utf8")).platforms)
}

export const downloadsFor = (names) =>
  parsePlatforms(names).flatMap((name) => platforms[name].downloads)
export const updaterTargetsFor = (names) =>
  parsePlatforms(names).flatMap((name) => platforms[name].updaterTargets)

// Installed stable copies of a platform keep reading latest.json. Dropping a
// key leaves them without updates, so a platform can only join.
export function assertNoPlatformLeaves(previousLatest, names) {
  if (!previousLatest) return
  const next = new Set(updaterTargetsFor(names).map(([target]) => target))
  const missing = Object.keys(previousLatest.platforms ?? {}).filter(
    (target) => !next.has(target)
  )
  if (missing.length)
    throw new Error(
      `Platform would leave the stable channel (previous release ${previousLatest.version} served ${missing.join(", ")}). A platform can join stable but never leave it.`
    )
}

// The newest published stable release that carries an updater manifest. Older
// installs follow GitHub's Latest pointer, so that one's platforms must stay.
export async function previousStableLatest({
  repository,
  token,
  fetcher = fetch,
}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "whyfull-release",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/releases/latest`,
    { headers }
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Release lookup failed: ${response.status}`)
  const release = await response.json()
  const asset = release.assets?.find((entry) => entry.name === "latest.json")
  // Without latest.json, no installed copy can be following this release.
  if (!asset) return null
  const manifest = await fetcher(asset.browser_download_url, {
    headers: { "User-Agent": "whyfull-release" },
  })
  if (!manifest.ok)
    throw new Error(`Previous latest.json unavailable: ${manifest.status}`)
  return await manifest.json()
}

const families = [
  ["- macOS:", ["macos-arm64", "macos-x64"], "macOS"],
  ["- Windows:", ["windows-x64"], "Windows"],
  ["- Linux:", ["linux-x64"], "Linux"],
]

// Drops install instructions for platforms this release does not ship.
export function releaseNotes(template, names) {
  names = parsePlatforms(names)
  const absent = families
    .filter(([, members]) => !members.some((name) => names.includes(name)))
    .map(([, , label]) => label)
  const lines = template
    .split("\n")
    .filter(
      (line) =>
        !families.some(
          ([prefix, members]) =>
            line.startsWith(prefix) &&
            !members.some((name) => names.includes(name))
        )
    )
  let notes = lines.join("\n").trimEnd() + "\n"
  if (absent.length)
    notes += `\n${absent.join(" and ")} ${absent.length > 1 ? "builds are" : "build is"} not part of this release yet and will follow in a later version.\n`
  return notes
}

export function buildMatrix(names) {
  return {
    include: parsePlatforms(names).map((name) => ({
      name,
      os: platforms[name].runner,
      bundles: platforms[name].bundles,
    })),
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, argument] = process.argv.slice(2)
  if (command === "outputs") {
    // `outputs all` builds every platform (build-only runs); otherwise the committed set.
    const names = argument === "all" ? allPlatforms : releasePlatforms()
    console.log(`platforms=${names.join(",")}`)
    console.log(`matrix=${JSON.stringify(buildMatrix(names))}`)
  } else if (command === "continuity") {
    // continuity <previous-latest.json> <platforms>; the file may hold null.
    const previous = JSON.parse(readFileSync(argument, "utf8"))
    assertNoPlatformLeaves(previous, process.argv[4])
    console.log(
      previous
        ? `Stable ${previous.version} platforms are all still shipped`
        : "No previous stable updater manifest; any platform may join"
    )
  } else if (command === "previous") {
    // previous <out-file>: writes the previous stable latest.json, or "null".
    const previous = await previousStableLatest({
      repository: process.env.GITHUB_REPOSITORY || "iplanwebsites/whyfull",
      token: process.env.GH_TOKEN,
    })
    writeFileSync(argument, JSON.stringify(previous))
    console.log(
      previous
        ? `Previous stable ${previous.version}: ${Object.keys(previous.platforms ?? {}).join(", ")}`
        : "No previous stable release with latest.json"
    )
  } else if (command === "notes") {
    // notes <template> <platforms> → stdout
    process.stdout.write(
      releaseNotes(readFileSync(argument, "utf8"), process.argv[4])
    )
  } else {
    throw new Error(
      "Usage: node release-platforms.mjs outputs [all] | previous <out-file> | continuity <previous-latest.json> <platforms> | notes <template> <platforms>"
    )
  }
}
