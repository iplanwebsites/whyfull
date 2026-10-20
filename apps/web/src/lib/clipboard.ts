import { toast } from "@workspace/ui/components/sonner"

export async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path)
    toast.success("Path copied", { duration: 2000 })
  } catch {
    toast.error(
      "Could not copy the path. Check clipboard permissions and try again."
    )
  }
}
