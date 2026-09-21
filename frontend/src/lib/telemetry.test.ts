import { describe, expect, it, vi, beforeEach } from 'vitest'
import { markTimeToFirstPixel, markTimeToFullLod } from './telemetry'

describe('telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('markTimeToFirstPixel', () => {
    it('marks TTFP in dev mode', () => {
      const markSpy = vi.spyOn(performance, 'mark')
      const consoleSpy = vi.spyOn(console, 'log')

      markTimeToFirstPixel()

      expect(markSpy).toHaveBeenCalledWith('TTFP')
      expect(consoleSpy).toHaveBeenCalledWith('Performance mark: TTFP')

      markSpy.mockRestore()
      consoleSpy.mockRestore()
    })
  })

  describe('markTimeToFullLod', () => {
    it('marks TTFullLod in dev mode', () => {
      const markSpy = vi.spyOn(performance, 'mark')
      const consoleSpy = vi.spyOn(console, 'log')

      markTimeToFullLod()

      expect(markSpy).toHaveBeenCalledWith('TTFullLod')
      expect(consoleSpy).toHaveBeenCalledWith('Performance mark: TTFullLod')

      markSpy.mockRestore()
      consoleSpy.mockRestore()
    })
  })
})
