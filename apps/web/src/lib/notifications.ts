import { toast as baseToast } from "@workspace/ui/components/sonner"
import { isViewerOfflineError } from "./viewer-connection"

const error: typeof baseToast.error = (message, options) => {
  if (isViewerOfflineError(message)) {
    // Finish action loading toasts too; the persistent banner explains recovery.
    if (options?.id !== undefined) baseToast.dismiss(options.id)
    return options?.id ?? "viewer-offline"
  }
  return baseToast.error(message, {
    ...options,
    id:
      options?.id ??
      (typeof message === "string" ? `error:${message}` : undefined),
  })
}

export const toast = Object.assign(
  (...args: Parameters<typeof baseToast>) => baseToast(...args),
  baseToast,
  { error }
)
