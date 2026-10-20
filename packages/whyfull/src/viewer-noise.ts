/** Display filtering only: small entries still count toward measured usage. */
export function isSmallEntry(bytes: number, minimum = 1024 * 1024) {
  return bytes < minimum
}
