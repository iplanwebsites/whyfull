import { test } from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import worker from "../worker/index.ts"
import {
  LICENSE_PUBLIC_KEY,
  issueLicense,
  privateKeyDer,
  signLicenseKey,
} from "../worker/licenses.ts"
import {
  checkoutParameters,
  signStripePayload,
  verifyStripeSignature,
} from "../worker/stripe.ts"
import * as whyfull from "../../../packages/whyfull/dist/index.mjs"

// A throwaway key pair; the real private key is never read by tests.
const pair = generateKeyPairSync("ed25519")
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" })
const privateDer = pair.privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64")
const publicKey = pair.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64")
const webhookSecret = "whsec_test_secret"

/** D1-shaped wrapper over an in-memory SQLite database with the migrations. */
function fakeD1() {
  const db = new DatabaseSync(":memory:")
  db.exec(
    readFileSync(
      new URL("../migrations/0001_licenses.sql", import.meta.url),
      "utf8"
    )
  )
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () =>
      db.prepare(sql).get(...values.map((v) => v ?? null)) ?? null,
    run: async () => {
      const { changes } = db.prepare(sql).run(...values.map((v) => v ?? null))
      return { meta: { changes: Number(changes) } }
    },
    all: async () => ({
      results: db.prepare(sql).all(...values.map((v) => v ?? null)),
    }),
  })
  return { prepare: (sql) => statement(sql), sqlite: db }
}

function session(overrides = {}) {
  return {
    id: "cs_test_a1B2c3D4e5F6g7H8",
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    metadata: { product: "whyfull-desktop" },
    customer: "cus_123",
    customer_details: { email: "Ada@Example.com", name: "Card Holder" },
    custom_fields: [
      { key: "licensename", type: "text", text: { value: "  Ada Lovelace " } },
    ],
    payment_intent: "pi_123",
    amount_total: 1900,
    currency: "usd",
    ...overrides,
  }
}

function environment(overrides = {}) {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    DOWNLOADS: { head: async () => null, get: async () => null },
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_PRICE_ID: "price_123",
    LICENSE_PRIVATE_KEY: privatePem,
    LICENSE_PUBLIC_KEY: publicKey,
    RESEND_API_KEY: "re_test_123",
    EMAIL_FROM: "Whyfull <licenses@whyfull.app>",
    SUPPORT_EMAIL: "support@whyfull.app",
    LICENSES: fakeD1(),
    ...overrides,
  }
}

/** Route outbound fetches to handlers; record every call. */
async function withFetch(handlers, run) {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    for (const [prefix, handler] of Object.entries(handlers))
      if (url.startsWith(prefix)) return handler(url, init)
    throw new Error(`Unexpected fetch ${url}`)
  }
  try {
    return await run(calls)
  } finally {
    globalThis.fetch = real
  }
}

const resendOk = { "https://api.resend.com/": () => Response.json({ id: "e" }) }
const pending = []
const context = { waitUntil: (promise) => pending.push(promise) }

async function webhook(env, event, header) {
  const body = JSON.stringify(event)
  return worker.fetch(
    new Request("https://whyfull.app/api/stripe/webhook", {
      method: "POST",
      body,
      headers: {
        "Stripe-Signature":
          header ?? (await signStripePayload(body, webhookSecret)),
      },
    }),
    env,
    context
  )
}

test("webhook signatures: valid, wrong secret, stale, tampered, rolled", async () => {
  const body = '{"id":"evt_1"}'
  const now = Date.now()
  const t = Math.floor(now / 1000)
  const header = await signStripePayload(body, webhookSecret, t)
  assert.equal(
    await verifyStripeSignature(header, body, webhookSecret, now),
    true
  )
  assert.equal(
    await verifyStripeSignature(header, body, "whsec_other", now),
    false
  )
  assert.equal(
    await verifyStripeSignature(header, body, webhookSecret, now + 301_000),
    false
  )
  assert.equal(
    await verifyStripeSignature(header, `${body} `, webhookSecret, now),
    false
  )
  assert.equal(
    await verifyStripeSignature(null, body, webhookSecret, now),
    false
  )
  assert.equal(
    await verifyStripeSignature(`t=${t}`, body, webhookSecret, now),
    false
  )
  // While a secret rolls, Stripe sends one v1 per secret; any may match.
  const other = (await signStripePayload(body, "whsec_old", t)).split(",")[1]
  assert.equal(
    await verifyStripeSignature(
      `t=${t},${other},v0=abc,${header.split(",")[1]}`,
      body,
      webhookSecret,
      now
    ),
    true
  )
})

test("worker-issued keys verify with the app's verifyLicenseKey", async () => {
  assert.equal(LICENSE_PUBLIC_KEY, whyfull.LICENSE_PUBLIC_KEY)
  for (const secret of [
    privatePem,
    privateDer,
    privatePem.replace(/\n/g, "\\n"),
  ]) {
    const key = await signLicenseKey(
      {
        v: 1,
        product: "whyfull-desktop",
        id: "WF-TEST",
        name: "Zoë Ünicode",
        issued: "2026-11-22",
      },
      { privateKey: secret, publicKey }
    )
    assert.deepEqual(whyfull.verifyLicenseKey(key, publicKey), {
      v: 1,
      product: "whyfull-desktop",
      id: "WF-TEST",
      name: "Zoë Ünicode",
      issued: "2026-11-22",
    })
    assert.equal(
      whyfull.extractLicenseKey(`https://whyfull.app/activate#key=${key}`),
      key
    )
    // Signed by a key that isn't the shipped one: the app rejects it.
    assert.equal(whyfull.verifyLicenseKey(key), null)
  }
  // Without a name the field is omitted, as in scripts/license-issue.mjs.
  const unnamed = await signLicenseKey(
    { v: 1, product: "whyfull-desktop", id: "WF-2", issued: "2026-11-22" },
    { privateKey: privatePem, publicKey }
  )
  assert.equal("name" in whyfull.verifyLicenseKey(unnamed, publicKey), false)
})

test("a private key that doesn't match the public key refuses to issue", async () => {
  await assert.rejects(
    signLicenseKey(
      { v: 1, product: "whyfull-desktop", id: "WF-X", issued: "2026-11-22" },
      { privateKey: privatePem }
    ),
    /does not match/
  )
  assert.throws(() =>
    privateKeyDer(
      "-----BEGIN RSA PRIVATE KEY-----\nAA\n-----END RSA PRIVATE KEY-----"
    )
  )
})

test("issuing is idempotent per Checkout Session", async () => {
  const db = fakeD1()
  const signer = { privateKey: privatePem, publicKey }
  const results = await Promise.all([
    issueLicense(db, session(), signer),
    issueLicense(db, session(), signer),
    issueLicense(db, session(), signer),
  ])
  const ids = new Set(results.map((result) => result.license.id))
  assert.equal(ids.size, 1)
  assert.equal(results.filter((result) => result.created).length, 1)
  const rows = db.sqlite.prepare("SELECT * FROM licenses").all()
  assert.equal(rows.length, 1)
  const [row] = rows
  assert.match(row.id, /^WF-[0-9A-HJKMNP-TV-Z]{12}$/)
  assert.equal(row.email, "ada@example.com")
  assert.equal(row.name, "Ada Lovelace")
  assert.equal(row.amount, 1900)
  assert.equal(row.payment_intent, "pi_123")
  assert.equal(
    whyfull.verifyLicenseKey(row.key, publicKey).name,
    "Ada Lovelace"
  )
  await assert.rejects(
    issueLicense(
      db,
      session({ id: "cs_test_other00000", payment_status: "unpaid" }),
      signer
    )
  )
})

test("checkout.session.completed issues one license and emails it once", async () => {
  const env = environment()
  const event = {
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: session() },
  }
  await withFetch(resendOk, async (calls) => {
    assert.equal((await webhook(env, event)).status, 200)
    assert.equal((await webhook(env, event)).status, 200)
    const emails = calls.filter(({ url }) =>
      url.startsWith("https://api.resend.com/")
    )
    assert.equal(emails.length, 1)
    const message = JSON.parse(emails[0].init.body)
    const [row] = env.LICENSES.sqlite.prepare("SELECT * FROM licenses").all()
    assert.deepEqual(message.to, ["ada@example.com"])
    assert.ok(
      message.text.includes(`https://whyfull.app/activate#key=${row.key}`)
    )
    assert.ok(message.html.includes(row.key))
    assert.ok(message.text.includes("https://whyfull.app/recover/"))
    assert.equal(
      emails[0].init.headers["Idempotency-Key"],
      `whyfull-license/${row.id}`
    )
    assert.ok(row.emailed_at)
  })
})

test("webhook rejects bad signatures, oversized bodies, and ignores other events", async () => {
  const env = environment()
  const event = {
    type: "checkout.session.completed",
    data: { object: session() },
  }
  await withFetch({}, async (calls) => {
    assert.equal(
      (await webhook(env, event, "t=1,v1=" + "0".repeat(64))).status,
      400
    )
    const body = "x".repeat(300_000)
    const big = await worker.fetch(
      new Request("https://whyfull.app/api/stripe/webhook", {
        method: "POST",
        body,
        headers: {
          "Stripe-Signature": await signStripePayload(body, webhookSecret),
        },
      }),
      env,
      context
    )
    assert.equal(big.status, 413)
    assert.equal(
      (await webhook(env, { type: "invoice.paid", data: { object: {} } }))
        .status,
      200
    )
    // Another product on the same Stripe account, and an unpaid async session.
    const other = session({ metadata: { product: "something-else" } })
    assert.equal(
      (
        await webhook(env, {
          type: "checkout.session.completed",
          data: { object: other },
        })
      ).status,
      200
    )
    const unpaid = session({ payment_status: "unpaid" })
    assert.equal(
      (
        await webhook(env, {
          type: "checkout.session.completed",
          data: { object: unpaid },
        })
      ).status,
      200
    )
    assert.equal(calls.length, 0)
    assert.equal(
      env.LICENSES.sqlite.prepare("SELECT count(*) AS n FROM licenses").get().n,
      0
    )
  })
})

test("a failed email returns 500 so Stripe retries only the email", async () => {
  const env = environment()
  const event = {
    type: "checkout.session.async_payment_succeeded",
    data: { object: session() },
  }
  let fail = true
  await withFetch(
    {
      "https://api.resend.com/": () =>
        fail ? new Response(null, { status: 500 }) : Response.json({}),
    },
    async () => {
      assert.equal((await webhook(env, event)).status, 500)
      const [first] = env.LICENSES.sqlite
        .prepare("SELECT * FROM licenses")
        .all()
      assert.equal(first.emailed_at, null)
      fail = false
      assert.equal((await webhook(env, event)).status, 200)
      const rows = env.LICENSES.sqlite.prepare("SELECT * FROM licenses").all()
      assert.equal(rows.length, 1)
      assert.equal(rows[0].id, first.id)
      assert.ok(rows[0].emailed_at)
    }
  )
})

test("charge.refunded records full refunds", async () => {
  const env = environment()
  await withFetch(resendOk, async () => {
    await webhook(env, {
      type: "checkout.session.completed",
      data: { object: session() },
    })
    const partial = {
      object: "charge",
      payment_intent: "pi_123",
      refunded: false,
    }
    await webhook(env, { type: "charge.refunded", data: { object: partial } })
    const read = () =>
      env.LICENSES.sqlite.prepare("SELECT refunded_at FROM licenses").get()
    assert.equal(read().refunded_at, null)
    await webhook(env, {
      type: "charge.refunded",
      data: { object: { ...partial, refunded: true } },
    })
    assert.ok(read().refunded_at)
  })
})

test("/api/license issues before the webhook, then serves the stored key", async () => {
  const env = environment()
  let stripeCalls = 0
  const stripe = {
    "https://api.stripe.com/v1/checkout/sessions/": (url, init) => {
      stripeCalls++
      assert.equal(init.headers.Authorization, "Bearer sk_test_123")
      return url.endsWith("cs_test_a1B2c3D4e5F6g7H8")
        ? Response.json(session())
        : new Response("{}", { status: 404 })
    },
  }
  await withFetch(stripe, async (calls) => {
    const get = (id) =>
      worker.fetch(
        new Request(`https://whyfull.app/api/license?session_id=${id}`),
        env,
        context
      )
    const response = await get("cs_test_a1B2c3D4e5F6g7H8")
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
    const data = await response.json()
    assert.equal(data.status, "ready")
    assert.equal(data.name, "Ada Lovelace")
    assert.equal(
      whyfull.verifyLicenseKey(data.key, publicKey).id,
      data.licenseId
    )
    const again = await (await get("cs_test_a1B2c3D4e5F6g7H8")).json()
    assert.equal(again.key, data.key)
    assert.equal(stripeCalls, 1)
    assert.equal((await get("cs_test_unknown000000")).status, 404)
    assert.equal((await get("../../etc")).status, 400)
    assert.ok(!calls.some(({ url }) => url.includes("resend")))
    // The late webhook finds the license and only sends the email.
    await withFetch(resendOk, async (emails) => {
      await webhook(env, {
        type: "checkout.session.completed",
        data: { object: session() },
      })
      assert.equal(emails.length, 1)
      assert.equal(
        env.LICENSES.sqlite.prepare("SELECT count(*) AS n FROM licenses").get()
          .n,
        1
      )
    })
  })
})

test("/api/license reports pending async payments", async () => {
  const env = environment()
  await withFetch(
    {
      "https://api.stripe.com/": () =>
        Response.json(session({ payment_status: "unpaid" })),
    },
    async () => {
      const response = await worker.fetch(
        new Request(
          "https://whyfull.app/api/license?session_id=cs_test_a1B2c3D4e5F6g7H8"
        ),
        env,
        context
      )
      assert.equal(response.status, 202)
      assert.equal((await response.json()).status, "pending")
    }
  )
})

test("/buy/ creates a Checkout Session, or falls back to /download/", async () => {
  await withFetch(
    {
      "https://api.stripe.com/v1/checkout/sessions": (_url, init) => {
        const params = new URLSearchParams(init.body)
        assert.equal(params.get("mode"), "payment")
        assert.equal(params.get("line_items[0][price]"), "price_123")
        assert.equal(params.get("customer_creation"), "always")
        assert.equal(params.get("allow_promotion_codes"), "true")
        assert.equal(params.get("automatic_tax[enabled]"), "true")
        assert.equal(params.get("metadata[product]"), "whyfull-desktop")
        assert.equal(
          params.get("success_url"),
          "https://whyfull.app/thanks/?session_id={CHECKOUT_SESSION_ID}"
        )
        assert.equal(params.get("cancel_url"), "https://whyfull.app/download/")
        return Response.json({
          id: "cs_test_1",
          url: "https://checkout.stripe.com/c/pay/cs_test_1",
        })
      },
    },
    async () => {
      const response = await worker.fetch(
        new Request("https://whyfull.app/buy/"),
        environment({ STRIPE_AUTOMATIC_TAX: "true" }),
        context
      )
      assert.equal(response.status, 303)
      assert.equal(
        response.headers.get("Location"),
        "https://checkout.stripe.com/c/pay/cs_test_1"
      )
    }
  )
  const unconfigured = await worker.fetch(
    new Request("https://whyfull.app/buy"),
    environment({ STRIPE_SECRET_KEY: undefined }),
    context
  )
  assert.equal(
    unconfigured.headers.get("Location"),
    "https://whyfull.app/download/"
  )
  await withFetch(
    { "https://api.stripe.com/": () => new Response(null, { status: 500 }) },
    async () => {
      const failed = await worker.fetch(
        new Request("https://whyfull.app/buy/"),
        environment(),
        context
      )
      assert.equal(
        failed.headers.get("Location"),
        "https://whyfull.app/download/"
      )
    }
  )
  assert.equal(
    checkoutParameters({
      secret: "",
      priceId: "price_1",
      origin: "https://whyfull.app",
      automaticTax: false,
    }).get("automatic_tax[enabled]"),
    "false"
  )
  const managed = checkoutParameters({
    secret: "",
    priceId: "price_1",
    origin: "https://whyfull.app",
    automaticTax: true,
    managedPayments: true,
  })
  assert.equal(managed.get("managed_payments[enabled]"), "true")
  assert.equal(managed.has("automatic_tax[enabled]"), false)
})

test("/api/recover answers the same either way and rate limits", async () => {
  const env = environment()
  await withFetch(resendOk, async (calls) => {
    await webhook(env, {
      type: "checkout.session.completed",
      data: { object: session() },
    })
    calls.length = 0
    const recover = (email, headers = {}) =>
      worker.fetch(
        new Request("https://whyfull.app/api/recover", {
          method: "POST",
          body: JSON.stringify({ email }),
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "203.0.113.9",
            ...headers,
          },
        }),
        env,
        context
      )
    pending.length = 0
    const known = await recover("ADA@example.com")
    const unknown = await recover("nobody@example.com")
    assert.equal(known.status, 202)
    assert.equal(unknown.status, 202)
    assert.deepEqual(await known.json(), await unknown.json())
    await Promise.all(pending)
    assert.equal(calls.length, 1)
    const message = JSON.parse(calls[0].init.body)
    assert.deepEqual(message.to, ["ada@example.com"])
    assert.ok(
      message.text.includes("https://whyfull.app/activate#key=WHYFULL-")
    )
    assert.equal((await recover("not-an-email")).status, 400)
    assert.equal(
      (await recover("ada@example.com", { Origin: "https://evil.example" }))
        .status,
      403
    )
    // Per address: 3 per hour, whatever the IP.
    const from = (ip) => recover("ada@example.com", { "CF-Connecting-IP": ip })
    assert.equal((await from("198.51.100.1")).status, 202)
    assert.equal((await from("198.51.100.2")).status, 202)
    assert.equal((await from("198.51.100.3")).status, 429)
    // Per IP: 5 per hour. Invalid and cross-origin requests aren't counted.
    for (const n of [1, 2, 3])
      assert.equal((await recover(`x${n}@example.com`)).status, 202)
    assert.equal((await recover("x4@example.com")).status, 429)
    const stored = env.LICENSES.sqlite
      .prepare("SELECT bucket FROM rate_limits")
      .all()
    assert.ok(stored.every(({ bucket }) => /^[a-f0-9]{64}$/.test(bucket)))
  })
  const unavailable = await worker.fetch(
    new Request("https://whyfull.app/api/recover", {
      method: "POST",
      body: "email=ada%40example.com",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
    environment({ RESEND_API_KEY: undefined }),
    context
  )
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), {
    status: "unavailable",
    support: "support@whyfull.app",
  })
})

test("key pages get privacy headers", async () => {
  const response = await worker.fetch(
    new Request("https://whyfull.app/activate/"),
    environment(),
    context
  )
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer")
  assert.equal(await response.text(), "asset")
})
