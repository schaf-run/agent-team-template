import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { getDeviceCapabilities } from './deviceCapabilities'

describe('getDeviceCapabilities', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      ...navigator,
      hardwareConcurrency: 8,
      deviceMemory: 16,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads hardware concurrency', () => {
    const capabilities = getDeviceCapabilities()
    expect(capabilities.cores).toBe(8)
  })

  it('reads device memory', () => {
    const capabilities = getDeviceCapabilities()
    expect(capabilities.memoryGb).toBe(16)
  })

  it('handles missing device memory', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      hardwareConcurrency: 4,
      deviceMemory: undefined,
    })
    const capabilities = getDeviceCapabilities()
    expect(capabilities.memoryGb).toBeUndefined()
  })

  it('handles missing hardwareConcurrency', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      hardwareConcurrency: undefined,
      deviceMemory: 8,
    })
    const capabilities = getDeviceCapabilities()
    expect(capabilities.cores).toBe(1)
  })

  it('handles WebGL unavailability gracefully', () => {
    const capabilities = getDeviceCapabilities()
    // Should not throw and should return valid capabilities
    expect(capabilities).toBeDefined()
    expect(capabilities.cores).toBeGreaterThan(0)
  })
})
