import { useSyncExternalStore } from "react"

export type Theme = "light" | "dark" | "system"

const KEY = "whyfull-theme"
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    if (value === "dark" || value === "system") return value
  } catch {}
  return "light"
}

let current: Theme = typeof window === "undefined" ? "light" : read()

function isDark(theme: Theme) {
  return (
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches)
  )
}

function apply() {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", isDark(current))
}

/** Applies at once and remembers locally, so it works while the viewer is offline. */
export function setTheme(theme: Theme) {
  if (theme === current) return apply()
  current = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {}
  apply()
  for (const listener of listeners) listener()
}

let unsaved = false
/** The viewer was offline when the theme changed; save it on reconnect. */
export function markThemeUnsaved() {
  unsaved = true
}
export function takeUnsavedTheme(): Theme | null {
  if (!unsaved) return null
  unsaved = false
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const media =
    typeof window === "undefined"
      ? null
      : matchMedia("(prefers-color-scheme: dark)")
  const onMedia = () => {
    apply()
    listener()
  }
  media?.addEventListener("change", onMedia)
  return () => {
    listeners.delete(listener)
    media?.removeEventListener("change", onMedia)
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => "light" as Theme
  )
  return { theme, dark: isDark(theme) }
}

if (typeof window !== "undefined") apply()
