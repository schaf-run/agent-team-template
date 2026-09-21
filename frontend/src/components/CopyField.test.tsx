import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import CopyField from './CopyField'

describe('CopyField', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    })
  })

  it('renders without crashing', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<CopyField value="test-value" />)
    })
    expect(container.textContent).toContain('test-value')
    root.unmount()
  })

  it('displays the provided value', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<CopyField value="https://example.com/share" />)
    })

    const valueEl = container.querySelector('.copy-field__value')
    expect(valueEl?.textContent).toBe('https://example.com/share')
    root.unmount()
  })

  it('calls clipboard.writeText on button click', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<CopyField value="copy-me" />)
    })

    const button = container.querySelector('.copy-field__button') as HTMLElement
    button?.click()

    await new Promise(resolve => setTimeout(resolve, 100))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy-me')
    root.unmount()
  })

  it('shows copied feedback', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<CopyField value="test" />)
    })

    const button = container.querySelector('.copy-field__button') as HTMLElement
    expect(button?.textContent).toBe('Copy')

    button?.click()
    await new Promise(resolve => setTimeout(resolve, 100))

    root.unmount()
  })
})
