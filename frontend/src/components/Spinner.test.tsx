import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import Spinner from './Spinner'

describe('Spinner', () => {
  it('renders without crashing', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<Spinner />)
    })
    expect(container.querySelector('.spinner')).toBeTruthy()
    root.unmount()
  })

  it('has spinner class', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<Spinner />)
    })

    const spinner = container.querySelector('.spinner')
    expect(spinner?.className).toBe('spinner')
    root.unmount()
  })
})
