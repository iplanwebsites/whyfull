export const VIEWER_OFFLINE_MESSAGE =
  "The viewer is offline. Run whyfull --view and open the URL printed in your terminal."

export class ViewerOfflineError extends Error {
  constructor() {
    super(VIEWER_OFFLINE_MESSAGE)
    this.name = "ViewerOfflineError"
  }
}

export function isViewerOfflineError(error: unknown): boolean {
  return (
    error instanceof ViewerOfflineError ||
    (typeof error === "string" &&
      (error === VIEWER_OFFLINE_MESSAGE ||
        error === `ViewerOfflineError: ${VIEWER_OFFLINE_MESSAGE}`))
  )
}

let offline = false
const listeners = new Set<() => void>()
export const viewerIsOffline = () => offline
export function subscribeViewerConnection(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function setOffline(next: boolean) {
  if (offline === next) return
  offline = next
  for (const listener of listeners) listener()
}

export async function fetchViewer(path: string, init?: RequestInit) {
  try {
    const response = await fetch(path, {
      ...init,
      mode: "same-origin",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    })
    if ([502, 503, 504].includes(response.status))
      throw new ViewerOfflineError()
    setOffline(false)
    return response
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error
    setOffline(true)
    throw new ViewerOfflineError()
  }
}

/** Notify once per failing query until it succeeds again. */
export class QueryErrorTracker {
  private errors = new Map<string, string>()
  shouldNotify(query: string, message: string) {
    if (this.errors.get(query) === message) return false
    this.errors.set(query, message)
    return true
  }
  recovered(query: string) {
    this.errors.delete(query)
  }
}
