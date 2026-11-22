// Transactional email through Resend or Mailjet. Keys and addresses are
// never logged; only the HTTP status of a failed send is.
import type { LicenseRow } from "./licenses.ts"

export const SITE = "https://whyfull.app"

export interface EmailConfig {
  provider: "resend" | "mailjet"
  apiKey: string
  /** Mailjet only: the API secret key. */
  apiSecret?: string
  /** "Name <address>" or a bare address; must be a verified sender. */
  from: string
  replyTo?: string
}

/** Split "Whyfull <licenses@whyfull.app>" into its name and address. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from)
  return match
    ? { ...(match[1] ? { name: match[1] } : {}), email: match[2] }
    : { email: from.trim() }
}

export interface Message {
  to: string
  subject: string
  text: string
  html: string
  /** Resend deduplicates sends with the same key for 24 hours. */
  idempotencyKey?: string
}

export const activationLink = (key: string) => `${SITE}/activate#key=${key}`

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!
  )

export async function sendEmail(config: EmailConfig, message: Message) {
  if (config.provider === "mailjet") return sendMailjet(config, message)
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(message.idempotencyKey
        ? { "Idempotency-Key": message.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from: config.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Email service returned ${response.status}`)
}

// Mailjet Send API v3.1. It has no idempotency key; the Worker records
// emailed_at so webhook retries don't resend.
async function sendMailjet(config: EmailConfig, message: Message) {
  const sender = parseSender(config.from)
  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.apiKey}:${config.apiSecret ?? ""}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Messages: [
        {
          From: {
            Email: sender.email,
            ...(sender.name ? { Name: sender.name } : {}),
          },
          To: [{ Email: message.to }],
          Subject: message.subject,
          TextPart: message.text,
          HTMLPart: message.html,
          ...(config.replyTo ? { ReplyTo: { Email: config.replyTo } } : {}),
          ...(message.idempotencyKey
            ? { CustomID: message.idempotencyKey.slice(0, 255) }
            : {}),
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Email service returned ${response.status}`)
}

function layout(paragraphs: string[]): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#faf9f2;color:#292b23;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6"><div style="max-width:560px;margin:0 auto">${paragraphs.join("")}</div></body></html>`
}
const p = (html: string) => `<p style="margin:0 0 16px">${html}</p>`
const link = (href: string, label: string) =>
  `<a href="${escape(href)}" style="color:#626d30">${escape(label)}</a>`
const keyBlock = (key: string) =>
  `<p style="margin:0 0 16px;padding:12px;background:#ffffff;border:1px solid #dedfd1;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;word-break:break-all">${escape(key)}</p>`

const steps =
  "In Whyfull, open the Whyfull menu → Support Whyfull…, paste the key (or the whole activation link), and choose Activate."

export function purchaseEmail(license: LicenseRow): Message {
  const greeting = license.name ? `Thank you, ${license.name}!` : "Thank you!"
  const activate = activationLink(license.key)
  const text = [
    `${greeting} Your Whyfull license is ready.`,
    "",
    "Open your license page on the computer where Whyfull is installed:",
    activate,
    "",
    "Or copy this key:",
    license.key,
    "",
    steps,
    "",
    `License ID: ${license.id}`,
    `Download Whyfull: ${SITE}/download/`,
    `Lost this email later? Get your key again: ${SITE}/recover/`,
    "",
    "Your payment receipt comes separately from Stripe. Refunds within 30 days, no questions asked: just reply to this email.",
    "",
    "Whyfull's source is public so you can see exactly what it does. Thanks for keeping it going.",
  ].join("\n")
  const html = layout([
    p(`${escape(greeting)} Your Whyfull license is ready.`),
    p(
      `${link(activate, "Open your license page")} on the computer where Whyfull is installed, or copy this key:`
    ),
    keyBlock(license.key),
    p(escape(steps)),
    p(
      `License ID: <strong>${escape(license.id)}</strong><br>${link(`${SITE}/download/`, "Download Whyfull")} · ${link(`${SITE}/recover/`, "Recover your key later")}`
    ),
    p(
      "Your payment receipt comes separately from Stripe. Refunds within 30 days, no questions asked: just reply to this email."
    ),
    p(
      "Whyfull’s source is public so you can see exactly what it does. Thanks for keeping it going."
    ),
  ])
  return {
    to: license.email,
    subject: "Your Whyfull license key",
    text,
    html,
    idempotencyKey: `whyfull-license/${license.id}`,
  }
}

export function recoveryEmail(email: string, licenses: LicenseRow[]): Message {
  const plural = licenses.length > 1
  const text = [
    `Here ${plural ? "are your Whyfull license keys" : "is your Whyfull license key"}, as requested.`,
    "",
    ...licenses.flatMap((license) => [
      `License ${license.id} (issued ${license.created_at.slice(0, 10)}${license.name ? `, licensed to ${license.name}` : ""})`,
      activationLink(license.key),
      license.key,
      "",
    ]),
    steps,
    "",
    "If you didn't ask for this, you can ignore this email.",
  ].join("\n")
  const html = layout([
    p(
      `Here ${plural ? "are your Whyfull license keys" : "is your Whyfull license key"}, as requested.`
    ),
    ...licenses.map(
      (license) =>
        p(
          `<strong>${escape(license.id)}</strong> · issued ${escape(license.created_at.slice(0, 10))}${license.name ? ` · licensed to ${escape(license.name)}` : ""}<br>${link(activationLink(license.key), "Open license page")}`
        ) + keyBlock(license.key)
    ),
    p(escape(steps)),
    p("If you didn’t ask for this, you can ignore this email."),
  ])
  return { to: email, subject: "Your Whyfull license", text, html }
}
