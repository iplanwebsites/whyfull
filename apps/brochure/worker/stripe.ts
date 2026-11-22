// Minimal Stripe REST client and webhook verification. No SDK: the Worker
// only needs to create and read Checkout Sessions and to verify webhooks.
const api = "https://api.stripe.com/v1"
const encoder = new TextEncoder()

export const LICENSE_PRODUCT = "whyfull-desktop"
/** Stripe's default and recommended tolerance for webhook timestamps. */
export const WEBHOOK_TOLERANCE_SECONDS = 300
export const SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9]{8,240}$/

export interface CheckoutSession {
  id: string
  object?: string
  mode?: string
  status?: "open" | "complete" | "expired" | null
  payment_status?: "paid" | "unpaid" | "no_payment_required"
  metadata?: Record<string, string> | null
  customer?: string | { id: string } | null
  customer_details?: { email?: string | null; name?: string | null } | null
  customer_email?: string | null
  custom_fields?: {
    key: string
    type: string
    text?: { value?: string | null } | null
  }[]
  payment_intent?: string | { id: string } | null
  amount_total?: number | null
  currency?: string | null
}

export class StripeError extends Error {
  status: number
  constructor(status: number) {
    super(`Stripe returned ${status}`)
    this.status = status
  }
}

/** API version for requests that need one (Managed Payments needs a recent one). */
export const MANAGED_PAYMENTS_API_VERSION = "2026-04-22.dahlia"

async function stripe(
  secret: string,
  method: "GET" | "POST",
  path: string,
  body?: URLSearchParams,
  version?: string
): Promise<unknown> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(version ? { "Stripe-Version": version } : {}),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  // Only the status is surfaced; Stripe error bodies are never logged.
  if (!response.ok) throw new StripeError(response.status)
  return response.json()
}

export interface CheckoutOptions {
  secret: string
  priceId: string
  origin: string
  automaticTax: boolean
  /**
   * Stripe Managed Payments: Stripe is the merchant of record and handles
   * tax, receipts and the statement descriptor, so tax settings are omitted.
   */
  managedPayments?: boolean
}

/** Field key for the optional "name on license" input shown at checkout. */
export const NAME_FIELD = "licensename"

export function checkoutParameters(options: CheckoutOptions): URLSearchParams {
  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": options.priceId,
    "line_items[0][quantity]": "1",
    customer_creation: "always",
    allow_promotion_codes: "true",
    submit_type: "pay",
    // Stripe substitutes the literal {CHECKOUT_SESSION_ID} placeholder.
    success_url: `${options.origin}/thanks/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${options.origin}/download/`,
    "metadata[product]": LICENSE_PRODUCT,
    "payment_intent_data[metadata][product]": LICENSE_PRODUCT,
    "custom_fields[0][key]": NAME_FIELD,
    "custom_fields[0][type]": "text",
    "custom_fields[0][optional]": "true",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": "Name on license (optional)",
    "custom_fields[0][text][maximum_length]": "80",
    "custom_text[submit][message]":
      "Your license key appears right after payment and is emailed to you. One-time purchase, 30-day refunds. Terms: whyfull.app/legal/",
  })
  if (options.managedPayments) {
    params.set("managed_payments[enabled]", "true")
    // Managed Payments rejects custom_text (Stripe shows its own seller terms).
    params.delete("custom_text[submit][message]")
  } else
    params.set(
      "automatic_tax[enabled]",
      options.automaticTax ? "true" : "false"
    )
  return params
}

export async function createCheckoutSession(
  options: CheckoutOptions
): Promise<{ id: string; url: string }> {
  const session = (await stripe(
    options.secret,
    "POST",
    "/checkout/sessions",
    checkoutParameters(options),
    options.managedPayments ? MANAGED_PAYMENTS_API_VERSION : undefined
  )) as { id?: unknown; url?: unknown }
  if (
    typeof session.url !== "string" ||
    !session.url.startsWith("https://checkout.stripe.com/") ||
    typeof session.id !== "string"
  )
    throw new Error("Unexpected Checkout Session response")
  return { id: session.id, url: session.url }
}

/** Returns null when Stripe doesn't know the session. */
export async function retrieveCheckoutSession(
  secret: string,
  id: string
): Promise<CheckoutSession | null> {
  if (!SESSION_ID_PATTERN.test(id)) return null
  try {
    return (await stripe(
      secret,
      "GET",
      `/checkout/sessions/${encodeURIComponent(id)}`
    )) as CheckoutSession
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return null
    throw error
  }
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index++)
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

/**
 * Verify a `Stripe-Signature` header: HMAC-SHA256 over `${t}.${rawBody}`.
 * Any of several v1 signatures may match (Stripe sends more than one while a
 * secret is being rolled). WebCrypto's HMAC verify compares in constant time.
 */
export async function verifyStripeSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  now = Date.now(),
  tolerance = WEBHOOK_TOLERANCE_SECONDS
): Promise<boolean> {
  if (!header || !secret || header.length > 4096) return false
  let timestamp: number | undefined
  const signatures: Uint8Array<ArrayBuffer>[] = []
  for (const part of header.split(",")) {
    const separator = part.indexOf("=")
    if (separator < 1) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value)
    if (name === "v1") {
      const bytes = hexBytes(value)
      if (bytes) signatures.push(bytes)
    }
  }
  if (timestamp === undefined || signatures.length === 0) return false
  if (Math.abs(now / 1000 - timestamp) > tolerance) return false
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  const signed = encoder.encode(`${timestamp}.${rawBody}`)
  let valid = false
  for (const signature of signatures)
    // Check every candidate so timing doesn't depend on which one matched.
    if (await crypto.subtle.verify("HMAC", key, signature, signed)) valid = true
  return valid
}

/** Test helper and Stripe CLI-compatible header builder. */
export async function signStripePayload(
  rawBody: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000)
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestamp}.${rawBody}`)
    )
  )
  const hex = [...mac].map((byte) => byte.toString(16).padStart(2, "0"))
  return `t=${timestamp},v1=${hex.join("")}`
}

export const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null)
