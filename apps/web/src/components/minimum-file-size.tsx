import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Filter } from "lucide-react"
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "@workspace/ui/components/sonner"
import { api, formatSize } from "@/lib/api"

export function MinimumFileSize({ value }: { value: number }) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  async function change(next: string) {
    setBusy(true)
    try {
      await api("preferences", { minFileBytes: Number(next) })
      await Promise.all([
        client.invalidateQueries({ queryKey: ["status"] }),
        client.invalidateQueries({ queryKey: ["directory"] }),
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Filter /> Minimum file size
        <span className="ml-auto text-xs text-muted-foreground">
          {value ? formatSize(value) : "All"}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          aria-label="Minimum file size"
          value={String(value)}
          onValueChange={(next) => void change(next)}
        >
          {[0, 1024 ** 2, 10 * 1024 ** 2, 100 * 1024 ** 2].map((size) => (
            <DropdownMenuRadioItem
              key={size}
              value={String(size)}
              disabled={busy}
            >
              {size ? formatSize(size) : "Show everything"}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
