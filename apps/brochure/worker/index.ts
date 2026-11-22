import { handleCommerce, protectKeyPage, type CommerceEnv } from "./commerce.ts"
import { loadDownloads } from "./downloads.ts"
import {
  firstRelease,
  firstReleaseChecksums,
  firstReleaseFiles,
} from "./first-release.ts"

interface Env extends CommerceEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  DOWNLOADS: {
    head(key: string): Promise<{ size: number } | null>
    get(key: string): Promise<{
      body: ReadableStream
      size: number
      httpEtag: string
    } | null>
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    context: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<Response> {
    const url = new URL(request.url)
    // /buy/, Stripe webhook, license lookup and recovery. See docs/commerce.md.
    const commerce = await handleCommerce(request, env, url, context)
    if (commerce) return commerce
    if (url.pathname.startsWith("/downloads/v0.0.1/")) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        })
      const name = url.pathname.slice("/downloads/v0.0.1/".length)
      const file = [...firstReleaseFiles, firstReleaseChecksums].find(
        (entry) => entry.name === name
      )
      if (!file) return new Response(null, { status: 404 })
      const key = `v0.0.1/${name}`
      const object = await env.DOWNLOADS.get(key)
      if (!object || ("size" in file && object.size !== file.size))
        return new Response(null, { status: 404 })
      const headers = new Headers({
        "Content-Type": file.contentType,
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      })
      headers.set("ETag", object.httpEtag)
      return new Response(request.method === "HEAD" ? null : object.body, {
        headers,
      })
    }
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
          let release: unknown = null
          let upstreamError: unknown
          try {
            release = (await loadDownloads()).release
          } catch (error) {
            upstreamError = error
          }
          if (!release) {
            const stored = await Promise.all(
              firstReleaseFiles.map((file) =>
                env.DOWNLOADS.head(`v0.0.1/${file.name}`)
              )
            )
            const checksums = await env.DOWNLOADS.head(
              `v0.0.1/${firstReleaseChecksums.name}`
            )
            if (
              checksums &&
              stored.every(
                (object, index) =>
                  object?.size === firstReleaseFiles[index].size
              )
            )
              release = firstRelease(url.origin)
            else if (upstreamError) throw upstreamError
          }
          response = Response.json(
            { release },
            {
              headers: {
                "Cache-Control": "public, max-age=300",
                "X-Content-Type-Options": "nosniff",
              },
            }
          )
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
    return protectKeyPage(url.pathname, await env.ASSETS.fetch(request))
  },
}
