export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Weighted {
  value: number
}
/** Weighted binary partition, biased toward wide rectangles so names have room.
 * Each split preserves area. Header/padding are added only by the renderer. */
export function horizontalTreemap<T extends Weighted>(
  entries: T[],
  bounds: Rect
): Array<{ entry: T; rect: Rect }> {
  const values = entries
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
  const output: Array<{ entry: T; rect: Rect }> = []
  const partition = (items: T[], rect: Rect, total: number) => {
    if (!items.length || !total || rect.width <= 0 || rect.height <= 0) return
    if (items.length === 1) {
      output.push({ entry: items[0], rect })
      return
    }
    let split = 1,
      sum = items[0].value
    while (
      split < items.length - 1 &&
      Math.abs(total / 2 - sum - items[split].value) < Math.abs(total / 2 - sum)
    )
      sum += items[split++].value
    const ratio = sum / total
    if (rect.width / rect.height < 3.4) {
      const height = rect.height * ratio
      partition(items.slice(0, split), { ...rect, height }, sum)
      partition(
        items.slice(split),
        { ...rect, y: rect.y + height, height: rect.height - height },
        total - sum
      )
    } else {
      const width = rect.width * ratio
      partition(items.slice(0, split), { ...rect, width }, sum)
      partition(
        items.slice(split),
        { ...rect, x: rect.x + width, width: rect.width - width },
        total - sum
      )
    }
  }
  partition(
    values,
    bounds,
    values.reduce((sum, entry) => sum + entry.value, 0)
  )
  return output
}
