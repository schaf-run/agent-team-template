// Pure TS. No React, no three.js scene objects — see project rule in
// knowledge/docs/3d-model-viewer-plan.md §"Frontend Structure": everything
// under features/viewer/three/ must stay framework-agnostic and
// unit-testable standalone. This module doesn't even need a live
// three.js renderer; it's just numbers in, numbers out.

import type { components } from '../../../api/types'

type Bounds = components['schemas']['Bounds']
type Camera = components['schemas']['Camera']

/**
 * A viewing direction (unnormalized) that gives a pleasant three-quarter,
 * slightly-elevated angle on the model, independent of scale.
 */
const VIEW_DIRECTION = [1, 0.75, 1] as const

/** Camera distance from the bounding sphere center, as a multiple of `radius`. */
const DISTANCE_MULTIPLIER = 2.5

/** Near plane distance, as a fraction of `radius`. Kept well clear of zero. */
const NEAR_RADIUS_FACTOR = 0.01

/**
 * Far plane distance, as a multiple of `radius`. Comfortably beyond
 * `DISTANCE_MULTIPLIER + 1` so the whole bounding sphere stays inside the
 * frustum from any azimuth/elevation, with margin for orbiting.
 */
const FAR_RADIUS_FACTOR = 10

/**
 * Smallest bounding-sphere radius we treat as real geometry. Guards against
 * a degenerate (single-point or perfectly flat, radius === 0) `bounds`
 * producing a zero/non-finite near plane.
 */
const MIN_RADIUS = 1e-6

const viewDirectionLength = Math.hypot(...VIEW_DIRECTION)

/**
 * Computes a reasonable initial camera framing (position, target, near/far
 * clip planes) from a manifest's `bounds`. Used both server-side-mirrored
 * logic on the client (before any geometry has loaded) and by `CameraRig`.
 *
 * The camera targets the bounding sphere's center and sits
 * `DISTANCE_MULTIPLIER * radius` away along a fixed three-quarter viewing
 * direction. `near`/`far` are derived from `radius` alone (not from the
 * absolute position), so behaviour stays proportionally sane across
 * extreme scales — a millimeter-scale scan and a kilometer-scale terrain
 * both get near/far planes scaled to fit, rather than fixed absolute
 * values that would clip or z-fight.
 */
export function frameFromBounds(bounds: Bounds): Camera {
  const [cx, cy, cz] = bounds.center
  const radius = Math.max(bounds.radius, MIN_RADIUS)

  const distance = radius * DISTANCE_MULTIPLIER
  const [dx, dy, dz] = VIEW_DIRECTION

  const position: number[] = [
    cx + (dx / viewDirectionLength) * distance,
    cy + (dy / viewDirectionLength) * distance,
    cz + (dz / viewDirectionLength) * distance,
  ]

  return {
    position,
    target: [cx, cy, cz],
    near: radius * NEAR_RADIUS_FACTOR,
    far: radius * FAR_RADIUS_FACTOR,
  }
}
