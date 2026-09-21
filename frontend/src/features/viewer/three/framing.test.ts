import { describe, expect, it } from 'vitest'
import type { components } from '../../../api/types'
import { frameFromBounds } from './framing'

type Bounds = components['schemas']['Bounds']

function expectSaneCamera(bounds: Bounds) {
  const camera = frameFromBounds(bounds)

  expect(camera.position).toHaveLength(3)
  expect(camera.target).toHaveLength(3)
  for (const value of [...camera.position, ...camera.target, camera.near, camera.far]) {
    expect(Number.isFinite(value)).toBe(true)
  }

  expect(camera.near).toBeGreaterThan(0)
  expect(camera.far).toBeGreaterThan(camera.near)

  camera.target.forEach((value, i) => {
    expect(value).toBeCloseTo(bounds.center[i], 6)
  })

  return camera
}

describe('frameFromBounds', () => {
  it('stays sane for a tiny model (radius ~0.001)', () => {
    const bounds: Bounds = {
      min: [-0.001, -0.001, -0.001],
      max: [0.001, 0.001, 0.001],
      center: [0, 0, 0],
      radius: 0.001,
    }

    const camera = expectSaneCamera(bounds)
    expect(camera.far).toBeLessThan(1)
  })

  it('stays sane for a huge model (radius ~10000)', () => {
    const bounds: Bounds = {
      min: [-10000, -10000, -10000],
      max: [10000, 10000, 10000],
      center: [0, 0, 0],
      radius: 10000,
    }

    const camera = expectSaneCamera(bounds)
    expect(camera.far).toBeGreaterThan(10000)
  })

  it('stays sane for an extremely elongated (non-cubic) bounding box', () => {
    const bounds: Bounds = {
      min: [-1000, -0.001, -0.001],
      max: [1000, 0.001, 0.001],
      center: [0, 0, 0],
      radius: 1000.0000000005,
    }

    expectSaneCamera(bounds)
  })

  it('targets the bounding sphere center, not the origin', () => {
    const bounds: Bounds = {
      min: [-12.5, 0.0, -8.3],
      max: [12.5, 40.1, 8.3],
      center: [0.0, 20.05, 0.0],
      radius: 24.2,
    }

    const camera = expectSaneCamera(bounds)
    expect(camera.target).toEqual([0.0, 20.05, 0.0])
  })

  it('scales near/far proportionally with radius rather than using fixed values', () => {
    const small = frameFromBounds({ min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 })
    const large = frameFromBounds({ min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1000 })

    expect(large.near / small.near).toBeCloseTo(1000, 5)
    expect(large.far / small.far).toBeCloseTo(1000, 5)
  })
})
