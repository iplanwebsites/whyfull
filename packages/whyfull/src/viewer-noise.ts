/** Display filtering only: metadata and negligible files still count toward usage. */
export function isTinyMetadata(name: string, bytes: number) {
  return (
    bytes <= 64 * 1024 &&
    (/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name) ||
      name.startsWith("._"))
  )
}
export function isNegligibleFile(
  name: string,
  bytes: number,
  folderBytes: number
) {
  return (
    isTinyMetadata(name, bytes) ||
    (bytes <= 64 * 1024 && bytes < folderBytes * 0.001)
  )
}
