import { describe, expect, it } from 'vitest'
import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024 * 512)).toBe('512 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024 * 512)).toBe('512 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe('2 GB')
  })
})
