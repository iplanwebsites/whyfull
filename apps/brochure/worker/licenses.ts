// License issuing: Ed25519 signing with WebCrypto and the D1 license table.
// The key format must match packages/whyfull/src/license.ts exactly:
//   WHYFULL-<base64url(JSON payload)>.<base64url(Ed25519(body ASCII))>
import {
  LICENSE_PRODUCT,
  NAME_FIELD,
  SESSION_ID_PATTERN,
  idOf,
  type CheckoutSession,
} from "./stripe.ts"

/** Same value as LICENSE_PUBLIC_KEY in packages/whyfull (a test checks it). */
export const LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEATucRFmGF0G2pU33ewdreRQnXreOatP4slaDMVNFJPuQ="
const PREFIX = "WHYFULL-"
const encoder = new TextEncoder()

export interface D1Result {
  meta?: { changes?: number }
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<D1Result>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface LicenseRow {
  id: string
  email: string
  name: string | null
  key: string
  stripe_session_id: string
  stripe_customer_id: string | null
  payment_intent: string | null
  amount: number | null
  currency: string | null
  created_at: string
  refunded_at: string | null
  emailed_at: string | null
}

export interface Signer {
  privateKey: string
  /** SPKI DER, base64. Defaults to the key the desktop app ships with. */
  publicKey?: string
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Accept a PKCS#8 PEM ("BEGIN PRIVATE KEY"), including one pasted with
 * literal "\n" escapes, or the same key as bare base64 DER.
 */
export function privateKeyDer(secret: string): Uint8Array<ArrayBuffer> {
  const text = secret.replace(/\\n/g, "\n").trim()
  let base64 = text
  if (text.includes("-----BEGIN")) {
    const match =
      /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(
        text
      )
    if (!match)
      throw new Error("LICENSE_PRIVATE_KEY must be a PKCS#8 PRIVATE KEY PEM")
    base64 = match[1]
  }
  base64 = base64.replace(/\s+/g, "")
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new Error("LICENSE_PRIVATE_KEY is not valid base64")
  return base64Bytes(base64)
}

const keyCache = new Map<string, Promise<[CryptoKey, CryptoKey]>>()
function keyPair(signer: Signer): Promise<[CryptoKey, CryptoKey]> {
  const publicKey = signer.publicKey || LICENSE_PUBLIC_KEY
  const cacheKey = `${signer.privateKey}\u0000${publicKey}`
  let pair = keyCache.get(cacheKey)
  if (!pair) {
    pair = Promise.all([
      crypto.subtle.importKey(
        "pkcs8",
        privateKeyDer(signer.privateKey),
        { name: "Ed25519" },
        false,
        ["sign"]
      ),
      crypto.subtle.importKey(
        "spki",
        base64Bytes(publicKey),
        { name: "Ed25519" },
        false,
        ["verify"]
      ),
    ])
    pair.catch(() => keyCache.delete(cacheKey))
    keyCache.set(cacheKey, pair)
  }
  return pair
}

export interface LicensePayload {
  v: 1
  product: typeof LICENSE_PRODUCT
  id: string
  name?: string
  issued: string
}

/**
 * Sign a key, then verify it against the public key the app ships with, so a
 * misconfigured secret (say, a test key in production) fails loudly instead
 * of emailing keys the app would reject.
 */
export async function signLicenseKey(
  payload: LicensePayload,
  signer: Signer
): Promise<string> {
  const ordered: LicensePayload = {
    v: 1,
    product: LICENSE_PRODUCT,
    id: payload.id,
    ...(payload.name ? { name: payload.name } : {}),
    issued: payload.issued,
  }
  const body = base64url(encoder.encode(JSON.stringify(ordered)))
  const [privateKey, publicKey] = await keyPair(signer)
  const data = encoder.encode(body)
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, privateKey, data)
  )
  if (
    !(await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signature,
      data
    ))
  )
    throw new Error("LICENSE_PRIVATE_KEY does not match the license public key")
  return `${PREFIX}${body}.${base64url(signature)}`
}

// Crockford base32 without I, L, O, U: easy to read out in a support email.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export function newLicenseId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `WF-${[...bytes].map((byte) => alphabet[byte & 31]).join("")}`
}

export const EMAIL_PATTERN =
  /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,63}$/
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null
}

/** Printable, single-line, at most 80 characters, or undefined. */
export function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const name = value
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim()
  return name || undefined
}

export type SaleCheck =
  | { ok: true }
  | { ok: false; reason: "product" | "pending" | "open" | "expired" | "email" }

/** Whether a Checkout Session is a completed, paid Whyfull desktop purchase. */
export function checkSale(session: CheckoutSession): SaleCheck {
  if (
    !SESSION_ID_PATTERN.test(session.id ?? "") ||
    session.mode !== "payment" ||
    session.metadata?.product !== LICENSE_PRODUCT
  )
    return { ok: false, reason: "product" }
  if (session.status === "expired") return { ok: false, reason: "expired" }
  if (session.status !== "complete") return { ok: false, reason: "open" }
  // A 100% promotion code completes with no_payment_required.
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  )
    return { ok: false, reason: "pending" }
  if (
    !normalizeEmail(session.customer_details?.email ?? session.customer_email)
  )
    return { ok: false, reason: "email" }
  return { ok: true }
}

export function licenseBySession(db: D1Database, sessionId: string) {
  return db
    .prepare("SELECT * FROM licenses WHERE stripe_session_id = ?")
    .bind(sessionId)
    .first<LicenseRow>()
}

/**
 * Issue exactly one license per Checkout Session. Safe to call concurrently
 * from the webhook and the thanks page: the UNIQUE constraint on
 * stripe_session_id decides the winner and everyone returns the stored row.
 */
export async function issueLicense(
  db: D1Database,
  session: CheckoutSession,
  signer: Signer,
  now = new Date()
): Promise<{ license: LicenseRow; created: boolean }> {
  const existing = await licenseBySession(db, session.id)
  if (existing) return { license: existing, created: false }
  const check = checkSale(session)
  if (!check.ok) throw new Error(`Not a completed sale (${check.reason})`)
  const email = normalizeEmail(
    session.customer_details?.email ?? session.customer_email
  )!
  const name = cleanName(
    session.custom_fields?.find((field) => field.key === NAME_FIELD)?.text
      ?.value
  )
  let created = false
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const id = newLicenseId()
    const key = await signLicenseKey(
      {
        v: 1,
        product: LICENSE_PRODUCT,
        id,
        name,
        issued: now.toISOString().slice(0, 10),
      },
      signer
    )
    try {
      const result = await db
        .prepare(
          `INSERT INTO licenses (id, email, name, key, stripe_session_id,
             stripe_customer_id, payment_intent, amount, currency, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (stripe_session_id) DO NOTHING`
        )
        .bind(
          id,
          email,
          name ?? null,
          key,
          session.id,
          idOf(session.customer),
          idOf(session.payment_intent),
          Number.isSafeInteger(session.amount_total)
            ? session.amount_total
            : null,
          typeof session.currency === "string"
            ? session.currency.toLowerCase()
            : null,
          now.toISOString()
        )
        .run()
      created = result.meta?.changes === 1
      break
    } catch (error) {
      // Only a (vanishingly unlikely) license id collision is retried.
      if (!/UNIQUE|constraint/i.test(String(error)) || attempt === 2)
        throw error
    }
  }
  const license = await licenseBySession(db, session.id)
  if (!license) throw new Error("License was not stored")
  return { license, created }
}

export async function markEmailed(
  db: D1Database,
  id: string,
  now = new Date()
) {
  await db
    .prepare("UPDATE licenses SET emailed_at = ? WHERE id = ?")
    .bind(now.toISOString(), id)
    .run()
}

/** Record a full refund. The app works offline; this is bookkeeping only. */
export async function markRefunded(
  db: D1Database,
  paymentIntent: string,
  now = new Date()
): Promise<number> {
  const result = await db
    .prepare(
      "UPDATE licenses SET refunded_at = ? WHERE payment_intent = ? AND refunded_at IS NULL"
    )
    .bind(now.toISOString(), paymentIntent)
    .run()
  return result.meta?.changes ?? 0
}

export async function activeLicensesFor(db: D1Database, email: string) {
  const { results } = await db
    .prepare(
      "SELECT * FROM licenses WHERE email = ? AND refunded_at IS NULL ORDER BY created_at LIMIT 20"
    )
    .bind(email)
    .all<LicenseRow>()
  return results
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(text))
  )
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Fixed-window counter in D1. Buckets are hashed, so the table never holds a
 * raw IP address or email. Returns false once `limit` is exceeded.
 */
export async function allow(
  db: D1Database,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now = Date.now()
): Promise<boolean> {
  const seconds = Math.floor(now / 1000)
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END
       RETURNING count`
    )
    .bind(await sha256Hex(bucket), seconds + windowSeconds, seconds, seconds)
    .first<{ count: number }>()
  return (row?.count ?? 1) <= limit
}

export async function pruneRateLimits(db: D1Database, now = Date.now()) {
  await db
    .prepare("DELETE FROM rate_limits WHERE reset_at <= ?")
    .bind(Math.floor(now / 1000))
    .run()
}
