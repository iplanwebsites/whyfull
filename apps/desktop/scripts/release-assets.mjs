// Collects one native build's release files under their final asset names, and
// later merges every platform's updater entries into a single latest.json.
// Each matrix job only uploads a workflow artifact; the finalize job is the only
// writer of the GitHub release, so platforms never race on latest.json.
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const repository = "iplanwebsites/whyfull"

// Updater targets are `{os}-{arch}` (the fallback) and `{os}-{arch}-{bundle}`,
// which tauri-plugin-updater 2.x tries first for the installed bundle type.
export function platformFiles({ version: v, platform, arch }) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) {
    const name = arch === "arm64" ? "aarch64" : "x64"
    const target = `darwin-${arch === "arm64" ? "aarch64" : "x86_64"}`
    return {
      installers: [[`dmg/Whyfull_${v}_${name}.dmg`]],
      updates: [
        {
          source: "macos/Whyfull.app.tar.gz",
          // Both Mac builds produce Whyfull.app.tar.gz; release assets need distinct names.
          name: `Whyfull_${v}_${name}.app.tar.gz`,
          targets: [target, `${target}-app`],
        },
      ],
      cli: `whyfull-${v}-darwin-${arch}.tar.gz`,
    }
  }
  if (platform === "win32" && arch === "x64")
    return {
      installers: [[`nsis/Whyfull_${v}_x64-setup.exe`]],
      updates: [
        {
          source: `nsis/Whyfull_${v}_x64-setup.exe`,
          targets: ["windows-x86_64", "windows-x86_64-nsis"],
        },
      ],
      cli: `whyfull-${v}-win32-x64.zip`,
    }
  if (platform === "linux" && arch === "x64")
    return {
      installers: [
        [`appimage/Whyfull_${v}_amd64.AppImage`],
        [`deb/Whyfull_${v}_amd64.deb`],
      ],
      updates: [
        {
          source: `appimage/Whyfull_${v}_amd64.AppImage`,
          targets: ["linux-x86_64", "linux-x86_64-appimage"],
        },
        {
          // A .deb install looks for this key first; without it the updater
          // would fall back to the AppImage and fail to install it.
          source: `deb/Whyfull_${v}_amd64.deb`,
          targets: ["linux-x86_64-deb"],
        },
      ],
      cli: `whyfull-${v}-linux-x64.tar.gz`,
    }
  throw new Error(`Unsupported release platform: ${platform}/${arch}`)
}

async function copyRequired(from, to) {
  const details = await stat(from).catch(() => null)
  if (!details?.isFile() || details.size <= 0)
    throw new Error(`Missing build output: ${from}`)
  await copyFile(from, to)
}

const basename = (path) => path.split("/").at(-1)

export async function collectAssets({
  bundleDir,
  distDir,
  outDir,
  version,
  platform = process.platform,
  arch = process.arch,
  updater,
}) {
  const files = platformFiles({ version, platform, arch })
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  for (const [source] of files.installers)
    await copyRequired(join(bundleDir, source), join(outDir, basename(source)))
  await copyRequired(join(distDir, files.cli), join(outDir, files.cli))
  if (!updater) return
  const platforms = {}
  for (const update of files.updates) {
    const name = update.name ?? basename(update.source)
    if (update.name)
      await copyRequired(join(bundleDir, update.source), join(outDir, name))
    const signature = (
      await readFile(join(bundleDir, `${update.source}.sig`), "utf8").catch(
        () => {
          throw new Error(`Missing updater signature: ${update.source}.sig`)
        }
      )
    ).trim()
    if (!signature) throw new Error(`Empty updater signature: ${name}`)
    await writeFile(join(outDir, `${name}.sig`), signature)
    for (const target of update.targets)
      platforms[target] = { signature, file: name }
  }
  await writeFile(
    join(outDir, `updater-${platform}-${arch}.json`),
    JSON.stringify({ version, platforms }, null, 2) + "\n"
  )
}

export async function createUpdaterManifest({
  directory,
  version,
  now = new Date(),
}) {
  const tag = `v${version}`
  const platforms = {}
  const fragments = (await readdir(directory)).filter((name) =>
    /^updater-.+\.json$/.test(name)
  )
  for (const fragment of fragments) {
    const entry = JSON.parse(await readFile(join(directory, fragment), "utf8"))
    if (entry.version !== version)
      throw new Error(`Updater fragment version mismatch: ${fragment}`)
    for (const [target, { signature, file }] of Object.entries(
      entry.platforms
    )) {
      if (platforms[target])
        throw new Error(`Duplicate updater platform: ${target}`)
      platforms[target] = {
        signature,
        url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(file)}`,
      }
    }
    await rm(join(directory, fragment))
  }
  const manifest = {
    version,
    notes: `https://github.com/${repository}/releases/tag/${tag}`,
    pub_date: now.toISOString(),
    platforms,
  }
  await writeFile(
    join(directory, "latest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  )
  return manifest
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, directory] = process.argv.slice(2)
  const desktop = fileURLToPath(new URL("../", import.meta.url))
  const { version } = JSON.parse(
    await readFile(join(desktop, "package.json"), "utf8")
  )
  if (command === "collect" && directory) {
    await collectAssets({
      bundleDir: join(desktop, "src-tauri/target/release/bundle"),
      distDir: join(desktop, "dist"),
      outDir: directory,
      version,
      updater: process.argv.includes("--updater"),
    })
    console.log((await readdir(directory)).join("\n"))
  } else if (command === "latest" && directory) {
    const { platforms } = await createUpdaterManifest({ directory, version })
    console.log(`latest.json: ${Object.keys(platforms).sort().join(", ")}`)
  } else {
    throw new Error(
      "Usage: node release-assets.mjs collect <out-dir> [--updater] | latest <release-dir>"
    )
  }
}
