import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, extname } from "node:path"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../../../", import.meta.url))
const source = join(root, "apps/web/dist/client")
const output = fileURLToPath(new URL("../dist/viewer/", import.meta.url))
try {
  await readFile(join(source, "index.html"))
} catch {
  throw new Error(
    "Build the viewer first: pnpm build (or pnpm --filter @whyfull/viewer build)"
  )
}
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(source, output, { recursive: true })
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
}
const assets = {}
async function walk(path, prefix = "") {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix + entry.name
    if (entry.isDirectory()) await walk(join(path, entry.name), name + "/")
    else if (!name.endsWith(".map"))
      assets[name === "index.html" ? "/" : "/" + name] = {
        file: name,
        type: types[extname(name)] ?? "application/octet-stream",
      }
  }
}
await walk(output)
await writeFile(join(output, "assets.json"), JSON.stringify(assets))
// Retain license texts of bundled dependencies without shipping node_modules.
const seen = new Set(),
  notices = []
async function licenses(require, name) {
  let path
  try {
    path = dirname(require.resolve(name + "/package.json"))
  } catch {
    try {
      let candidate = dirname(require.resolve(name))
      for (let i = 0; i < 8; i++, candidate = dirname(candidate)) {
        try {
          const meta = JSON.parse(
            await readFile(join(candidate, "package.json"), "utf8")
          )
          if (meta.name === name) {
            path = candidate
            break
          }
        } catch {}
      }
    } catch {}
  }
  if (!path || seen.has(path)) return
  seen.add(path)
  const meta = JSON.parse(await readFile(join(path, "package.json"), "utf8"))
  let heading = false
  for (const file of await readdir(path))
    if (/^(licen[cs]e|notice)(\.|$)/i.test(file)) {
      if (!heading) {
        notices.push(
          `===== ${name}@${meta.version} (${meta.license ?? "see below"}) =====`
        )
        heading = true
      }
      notices.push(await readFile(join(path, file), "utf8"))
    }
  const next = createRequire(join(path, "package.json"))
  for (const dependency of Object.keys(meta.dependencies ?? {}))
    await licenses(next, dependency)
}
for (const project of ["apps/web", "packages/ui"]) {
  const require = createRequire(join(root, project, "package.json"))
  const meta = JSON.parse(
    await readFile(join(root, project, "package.json"), "utf8")
  )
  for (const name of Object.keys(meta.dependencies))
    if (!name.startsWith("@workspace/")) await licenses(require, name)
}
await writeFile(join(output, "THIRD_PARTY.txt"), notices.join("\n\n"))
console.log(
  `Packaged ${Object.keys(assets).length} static viewer assets; no web server runtime.`
)
