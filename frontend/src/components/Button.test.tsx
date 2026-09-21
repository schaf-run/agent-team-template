import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import Button from './Button'

describe('Button', () => {
  it('renders without crashing', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<Button>Click me</Button>)
    })
    expect(container.textContent).toContain('Click me')
    root.unmount()
  })

  it('calls onClick handler', () => {
    const onClick = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<Button onClick={onClick}>Click</Button>)
    })

    const button = container.querySelector('button')
    button?.click()
    expect(onClick).toHaveBeenCalled()
    root.unmount()
  })

  it('applies primary variant', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<Button variant="primary">Primary</Button>)
    })

    const button = container.querySelector('button')
    expect(button?.className).toContain('button--primary')
    root.unmount()
  })

  it('applies secondary variant', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<Button variant="secondary">Secondary</Button>)
    })

    const button = container.querySelector('button')
    expect(button?.className).toContain('button--secondary')
    root.unmount()
  })

  it('handles disabled state', () => {
    const onClick = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(
        <Button disabled onClick={onClick}>
          Disabled
        </Button>
      )
    })

    const button = container.querySelector('button')
    expect(button?.disabled).toBe(true)
    root.unmount()
  })
})
