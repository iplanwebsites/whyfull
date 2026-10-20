import type {
  ViewerStatus,
  DirectoryView,
  ViewEntry,
  ViewerPreferences,
  TrashPlan,
  ScanDrive,
  WhyfullJsonReport,
} from "../../../../packages/whyfull/src/viewer-types"
export type {
  ViewerStatus,
  DirectoryView,
  ViewEntry,
  ViewerPreferences,
  TrashPlan,
  ScanDrive,
  WhyfullJsonReport,
}

let token = ""
export function initializeAuth() {
  if (typeof window === "undefined") return
  const fragment = window.location.hash.slice(1)
  token = /^[a-f0-9]{64}$/.test(fragment)
    ? fragment
    : (sessionStorage.getItem("whyfull-token") ?? "")
  if (token) sessionStorage.setItem("whyfull-token", token)
  if (fragment === token && fragment)
    history.replaceState(history.state, "", location.pathname + location.search)
}
export const hasToken = () => !!token

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  })
  const value = await res.json()
  if (!res.ok)
    throw new ApiError(
      value.error ?? `Request failed (${res.status})`,
      res.status
    )
  return value as T
}

export async function exportSnapshot(filename = "whyfull-disk.json") {
  const response = await fetch("/api/export", {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error((await response.json()).error)
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function formatSize(value: number | undefined) {
  let n = value ?? 0,
    i = 0
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toLocaleString(undefined, { maximumFractionDigits: i > 1 ? (n < 10 ? 2 : 1) : 0 })} ${units[i]}`
}

export async function importReport(file: File): Promise<ViewerStatus> {
  if (file.size > 8 * 1024 ** 3)
    throw new Error("Reports must be smaller than 8 GiB")
  const response = await fetch("/api/import", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Whyfull-Name": encodeURIComponent(file.name),
    },
    body: file,
  })
  const result = await response.json()
  if (!response.ok)
    throw new ApiError(result.error ?? "Could not open report", response.status)
  return result
}
