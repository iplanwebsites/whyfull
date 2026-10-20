import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import {
  cp,
  mkdir,
  readFile,
  rm,
  chmod,
  writeFile,
  readdir,
} from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const desktop = fileURLToPath(new URL("../", import.meta.url))
const root = resolve(desktop, "../..")
const runtime = join(desktop, "src-tauri/runtime")
const pkg = JSON.parse(
  await readFile(join(root, "packages/whyfull/package.json"))
)
if (Number(process.versions.node.split(".")[0]) < 22)
  throw new Error("Desktop packaging requires Node.js 22 or newer")
await rm(runtime, { recursive: true, force: true })
await mkdir(join(runtime, "engine"), { recursive: true })
// Package the proven ESM build intact: import.meta.url assets and worker threads
// continue to resolve from disk, including diagnostic subprocesses.
await cp(
  join(root, "packages/whyfull/dist/viewer"),
  join(runtime, "engine/viewer"),
  {
    recursive: true,
  }
)
// Bundle runtime npm dependencies too; end users never need npm/node_modules.
await build({
  absWorkingDir: join(root, "packages/whyfull"),
  entryPoints: ["dist/cli.mjs", "dist/index.mjs", "dist/fs-worker.mjs"],
  outdir: join(runtime, "engine"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  splitting: true,
  // Dependencies that use require() need the native Node ESM bridge.
  banner: {
    js: 'import { createRequire as __whyfullCreateRequire } from "node:module"; const require = __whyfullCreateRequire(import.meta.url);',
  },
})
const nodeName = process.platform === "win32" ? "node.exe" : "node"
await cp(process.execPath, join(runtime, nodeName))
await chmod(join(runtime, nodeName), 0o755)
// Tauri signs externalBin executables along with the app. Keep the runtime
// copy only for the separate portable CLI archive, not in desktop resources.
const target = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
  /^host: (.+)$/m
)?.[1]
if (!target) throw new Error("Could not determine the Rust host target")
const binaries = join(desktop, "src-tauri/binaries")
await mkdir(binaries, { recursive: true })
const sidecar = join(
  binaries,
  `whyfull-node-${target}${process.platform === "win32" ? ".exe" : ""}`
)
await cp(process.execPath, sidecar)
await chmod(sidecar, 0o755)

await cp(
  join(desktop, "scripts/desktop-entry.mjs"),
  join(runtime, "desktop.mjs")
)
await cp(join(root, "LICENSE"), join(runtime, "LICENSE"))
await cp(join(root, "NOTICE"), join(runtime, "NOTICE"))
const notices = []
for (const name of Object.keys(pkg.dependencies)) {
  const directory = join(root, "packages/whyfull/node_modules", name)
  const meta = JSON.parse(await readFile(join(directory, "package.json")))
  notices.push(`===== ${name}@${meta.version} =====`)
  for (const file of await readdir(directory))
    if (/^(licen[cs]e|notice)(\.|$)/i.test(file))
      notices.push(await readFile(join(directory, file), "utf8"))
}
await writeFile(join(runtime, "ENGINE-THIRD-PARTY.txt"), notices.join("\n\n"))
// Node's binary contains third-party software, whose notices ship with it.
const nodeLicense = process.env.WHYFULL_NODE_LICENSE
  ? await readFile(process.env.WHYFULL_NODE_LICENSE)
  : await (async () => {
      const response = await fetch(
        `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`
      )
      if (!response.ok)
        throw new Error(`Node license fetch failed: ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    })()
await writeFile(join(runtime, "NODE-LICENSE"), nodeLicense)
await writeFile(
  join(runtime, "version.json"),
  JSON.stringify(
    {
      version: pkg.version,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2
  ) + "\n"
)
// A config overlay keeps every channel on the npm engine's version.
await writeFile(
  join(desktop, "src-tauri/version.conf.json"),
  JSON.stringify({ version: pkg.version })
)
console.log(
  `Prepared Whyfull ${pkg.version} with Node ${process.versions.node} (${process.platform}/${process.arch})`
)
