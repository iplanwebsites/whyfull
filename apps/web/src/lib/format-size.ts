/** Precision follows the visible folder/section scale, while keeping small units readable. */
export function formatSize(value: number | undefined, upperLimit = value ?? 0) {
  let n = Math.max(0, value ?? 0),
    i = 0
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const decimals =
    i >= 3 && n < 100 && !(i === 3 && upperLimit >= 1024 ** 4) ? 1 : 0
  return `${n.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${units[i]}`
}
