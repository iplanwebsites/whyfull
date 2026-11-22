/**
 * The desktop app activates `whyfull://activate` links natively, then tells
 * the viewer with a `whyfull-license` event. It also leaves the result on
 * `window.__whyfullLicense` in case the viewer had not mounted yet.
 */
export const LICENSE_EVENT = "whyfull-license"
export const SUCCESS_MESSAGE = "Thanks for supporting Whyfull!"

export interface LicenseEventDetail {
  ok: boolean
  message: string
}

export function licenseEventDetail(value: unknown): LicenseEventDetail | null {
  if (!value || typeof value !== "object") return null
  const { ok, message } = value as Record<string, unknown>
  if (typeof ok !== "boolean") return null
  return {
    ok,
    message:
      typeof message === "string" && message.trim()
        ? message.slice(0, 500)
        : ok
          ? SUCCESS_MESSAGE
          : "Whyfull could not activate this license.",
  }
}

type Target = Pick<Window, "addEventListener" | "removeEventListener"> & {
  __whyfullLicense?: unknown
}

/** Calls `handle` for each activation result, including one sent before this. */
export function listenForLicense(
  target: Target,
  handle: (detail: LicenseEventDetail) => void
) {
  const take = (value: unknown) => {
    delete target.__whyfullLicense
    const detail = licenseEventDetail(value)
    if (detail) handle(detail)
  }
  const listener = (event: Event) => take((event as CustomEvent).detail)
  target.addEventListener(LICENSE_EVENT, listener)
  if (target.__whyfullLicense !== undefined) take(target.__whyfullLicense)
  return () => target.removeEventListener(LICENSE_EVENT, listener)
}
