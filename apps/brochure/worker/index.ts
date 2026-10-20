import { loadDownloads } from "./downloads.ts"

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    context: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/api/downloads") {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        })
      // One shared cache entry per deployment origin, independent of query
      // strings. No GitHub token or visitor information is sent upstream.
      const key = new Request(`${url.origin}/api/downloads`)
      const cache = await caches.open("whyfull-downloads-v1")
      const cached = await cache.match(key)
      let response = cached
      if (!response) {
        try {
          response = Response.json(await loadDownloads(), {
            headers: {
              "Cache-Control": "public, max-age=300",
              "X-Content-Type-Options": "nosniff",
            },
          })
        } catch {
          response = Response.json(
            {
              error:
                "Downloads are temporarily unavailable. Visit GitHub Releases.",
            },
            {
              status: 503,
              headers: { "Cache-Control": "public, max-age=30" },
            }
          )
        }
        context.waitUntil(cache.put(key, response.clone()))
      }
      return request.method === "HEAD" ? new Response(null, response) : response
    }
    return env.ASSETS.fetch(request)
  },
}
