"use client"

import type { ComponentProps } from "react"
import { Group, Panel, Separator } from "react-resizable-panels"
import { GripVertical } from "lucide-react"
import { cn } from "cn"

function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full min-h-0 min-w-0", className)}
      {...props}
    />
  )
}

function ResizablePanel(props: ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ComponentProps<typeof Separator> & { withHandle?: boolean }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "relative z-10 flex w-px shrink-0 items-center justify-center bg-border outline-none transition-colors hover:bg-ring focus-visible:bg-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="flex h-6 w-3 items-center justify-center rounded-sm border bg-background text-muted-foreground">
          <GripVertical className="size-3" />
        </div>
      )}
    </Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
export { useDefaultLayout as useResizableLayout } from "react-resizable-panels"
