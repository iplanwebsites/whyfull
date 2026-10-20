/** Display filtering only: small entries still count toward measured usage. */
export function isSmallEntry(bytes: number) {
  return bytes < 1024 * 1024
}
