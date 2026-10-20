import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: "/index.html" } },
    }),
    viteReact(),
  ],
  server: {
    host: "127.0.0.1",
    proxy: process.env.WHYFULL_DEV_API
      ? {
          "/api": {
            target: process.env.WHYFULL_DEV_API,
            changeOrigin: true,
            configure: (proxy) => {
              proxy.on("proxyReq", (request) =>
                request.setHeader(
                  "Origin",
                  new URL(process.env.WHYFULL_DEV_API!).origin
                )
              )
            },
          },
        }
      : undefined,
  },
})

export default config
