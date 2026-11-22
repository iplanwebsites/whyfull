import {
  parseSettingsSection,
  type SettingsSection,
} from "./settings-navigation.ts"

/**
 * The desktop menu opens a Settings section with a `whyfull-settings` event
 * (`detail: { section }`). It also leaves the request on
 * `window.__whyfullSettings` in case the viewer had not mounted yet.
 */
export const SETTINGS_EVENT = "whyfull-settings"

type Target = Pick<Window, "addEventListener" | "removeEventListener"> & {
  __whyfullSettings?: unknown
}

export function settingsEventSection(
  value: unknown
): SettingsSection | undefined {
  if (!value || typeof value !== "object") return undefined
  return parseSettingsSection((value as Record<string, unknown>).section)
}

/** Calls `open` for each valid request, including one sent before this. */
export function listenForSettings(
  target: Target,
  open: (section: SettingsSection) => void
) {
  const take = (value: unknown) => {
    delete target.__whyfullSettings
    const section = settingsEventSection(value)
    if (section) open(section)
  }
  const listener = (event: Event) => take((event as CustomEvent).detail)
  target.addEventListener(SETTINGS_EVENT, listener)
  if (target.__whyfullSettings !== undefined) take(target.__whyfullSettings)
  return () => target.removeEventListener(SETTINGS_EVENT, listener)
}
