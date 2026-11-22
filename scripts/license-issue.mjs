#!/usr/bin/env node
// Issue a Whyfull desktop license key, signed offline with Ed25519.
//
//   node scripts/license-issue.mjs --id ORDER-123 [--name "Ada Lovelace"]
//
// The private key is read from WHYFULL_LICENSE_PRIVATE_KEY (PEM text) or the
// file in WHYFULL_LICENSE_PRIVATE_KEY_FILE (default
// .signing/whyfull-license-private.pem, which git ignores). Keep it in a
// password manager; anyone holding it can issue keys.
import { createPrivateKey, createPublicKey, sign } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    name: { type: "string" },
    "public-key": { type: "boolean" },
  },
})
const pem =
  process.env.WHYFULL_LICENSE_PRIVATE_KEY ??
  readFileSync(
    process.env.WHYFULL_LICENSE_PRIVATE_KEY_FILE ??
      new URL("../.signing/whyfull-license-private.pem", import.meta.url),
    "utf8"
  )
const privateKey = createPrivateKey(pem)
if (values["public-key"]) {
  // Paste this into LICENSE_PUBLIC_KEY in packages/whyfull/src/license.ts.
  console.log(
    createPublicKey(privateKey)
      .export({ type: "spki", format: "der" })
      .toString("base64")
  )
  process.exit(0)
}
if (!values.id) {
  console.error("Usage: license-issue.mjs --id <order id> [--name <holder>]")
  process.exit(2)
}
const payload = {
  v: 1,
  product: "whyfull-desktop",
  id: values.id,
  ...(values.name ? { name: values.name } : {}),
  issued: new Date().toISOString().slice(0, 10),
}
const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
const signature = sign(null, Buffer.from(body), privateKey).toString(
  "base64url"
)
console.log(`WHYFULL-${body}.${signature}`)
