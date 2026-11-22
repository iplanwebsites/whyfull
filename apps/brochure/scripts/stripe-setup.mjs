#!/usr/bin/env node
// One-command Stripe setup for the website's license checkout.
//
//   pnpm stripe:setup --env staging --origin https://whyfull-brochure-staging.<you>.workers.dev
//   pnpm stripe:setup --env production --live      (real payments; see below)
//
// Reads Stripe secret keys from apps/brochure/.env.stripe (git-ignored):
//   STRIPE_SECRET_KEY_TEST=sk_test_…   used for --env staging
//   STRIPE_SECRET_KEY_LIVE=sk_live_…   used for --env production (needs --live)
// Then, idempotently:
//   1. finds or creates the "Whyfull Desktop License" product and its
//      $19 USD one-time price (lookup key whyfull_desktop_license_usd_19),
//   2. finds or creates the webhook endpoint <origin>/api/stripe/webhook for
//      the three events the Worker handles, keeping its signing secret in
//      .env.stripe (Stripe only reveals it at creation),
//   3. uploads STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID as
//      Worker secrets (staging also gets its own LICENSE_PRIVATE_KEY).
// No key or secret is ever printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    origin: { type: "string" },
    live: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
})
const target = values.env
if (target !== "staging" && target !== "production") {
  console.error(
    "Usage: stripe-setup.mjs --env staging|production [--origin URL] [--live]"
  )
  process.exit(2)
}
if (target === "production" && !values.live) {
  console.error(
    "Production uses the live key and takes real payments. Re-run with --live when the terms are final."
  )
  process.exit(2)
}
const origin = (
  values.origin ?? (target === "production" ? "https://whyfull.app" : "")
).replace(/\/$/, "")
if (!/^https:\/\/[a-z0-9.-]+$/.test(origin)) {
  console.error("--origin must be the site's https origin")
  process.exit(2)
}

const brochure = fileURLToPath(new URL("..", import.meta.url))
const envFile = fileURLToPath(new URL("../.env.stripe", import.meta.url))
const stored = Object.fromEntries(
  (existsSync(envFile) ? readFileSync(envFile, "utf8") : "")
    .split("\n")
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => [match[1], match[2]])
)
function remember(name, value) {
  stored[name] = value
  const lines = readFileSync(envFile, "utf8").split("\n")
  const index = lines.findIndex((line) => line.startsWith(`${name}=`))
  if (index >= 0) lines[index] = `${name}=${value}`
  else
    lines.splice(
      lines.length - (lines.at(-1) === "" ? 1 : 0),
      0,
      `${name}=${value}`
    )
  writeFileSync(envFile, lines.join("\n"), { mode: 0o600 })
}

const secretKey =
  target === "production"
    ? stored.STRIPE_SECRET_KEY_LIVE
    : stored.STRIPE_SECRET_KEY_TEST
const expectedPrefix = target === "production" ? "sk_live_" : "sk_test_"
if (!secretKey?.startsWith(expectedPrefix)) {
  console.error(`Missing ${expectedPrefix}… key for ${target} in ${envFile}`)
  process.exit(1)
}

async function stripe(method, path, form) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(
      `Stripe ${method} ${path}: ${body?.error?.message ?? response.status}`
    )
  return body
}

const LOOKUP_KEY = "whyfull_desktop_license_usd_19"
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
]

// 1. Product and price.
let price = (
  await stripe("GET", `/prices?active=true&lookup_keys[]=${LOOKUP_KEY}&limit=1`)
).data[0]
if (price) console.log(`Price: reusing ${price.id}`)
else if (values["dry-run"]) console.log("Price: would create $19 USD one-time")
else {
  const product = await stripe("POST", "/products", {
    name: "Whyfull Desktop License",
    description:
      "One-time license for the Whyfull desktop app: per person, all your computers, updates included.",
    "metadata[app]": "whyfull",
    "metadata[product]": "whyfull-desktop",
    url: "https://whyfull.app/",
  })
  price = await stripe("POST", "/prices", {
    product: product.id,
    currency: "usd",
    unit_amount: "1900",
    lookup_key: LOOKUP_KEY,
    "metadata[product]": "whyfull-desktop",
  })
  console.log(`Price: created ${price.id} for ${product.id}`)
}

// 2. Webhook endpoint.
const webhookUrl = `${origin}/api/stripe/webhook`
const secretName = `STRIPE_WEBHOOK_SECRET_${target.toUpperCase()}`
const endpoints = (await stripe("GET", "/webhook_endpoints?limit=100")).data
let endpoint = endpoints.find((item) => item.url === webhookUrl)
if (endpoint && !stored[secretName]) {
  // The signing secret can't be read back; replace the endpoint we can't use.
  if (!values["dry-run"])
    await stripe("DELETE", `/webhook_endpoints/${endpoint.id}`)
  console.log(`Webhook: replacing ${endpoint.id} (secret not on file)`)
  endpoint = undefined
}
if (endpoint) {
  const missing = EVENTS.filter(
    (event) => !endpoint.enabled_events.includes(event)
  )
  if (missing.length && !values["dry-run"])
    await stripe("POST", `/webhook_endpoints/${endpoint.id}`, {
      ...Object.fromEntries(
        EVENTS.map((event, i) => [`enabled_events[${i}]`, event])
      ),
    })
  console.log(`Webhook: reusing ${endpoint.id}`)
} else if (values["dry-run"]) console.log(`Webhook: would create ${webhookUrl}`)
else {
  endpoint = await stripe("POST", "/webhook_endpoints", {
    url: webhookUrl,
    description: `Whyfull license checkout (${target})`,
    "metadata[app]": "whyfull",
    ...Object.fromEntries(
      EVENTS.map((event, i) => [`enabled_events[${i}]`, event])
    ),
  })
  remember(secretName, endpoint.secret)
  console.log(`Webhook: created ${endpoint.id} → ${webhookUrl}`)
}
if (values["dry-run"]) process.exit(0)

// 3. Worker secrets.
function putSecret(name, value) {
  const args = ["wrangler", "secret", "put", name]
  if (target === "staging") args.push("--env", "staging")
  const result = spawnSync("npx", args, {
    cwd: brochure,
    input: value,
    stdio: ["pipe", "ignore", "inherit"],
  })
  if (result.status !== 0) throw new Error(`Uploading ${name} failed`)
  console.log(`Secret: ${name} uploaded`)
}
putSecret("STRIPE_SECRET_KEY", secretKey)
putSecret("STRIPE_WEBHOOK_SECRET", stored[secretName])
putSecret("STRIPE_PRICE_ID", price.id)
if (target === "staging")
  putSecret(
    "LICENSE_PRIVATE_KEY",
    readFileSync(
      new URL("../.signing/whyfull-license-staging.pem", import.meta.url),
      "utf8"
    )
  )
console.log(`Done. Buy at ${origin}/buy/`)
