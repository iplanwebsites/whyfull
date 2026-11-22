#!/usr/bin/env node

// Inspect the Git index: ignore rules alone do not protect already tracked files.
// Report paths only, so a failed check never copies credentials into CI logs.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const root = new URL("../", import.meta.url)
const git = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch {
    // Child-process errors can contain captured file bytes. Never log them.
    console.error("Unable to inspect Git index; signing material check failed.")
    process.exit(1)
  }
}
const packageMode = process.argv.includes("--package")
let paths
if (packageMode) {
  // npm's files allowlist can override root .npmignore patterns. Check the
  // actual publish list with lifecycle scripts disabled to avoid recursion.
  const windows = process.platform === "win32"
  const args = ["pack", "--dry-run", "--ignore-scripts", "--json"]
  if (windows)
    args.unshift(
      join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
    )
  let output
  try {
    output = execFileSync(windows ? process.execPath : "npm", args, {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch {
    console.error(
      "Unable to inspect npm publish list; signing material check failed."
    )
    process.exit(1)
  }
  paths = JSON.parse(output)[0].files.map(({ path }) => path)
} else {
  paths = git(["ls-files", "-z"]).toString().split("\0").filter(Boolean)
}
const privatePath =
  /\.(?:pem|key|p8|p12|pfx|keystore|jks|keychain(?:-db)?|mobileprovision|provisionprofile)$/i
const privateDirectory = /(?:^|\/)(?:\.credentials|\.signing)\//i
const privateKey =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|untrusted comment: [^\r\n]*(?:secret|private) key/i
const failures = []

for (const path of paths) {
  if (privatePath.test(path) || privateDirectory.test(path)) {
    failures.push(path)
    continue
  }
  // Read staged bytes, including binary files, without printing their contents.
  const contents = packageMode
    ? readFileSync(path, "utf8")
    : git(["show", `:${path}`]).toString()
  if (privateKey.test(contents)) failures.push(path)
}

if (failures.length) {
  console.error(
    "Signing material must stay outside public source and packages:"
  )
  for (const path of failures) console.error(`- ${path}`)
  process.exitCode = 1
} else {
  console.log(
    `Checked ${paths.length} ${packageMode ? "npm package" : "tracked"} files: no signing material found.`
  )
}
