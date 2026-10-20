import { Toaster, toast } from "@workspace/ui/components/sonner"
import {
  HeadContent,
  Scripts,
  createRootRoute,
  Outlet,
} from "@tanstack/react-router"
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
} from "@tanstack/react-query"
import { useState } from "react"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import appCss from "@/styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "whyfull · Disk explorer",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
  component: RootApp,
  pendingComponent: () => (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Opening…
    </div>
  ),
})

function RootApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) =>
            toast.error(error.message, { id: query.queryHash }),
        }),
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      })
  )
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delay={300}>
        <Outlet />
        <Toaster position="top-right" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
