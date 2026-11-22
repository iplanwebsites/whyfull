/**
 * Honor-system desktop license. Nothing here blocks a feature: the desktop app
 * shows an occasional reminder after its trial, and a signed key silences it.
 * Keys are verified offline with Ed25519; no request ever leaves the machine.
 * The CLI, npx, JSON reports, and agent output never read this state.
 */
import { createPublicKey, randomUUID, verify } from "node:crypto"
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { defaultPolicyPath } from "./disk-policy"
import type { LicenseView } from "./viewer-types"

export type { LicenseView }

/** Public half of the signing key. The private key never enters the repo. */
export const LICENSE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEATucRFmGF0G2pU33ewdreRQnXreOatP4slaDMVNFJPuQ="
export const LICENSE_PRODUCT = "whyfull-desktop"
export const TRIAL_DAYS = 30
export const LICENSE_PRICE = "$19"
/**
 * whyfull.app pages the desktop app may open. The webview can't navigate
 * off-origin, so it asks the local server to open one of these by name; no
 * other URL is ever opened through the license API.
 */
export const LICENSE_PAGES = {
  buy: "https://whyfull.app/buy/",
  recover: "https://whyfull.app/recover/",
  legal: "https://whyfull.app/legal/",
} as const
export type LicensePage = keyof typeof LICENSE_PAGES
export const CHECKOUT_URL = LICENSE_PAGES.buy

/** Resolve an allowlisted page name; anything else returns null. */
export function licensePageUrl(page: unknown): string | null {
  return typeof page === "string" && Object.hasOwn(LICENSE_PAGES, page)
    ? LICENSE_PAGES[page as LicensePage]
    : null
}

/**
 * One line for human-facing CLI output (help, terminal report, picker).
 * Never written to --json stdout or --json-file.
 */
export const CLI_LICENSE_NOTICE = `Free for command-line use · Desktop app: ${TRIAL_DAYS}-day trial, then ${LICENSE_PRICE} · Terms: ${LICENSE_PAGES.legal}`
const PREFIX = "WHYFULL-"
const KEY_PATTERN = /WHYFULL-[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{40,200}/

export interface LicensePayload {
  v: 1
  product: typeof LICENSE_PRODUCT
  /** Unique order or license id, for support lookups. */
  id: string
  /** Display name shown as "Licensed to …". Optional. */
  name?: string
  /** ISO date the key was issued. */
  issued: string
}

interface LicenseFile {
  firstUseDay: string | null
  lastUseDay: string | null
  usageDays: number
  lastReminderDay: string | null
  key: string | null
}

export interface LicenseOptions {
  /** config.json path; license.json lives beside it. */
  policyFile?: string
  publicKey?: string
  /** Injectable clock for tests. */
  clock?: () => Date
}

const empty = (): LicenseFile => ({
  firstUseDay: null,
  lastUseDay: null,
  usageDays: 0,
  lastReminderDay: null,
  key: null,
})

export const licensePath = (policyFile = defaultPolicyPath()) =>
  join(dirname(policyFile), "license.json")

/** Local calendar day, so a trial "day" matches the person's own clock. */
export function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const isDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)

function read(path: string): LicenseFile {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    // Missing or damaged: start fresh. Deleting the file resets the trial,
    // which is acceptable for an honor-system reminder.
    return empty()
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty()
  return {
    firstUseDay: isDay(raw.firstUseDay) ? raw.firstUseDay : null,
    lastUseDay: isDay(raw.lastUseDay) ? raw.lastUseDay : null,
    usageDays:
      Number.isInteger(raw.usageDays) && (raw.usageDays as number) >= 0
        ? Math.min(raw.usageDays as number, 100_000)
        : 0,
    lastReminderDay: isDay(raw.lastReminderDay) ? raw.lastReminderDay : null,
    key: typeof raw.key === "string" ? raw.key : null,
  }
}

function write(path: string, state: LicenseFile) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    })
    renameSync(temporary, path)
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      /* renamed */
    }
  }
}

/** Accept a bare key, or any pasted text containing one (such as an email link). */
export function extractLicenseKey(input: string): string | null {
  return KEY_PATTERN.exec(input.replace(/\s+/g, ""))?.[0] ?? null
}

export function verifyLicenseKey(
  key: string,
  publicKey = LICENSE_PUBLIC_KEY
): LicensePayload | null {
  if (!key.startsWith(PREFIX)) return null
  const [body, signature, extra] = key.slice(PREFIX.length).split(".")
  if (!body || !signature || extra !== undefined) return null
  try {
    const valid = verify(
      null,
      Buffer.from(body),
      createPublicKey({
        key: Buffer.from(publicKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(signature, "base64url")
    )
    if (!valid) return null
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    if (
      payload?.v !== 1 ||
      payload.product !== LICENSE_PRODUCT ||
      typeof payload.id !== "string" ||
      !payload.id ||
      typeof payload.issued !== "string" ||
      (payload.name !== undefined && typeof payload.name !== "string")
    )
      return null
    return payload as LicensePayload
  } catch {
    return null
  }
}

/** Shared by the issuing script and tests. */
export function encodeLicensePayload(payload: LicensePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url")
}

export class DesktopLicense {
  readonly path: string
  private readonly publicKey: string
  private readonly clock: () => Date

  constructor(options: LicenseOptions = {}) {
    this.path = licensePath(options.policyFile)
    this.publicKey = options.publicKey ?? LICENSE_PUBLIC_KEY
    this.clock = options.clock ?? (() => new Date())
  }

  /** Count today once. Call when the desktop app opens. */
  recordUse(): LicenseView {
    const state = read(this.path)
    const today = localDay(this.clock())
    if (state.lastUseDay !== today) {
      state.firstUseDay ??= today
      state.lastUseDay = today
      state.usageDays += 1
      try {
        write(this.path, state)
      } catch {
        /* A read-only config must never break the app. */
      }
    }
    return this.view(state)
  }

  status(): LicenseView {
    return this.view(read(this.path))
  }

  activate(input: string): LicenseView {
    const key = extractLicenseKey(String(input ?? ""))
    if (!key || !verifyLicenseKey(key, this.publicKey))
      throw new Error(
        "That doesn’t look like a valid Whyfull license key. Paste the whole key or the link from your purchase email."
      )
    const state = read(this.path)
    state.key = key
    write(this.path, state)
    return this.view(state)
  }

  deactivate(): LicenseView {
    const state = read(this.path)
    state.key = null
    write(this.path, state)
    return this.view(state)
  }

  /** The reminder was shown today; don't show it again until tomorrow. */
  reminded(): LicenseView {
    const state = read(this.path)
    state.lastReminderDay = localDay(this.clock())
    write(this.path, state)
    return this.view(state)
  }

  private view(state: LicenseFile): LicenseView {
    const payload = state.key
      ? verifyLicenseKey(state.key, this.publicKey)
      : null
    const today = localDay(this.clock())
    const trialRemaining = Math.max(0, TRIAL_DAYS - state.usageDays)
    return {
      enabled: true,
      licensed: !!payload,
      holder: payload?.name?.trim() || null,
      licenseId: payload?.id ?? null,
      trialDays: TRIAL_DAYS,
      usageDays: state.usageDays,
      trialRemaining,
      reminderDue:
        !payload && trialRemaining === 0 && state.lastReminderDay !== today,
      price: LICENSE_PRICE,
      checkoutUrl: CHECKOUT_URL,
    }
  }
}
