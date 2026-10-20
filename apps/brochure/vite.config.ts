import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { loadDownloads } from "./worker/downloads.ts"

export default defineConfig({
  plugins: [
    react(),
    {
      name: "whyfull-release-api",
      configureServer(server) {
        let cached: { body: string; expires: number } | undefined
        server.middlewares.use("/api/downloads", async (_request, response) => {
          try {
            if (!cached || cached.expires < Date.now())
              cached = {
                body: JSON.stringify(await loadDownloads()),
                expires: Date.now() + 300_000,
              }
            response.setHeader("Content-Type", "application/json")
            response.end(cached.body)
          } catch {
            response.statusCode = 503
            response.end(
              JSON.stringify({ error: "Release service unavailable" })
            )
          }
        })
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        download: fileURLToPath(
          new URL("./download/index.html", import.meta.url)
        ),
      },
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("../web/src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
})
