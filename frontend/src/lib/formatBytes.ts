export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  let bytes_value = Math.abs(bytes)
  let unitIndex = 0
  
  while (bytes_value >= k && unitIndex < units.length - 1) {
    bytes_value /= k
    unitIndex++
  }
  
  // Round to 1 decimal place
  const rounded = Math.round(bytes_value * 10) / 10
  
  return `${rounded} ${units[unitIndex]}`
}
