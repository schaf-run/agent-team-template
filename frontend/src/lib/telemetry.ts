export function markTimeToFirstPixel(): void {
  if (import.meta.env.DEV) {
    performance.mark('TTFP')
    console.log('Performance mark: TTFP')
  }
}

export function markTimeToFullLod(): void {
  if (import.meta.env.DEV) {
    performance.mark('TTFullLod')
    console.log('Performance mark: TTFullLod')
  }
}
