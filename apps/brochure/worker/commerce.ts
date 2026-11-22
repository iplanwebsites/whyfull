// Purchase → signed license key → delivery. See docs/commerce.md.
import {
  activeLicensesFor,
  allow,
  checkSale,
  issueLicense,
  licenseBySession,
  markEmailed,
  markRefunded,
  normalizeEmail,
  pruneRateLimits,
  type D1Database,
  type LicenseRow,
  type Signer,
} from "./licenses.ts"
import {
  createCheckoutSession,
  idOf,
  retrieveCheckoutSession,
  SESSION_ID_PATTERN,
  verifyStripeSignature,
  type CheckoutSession,
} from "./stripe.ts"
import {
  purchaseEmail,
  recoveryEmail,
  sendEmail,
  type EmailConfig,
} from "./email.ts"

export interface CommerceEnv {
  /** Secret. Stripe API key (sk_live_… / sk_test_…, or a restricted key). */
  STRIPE_SECRET_KEY?: string
  /** Secret. Signing secret of the webhook endpoint (whsec_…). */
  STRIPE_WEBHOOK_SECRET?: string
  /** Var. The one-time $19 Price (price_…). */
  STRIPE_PRICE_ID?: string
  /** Var. "true" enables Stripe Tax on Checkout. */
  STRIPE_AUTOMATIC_TAX?: string
  /** Secret. Ed25519 PKCS#8 PEM or base64 DER. */
  LICENSE_PRIVATE_KEY?: string
  /** Var, tests only. Overrides the public key the app ships with. */
  LICENSE_PUBLIC_KEY?: string
  /** Secret. Resend API key. */
  RESEND_API_KEY?: string
  /** Var. e.g. "Whyfull <licenses@whyfull.app>" on a verified domain. */
  EMAIL_FROM?: string
  /** Var. Reply-to and the contact shown when email isn't configured. */
  SUPPORT_EMAIL?: string
  LICENSES?: D1Database
}

type Context = { waitUntil(promise: Promise<unknown>): void }

const WEBHOOK_MAX_BYTES = 256 * 1024
const FORM_MAX_BYTES = 2048

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  })

const methodNotAllowed = (allow: string) =>
  new Response(null, {
    status: 405,
    headers: { Allow: allow, "Cache-Control": "no-store" },
  })

function redirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}

const signer = (env: CommerceEnv): Signer | null =>
  env.LICENSE_PRIVATE_KEY
    ? {
        privateKey: env.LICENSE_PRIVATE_KEY,
        publicKey: env.LICENSE_PUBLIC_KEY,
      }
    : null

const emailConfig = (env: CommerceEnv): EmailConfig | null =>
  env.RESEND_API_KEY && env.EMAIL_FROM
    ? {
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
        replyTo: normalizeEmail(env.SUPPORT_EMAIL) ?? undefined,
      }
    : null

const clientIp = (request: Request) =>
  request.headers.get("CF-Connecting-IP") ?? "unknown"

const logError = (where: string, error: unknown) =>
  // Messages are our own ("Stripe returned 500"), never request data.
  console.error(`${where}: ${error instanceof Error ? error.message : "error"}`)

/** Response for the commerce routes, or null for everything else. */
export async function handleCommerce(
  request: Request,
  env: CommerceEnv,
  url: URL,
  context: Context
): Promise<Response | null> {
  switch (url.pathname) {
    case "/buy":
    case "/buy/":
      if (request.method !== "GET" && request.method !== "HEAD")
        return methodNotAllowed("GET, HEAD")
      return buy(request, env, url)
    case "/api/stripe/webhook":
      if (request.method !== "POST") return methodNotAllowed("POST")
      return webhook(request, env)
    case "/api/license":
      if (request.method !== "GET") return methodNotAllowed("GET")
      return license(request, env, url)
    case "/api/recover":
      if (request.method !== "POST") return methodNotAllowed("POST")
      return recover(request, env, url, context)
  }
  return null
}

/** Add privacy headers to the static pages that display keys. */
export function protectKeyPage(pathname: string, response: Response) {
  if (!["/thanks/", "/activate/", "/recover/"].includes(pathname))
    return response
  const headers = new Headers(response.headers)
  headers.set("Referrer-Policy", "no-referrer")
  headers.set("X-Robots-Tag", "noindex")
  headers.set("X-Content-Type-Options", "nosniff")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function buy(request: Request, env: CommerceEnv, url: URL) {
  // The desktop app links here, so checkout can change without an app update.
  // Without Stripe configured, buyers land on the download page as before.
  const fallback = `${url.origin}/download/`
  if (!env.STRIPE_SECRET_KEY || !/^price_\w+$/.test(env.STRIPE_PRICE_ID ?? ""))
    return redirect(fallback)
  // Don't create sessions for HEAD probes or link previews.
  if (request.method === "HEAD") return redirect(fallback)
  try {
    const session = await createCheckoutSession({
      secret: env.STRIPE_SECRET_KEY,
      priceId: env.STRIPE_PRICE_ID!,
      origin: url.origin,
      automaticTax: env.STRIPE_AUTOMATIC_TAX === "true",
    })
    return redirect(session.url)
  } catch (error) {
    logError("checkout", error)
    return redirect(fallback)
  }
}

async function readLimited(request: Request, limit: number) {
  const declared = Number(request.headers.get("Content-Length") ?? 0)
  if (declared > limit) return null
  const body = await request.arrayBuffer()
  if (body.byteLength > limit) return null
  return new TextDecoder().decode(body)
}

interface StripeEvent {
  id?: string
  type?: string
  data?: { object?: Record<string, unknown> }
}

async function deliver(env: CommerceEnv, license: LicenseRow) {
  const config = emailConfig(env)
  if (!config || license.emailed_at || !env.LICENSES) return
  await sendEmail(config, purchaseEmail(license))
  await markEmailed(env.LICENSES, license.id)
}

async function webhook(request: Request, env: CommerceEnv) {
  if (!env.STRIPE_WEBHOOK_SECRET)
    return json({ error: "Webhook not configured" }, 503)
  const raw = await readLimited(request, WEBHOOK_MAX_BYTES)
  if (raw === null) return json({ error: "Payload too large" }, 413)
  const valid = await verifyStripeSignature(
    request.headers.get("Stripe-Signature"),
    raw,
    env.STRIPE_WEBHOOK_SECRET
  )
  if (!valid) return json({ error: "Invalid signature" }, 400)
  let event: StripeEvent
  try {
    event = JSON.parse(raw)
  } catch {
    return json({ error: "Invalid payload" }, 400)
  }
  const object = event.data?.object
  try {
    if (
      (event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded") &&
      object
    ) {
      const session = object as unknown as CheckoutSession
      // Other products on the same Stripe account, or a session still
      // waiting on a delayed payment method: acknowledge and wait.
      if (!checkSale(session).ok) return json({ received: true })
      const keys = signer(env)
      if (!keys || !env.LICENSES) return json({ error: "Not configured" }, 503)
      const { license } = await issueLicense(env.LICENSES, session, keys)
      // A failed send returns 500 so Stripe retries; the license already
      // exists, so a retry only re-attempts the email.
      await deliver(env, license)
    } else if (event.type === "charge.refunded" && object) {
      // Only full refunds are recorded. The app is offline, so nothing is
      // revoked; the key just stops being offered by /recover/.
      const paymentIntent = idOf(
        object.payment_intent as string | { id: string } | null
      )
      if (object.refunded === true && paymentIntent && env.LICENSES)
        await markRefunded(env.LICENSES, paymentIntent)
    }
  } catch (error) {
    logError(`webhook ${event.type ?? "event"}`, error)
    return json({ error: "Processing failed" }, 500)
  }
  return json({ received: true })
}

async function license(request: Request, env: CommerceEnv, url: URL) {
  const sessionId = url.searchParams.get("session_id") ?? ""
  if (!SESSION_ID_PATTERN.test(sessionId))
    return json({ status: "invalid" }, 400)
  const keys = signer(env)
  if (!env.STRIPE_SECRET_KEY || !keys || !env.LICENSES)
    return json({ status: "unavailable" }, 503)
  if (!(await allow(env.LICENSES, `license:${clientIp(request)}`, 60, 600)))
    return json({ status: "rate-limited" }, 429, { "Retry-After": "60" })
  const ready = (row: LicenseRow) =>
    row.refunded_at
      ? json({ status: "refunded" }, 410)
      : json({
          status: "ready",
          key: row.key,
          licenseId: row.id,
          name: row.name,
          emailed: !!row.emailed_at,
        })
  try {
    // Already issued: the session id was validated with Stripe back then.
    const stored = await licenseBySession(env.LICENSES, sessionId)
    if (stored) return ready(stored)
    const session = await retrieveCheckoutSession(
      env.STRIPE_SECRET_KEY,
      sessionId
    )
    if (!session) return json({ status: "invalid" }, 404)
    const check = checkSale(session)
    if (!check.ok)
      return check.reason === "pending" || check.reason === "open"
        ? json({ status: check.reason }, 202)
        : json({ status: "invalid" }, 404)
    // Issue now if the webhook hasn't arrived yet, so the buyer never waits.
    // The webhook sends the email whenever it lands.
    const { license } = await issueLicense(env.LICENSES, session, keys)
    return ready(license)
  } catch (error) {
    logError("license", error)
    return json({ status: "error" }, 502)
  }
}

async function recover(
  request: Request,
  env: CommerceEnv,
  url: URL,
  context: Context
) {
  const origin = request.headers.get("Origin")
  if (origin && origin !== url.origin) return json({ status: "forbidden" }, 403)
  const raw = await readLimited(request, FORM_MAX_BYTES)
  if (raw === null) return json({ status: "invalid" }, 413)
  let email: string | null = null
  try {
    const type = request.headers.get("Content-Type") ?? ""
    email = normalizeEmail(
      type.startsWith("application/json")
        ? JSON.parse(raw)?.email
        : new URLSearchParams(raw).get("email")
    )
  } catch {
    email = null
  }
  if (!email) return json({ status: "invalid" }, 400)
  const config = emailConfig(env)
  if (!config || !env.LICENSES)
    return json(
      {
        status: "unavailable",
        support: normalizeEmail(env.SUPPORT_EMAIL) ?? null,
      },
      503
    )
  const db = env.LICENSES
  const [byIp, byEmail] = await Promise.all([
    allow(db, `recover-ip:${clientIp(request)}`, 5, 3600),
    allow(db, `recover-email:${email}`, 3, 3600),
  ])
  if (!byIp || !byEmail)
    return json({ status: "rate-limited" }, 429, { "Retry-After": "3600" })
  // Look up and send after responding, so neither the answer nor its timing
  // reveals whether an address bought a license.
  context.waitUntil(
    (async () => {
      try {
        const licenses = await activeLicensesFor(db, email)
        if (licenses.length)
          await sendEmail(config, recoveryEmail(email, licenses))
        await pruneRateLimits(db)
      } catch (error) {
        logError("recover", error)
      }
    })()
  )
  return json({ status: "sent" }, 202)
}
