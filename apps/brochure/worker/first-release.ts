// Verified, notarized artifacts from the committed a29408f desktop source.
// The complete GitHub release replaces this limited first-release listing.
export const firstReleaseFiles = [
  {
    id: "desktop-macos-arm64",
    name: "Whyfull_0.0.1_aarch64.dmg",
    size: 48559916,
    sha256: "1ab6fbe53f57498454afade5125e1998074008ee1396ac380c7d23d6fbaf3057",
    contentType: "application/x-apple-diskimage",
  },
  {
    id: "cli-macos-arm64",
    name: "whyfull-0.0.1-darwin-arm64.tar.gz",
    size: 37745602,
    sha256: "2f7d3548a2465aaf8e7ed1fe5cadd0d64a8c2e621ee8efb4da8e01227b2fb6f1",
    contentType: "application/gzip",
  },
] as const

export const firstReleaseChecksums = {
  name: "SHA256SUMS.txt",
  contentType: "text/plain; charset=utf-8",
}

export function firstRelease(origin: string) {
  const prefix = `${origin}/downloads/v0.0.1/`
  return {
    version: "0.0.1",
    channel: "stable" as const,
    publishedAt: "2026-11-03T00:00:00Z",
    macosSigning: "notarized" as const,
    windowsSigning: "unsigned" as const,
    updater: false,
    limited: true,
    checksumsUrl: `${prefix}${firstReleaseChecksums.name}`,
    downloads: firstReleaseFiles.map(({ id, name, size, sha256 }) => ({
      id,
      name,
      size,
      sha256,
      url: `${prefix}${name}`,
    })),
  }
}
