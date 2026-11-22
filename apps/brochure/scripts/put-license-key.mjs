#!/usr/bin/env node
// Upload the license signing key to the Worker as the LICENSE_PRIVATE_KEY secret.
//
//   pnpm --filter @whyfull/brochure secret:license
//
// Reads apps/brochure/.signing/whyfull-license-private.pem (git-ignored), or
// the file in WHYFULL_LICENSE_PRIVATE_KEY_FILE. Before uploading, it checks
// that the key matches the public key shipped in the app, so the site can
// never issue keys the app would reject. The key is passed to wrangler on
// stdin and never printed.
import { createPrivateKey, createPublicKey } from "node:crypto"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const brochure = fileURLToPath(new URL("..", import.meta.url))
const file =
  process.env.WHYFULL_LICENSE_PRIVATE_KEY_FILE ??
  fileURLToPath(
    new URL("../.signing/whyfull-license-private.pem", import.meta.url)
  )
const shipped = /LICENSE_PUBLIC_KEY\s*=\s*"([A-Za-z0-9+/=]+)"/.exec(
  readFileSync(
    new URL("../../../packages/whyfull/src/license.ts", import.meta.url),
    "utf8"
  )
)?.[1]
if (!shipped) throw new Error("Could not find LICENSE_PUBLIC_KEY in license.ts")

let pem
try {
  pem = readFileSync(file, "utf8")
} catch {
  console.error(`No signing key at ${file}`)
  process.exit(1)
}
const derived = createPublicKey(createPrivateKey(pem))
  .export({ type: "spki", format: "der" })
  .toString("base64")
if (derived !== shipped) {
  console.error(
    "This private key does not match the app's LICENSE_PUBLIC_KEY. Refusing to upload."
  )
  process.exit(1)
}

const result = spawnSync(
  "npx",
  ["wrangler", "secret", "put", "LICENSE_PRIVATE_KEY"],
  { cwd: brochure, input: pem, stdio: ["pipe", "inherit", "inherit"] }
)
process.exit(result.status ?? 1)
