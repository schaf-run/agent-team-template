import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ProgressBar from './ProgressBar'

describe('ProgressBar', () => {
  it('renders without crashing', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<ProgressBar percentage={50} />)
    })
    expect(container.querySelector('.progress-bar')).toBeTruthy()
    root.unmount()
  })

  it('displays correct percentage width', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<ProgressBar percentage={75} />)
    })

    const fill = container.querySelector('.progress-bar__fill') as HTMLElement
    expect(fill?.style.width).toBe('75%')
    root.unmount()
  })

  it('clamps percentage to 0', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<ProgressBar percentage={-10} />)
    })

    const fill = container.querySelector('.progress-bar__fill') as HTMLElement
    expect(fill?.style.width).toBe('0%')
    root.unmount()
  })

  it('clamps percentage to 100', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    flushSync(() => {
      root.render(<ProgressBar percentage={150} />)
    })

    const fill = container.querySelector('.progress-bar__fill') as HTMLElement
    expect(fill?.style.width).toBe('100%')
    root.unmount()
  })
})
